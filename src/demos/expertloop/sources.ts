// Source registry, drift detection and delivery targets (ports of
// expertloop/sources/registry.py, drift.py, targets/ and fakes/server.py at
// 5.1.0). A citation keeps the hash its source had at compile or edit time;
// re-hashing a source to a new digest flags every step that cites it. The
// webhook target signs canonical JSON with HMAC-SHA256 over
// "<timestamp>.<body>" and the fake receiver verifies the signature before it
// issues a receipt; the Jira fake takes an Atlassian Document Format comment
// and an attachment. The two fakes draw receipt ids from one shared counter,
// as fakes/server.py does: whr-<n>, comment 10000+n, attachment 20000+n.

import type { Citation, InstructionDocument } from './compile';
import { hmacSha256, sha256 } from './sha256';

export interface Source {
  id: number;
  kind: string;
  ref: string;
  title: string | null;
  content: string | null;
  content_hash: string;
}

export function contentHash(content: string | null, ref: string): string {
  return sha256(content !== null ? content : `ref:${ref}`);
}

const CITED_SECTIONS = ['preconditions', 'steps', 'decision_rules', 'forbidden_actions', 'outcomes'] as const;

export function* iterCitations(document: InstructionDocument): Generator<Citation> {
  for (const key of CITED_SECTIONS) {
    for (const entry of (document[key] ?? []) as Array<{ citations?: Citation[] }>) {
      for (const cite of entry.citations ?? []) yield cite;
    }
  }
}

export class SourceRegistry {
  private sources: Source[] = [];
  private nextId = 1;

  list(): Source[] {
    return this.sources.slice();
  }

  find(kind: string, ref: string): Source | undefined {
    return this.sources.find((s) => s.kind === kind && s.ref === ref);
  }

  byId(id: number): Source | undefined {
    return this.sources.find((s) => s.id === id);
  }

  register(kind: string, ref: string, content: string | null = null, title: string | null = null): Source {
    const existing = this.find(kind, ref);
    if (existing) {
      if (content !== null && content !== existing.content) {
        existing.content = content;
        existing.content_hash = contentHash(content, ref);
      }
      if (title !== null) existing.title = title;
      return existing;
    }
    const source: Source = { id: this.nextId++, kind, ref, title, content, content_hash: contentHash(content, ref) };
    this.sources.push(source);
    return source;
  }

  /** Attach source_id and source_hash to every citation with a reference; returns distinct sources linked. */
  resolveCitations(document: InstructionDocument): number {
    const linked = new Set<number>();
    for (const cite of iterCitations(document)) {
      if (!cite.source_ref) continue;
      const source = this.register(cite.source_kind ?? 'doc', cite.source_ref);
      cite.source_id = source.id;
      cite.source_hash = source.content_hash;
      linked.add(source.id);
    }
    return linked.size;
  }

  /** The (kind, ref) pairs a document cites that the registry does not hold. */
  unknownSourceRefs(document: InstructionDocument): Array<[string, string]> {
    const unknown: Array<[string, string]> = [];
    const seen = new Set<string>();
    for (const cite of iterCitations(document)) {
      if (!cite.source_ref) continue;
      const kind = cite.source_kind ?? 'doc';
      const key = `${kind}:${cite.source_ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!this.find(kind, cite.source_ref)) unknown.push([kind, cite.source_ref]);
    }
    return unknown;
  }
}

export interface DriftFlag {
  id: number;
  instruction_set_id: number;
  step_id: string;
  source_id: number;
  cited_hash: string;
  current_hash: string;
  detected_by: string;
  resolved_by: string | null;
  resolution: string | null;
  open: boolean;
}

export type NewFlag = Pick<DriftFlag, 'step_id' | 'source_id' | 'cited_hash' | 'current_hash'>;

/** Distinct (step id, source id, cited hash) triples in a document. */
export function stepSources(document: InstructionDocument): Array<[string, number, string]> {
  const seen = new Set<string>();
  const out: Array<[string, number, string]> = [];
  for (const step of document.steps) {
    for (const cite of step.citations) {
      if (!cite.source_id) continue;
      const key = `${step.id}:${cite.source_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([step.id, cite.source_id, cite.source_hash ?? '']);
    }
  }
  return out;
}

/** Flags to open: cited hash differs from the registry and no open or matching resolved flag exists. */
export function scanDocument(document: InstructionDocument, registry: SourceRegistry, existing: DriftFlag[], sourceId: number | null): NewFlag[] {
  const latest = new Map<string, DriftFlag>();
  for (const flag of existing) latest.set(`${flag.step_id}:${flag.source_id}`, flag);
  const created: NewFlag[] = [];
  for (const [stepId, sid, cited] of stepSources(document)) {
    if (sourceId !== null && sid !== sourceId) continue;
    const source = registry.byId(sid);
    if (!source || source.content_hash === cited) continue;
    const previous = latest.get(`${stepId}:${sid}`);
    if (previous && (previous.open || previous.current_hash === source.content_hash)) continue;
    created.push({ step_id: stepId, source_id: sid, cited_hash: cited, current_hash: source.content_hash });
  }
  return created;
}

/** After an edit, the open flags whose step now carries the registry's current hash. */
export function flagsClosedByEdit(document: InstructionDocument, flags: DriftFlag[]): DriftFlag[] {
  const current = new Map<string, string>();
  for (const [stepId, sid, cited] of stepSources(document)) current.set(`${stepId}:${sid}`, cited);
  return flags.filter((flag) => {
    if (!flag.open) return false;
    const cited = current.get(`${flag.step_id}:${flag.source_id}`);
    return cited === undefined || cited === flag.current_hash;
  });
}

export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) out[k] = sortKeys((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

/** json.dumps(sort_keys=True, separators=(",", ":")) */
export function canonicalCompact(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/**
 * Added and removed lines between the sort_keys, indent=2 JSON of two
 * documents, from a longest-common-subsequence walk; the service stores this
 * with each edit and refuses an edit that changes nothing.
 */
export function lineChanges(before: unknown, after: unknown): { added: number; removed: number } {
  const a = JSON.stringify(sortKeys(before), null, 2).split('\n');
  const b = JSON.stringify(sortKeys(after), null, 2).split('\n');
  const n = a.length;
  const m = b.length;
  const table: Uint16Array[] = [];
  for (let i = 0; i <= n; i++) table.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const common = table[0][0];
  return { added: m - common, removed: n - common };
}

export interface DeliveryPayload {
  event: string;
  action: 'publish' | 'rollback';
  delivery_id: string;
  instruction_set_id: number;
  name: string;
  version: number;
  document: InstructionDocument;
  [extra: string]: unknown;
}

export interface DeliveryReceipt {
  target: string;
  status: 'delivered' | 'failed';
  receipt: Record<string, unknown>;
}

export class DeliveryError extends Error {}

export interface Target {
  readonly name: string;
  deliver(payload: DeliveryPayload, clock: () => number): DeliveryReceipt;
}

export const SIGNATURE_HEADER = 'X-ExpertLoop-Signature';
export const TIMESTAMP_HEADER = 'X-ExpertLoop-Timestamp';
/** Carries the payload's stable delivery_id so a receiver can recognise a re-posted delivery. */
export const DELIVERY_HEADER = 'X-ExpertLoop-Delivery';

export function signPayload(secret: string, timestamp: string, body: string): string {
  return 'sha256=' + hmacSha256(secret, `${timestamp}.${body}`);
}

/** One counter shared by both fakes, as `count(1)` is in fakes/server.py. */
export class ReceiptCounter {
  private n = 0;

  next(): number {
    this.n += 1;
    return this.n;
  }
}

export interface WebhookRecord {
  receipt_id: string;
  delivery_id: string;
  body_sha256: string;
  event: string;
  version: number;
  instruction_set_id: number;
}

/** Fake business-system receiver: verifies the signature and stores what it received. */
export class FakeWebhookReceiver {
  readonly received: WebhookRecord[] = [];
  private readonly secret: string;
  private readonly counter: ReceiptCounter;

  constructor(secret: string, counter: ReceiptCounter) {
    this.secret = secret;
    this.counter = counter;
  }

  accept(body: string, headers: Record<string, string>): { status: number; json: Record<string, unknown> } {
    const timestamp = headers[TIMESTAMP_HEADER] ?? '';
    const signature = headers[SIGNATURE_HEADER] ?? '';
    if (signPayload(this.secret, timestamp, body) !== signature) return { status: 401, json: { error: 'invalid signature' } };
    const payload = JSON.parse(body) as DeliveryPayload;
    const record: WebhookRecord = {
      receipt_id: `whr-${this.counter.next()}`,
      delivery_id: headers[DELIVERY_HEADER] ?? '',
      body_sha256: sha256(body),
      event: payload.event,
      version: payload.version,
      instruction_set_id: payload.instruction_set_id,
    };
    this.received.push(record);
    return { status: 200, json: { receipt_id: record.receipt_id, signature_valid: true, body_sha256: record.body_sha256 } };
  }
}

export class WebhookTarget implements Target {
  readonly name = 'webhook';
  private readonly secret: string;
  private readonly receiver: FakeWebhookReceiver;

  constructor(secret: string, receiver: FakeWebhookReceiver) {
    this.secret = secret;
    this.receiver = receiver;
  }

  deliver(payload: DeliveryPayload, clock: () => number): DeliveryReceipt {
    const body = canonicalCompact(payload);
    const timestamp = String(clock());
    const signature = signPayload(this.secret, timestamp, body);
    const response = this.receiver.accept(body, {
      [TIMESTAMP_HEADER]: timestamp,
      [SIGNATURE_HEADER]: signature,
      [DELIVERY_HEADER]: payload.delivery_id,
    });
    if (response.status >= 300) throw new DeliveryError(`webhook rejected delivery: ${response.status} ${JSON.stringify(response.json)}`);
    return { target: this.name, status: 'delivered', receipt: { ...response.json, timestamp, signature } };
  }
}

interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
}

export interface AdfDocument {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

/** Whether `body` is shaped like an Atlassian Document Format document. */
export function isAdf(body: unknown): body is AdfDocument {
  if (!body || typeof body !== 'object') return false;
  const doc = body as Partial<AdfDocument>;
  return doc.type === 'doc' && doc.version === 1 && Array.isArray(doc.content) && doc.content.length > 0;
}

/** The text nodes of an ADF document, joined. */
export function adfText(body: AdfDocument): string {
  const chunks: string[] = [];
  for (const node of body.content) for (const child of node.content ?? []) if (child.type === 'text') chunks.push(String(child.text ?? ''));
  return chunks.join('\n\n');
}

export interface JiraComment {
  id: string;
  issue: string;
  body: AdfDocument;
  text: string;
}

export interface JiraAttachment {
  id: string;
  issue: string;
  filename: string;
  size: number;
}

/** Fake Jira: the REST v3 comment and attachment endpoints, keeping what they received. */
export class FakeJira {
  readonly comments: JiraComment[] = [];
  readonly attachments: JiraAttachment[] = [];
  private readonly counter: ReceiptCounter;

  constructor(counter: ReceiptCounter) {
    this.counter = counter;
  }

  addComment(issue: string, body: unknown): { status: number; json: Record<string, unknown> } {
    if (!isAdf(body)) return { status: 400, json: { errorMessages: ['comment body must be an Atlassian Document Format document'] } };
    const id = String(10000 + this.counter.next());
    this.comments.push({ id, issue, body, text: adfText(body) });
    return { status: 200, json: { id, self: `/jira/rest/api/3/issue/${issue}/comment/${id}` } };
  }

  addAttachment(issue: string, filename: string, content: string): Array<{ id: string; filename: string; size: number }> {
    const id = String(20000 + this.counter.next());
    this.attachments.push({ id, issue, filename, size: content.length });
    return [{ id, filename, size: content.length }];
  }
}

export class JiraTarget implements Target {
  readonly name = 'jira';
  private readonly issueKey: string;
  private readonly jira: FakeJira;

  constructor(issueKey: string, jira: FakeJira) {
    this.issueKey = issueKey;
    this.jira = jira;
  }

  /** The smallest ADF body that carries a prompt verbatim. */
  static adfDocument(headline: string, prompt: string): AdfDocument {
    return {
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: headline }] },
        { type: 'codeBlock', content: [{ type: 'text', text: prompt }] },
      ],
    };
  }

  deliver(payload: DeliveryPayload): DeliveryReceipt {
    const document = payload.document;
    const headline = `ExpertLoop ${payload.action}: ${document.title} (instruction set ${payload.instruction_set_id} v${payload.version})`;
    const comment = this.jira.addComment(this.issueKey, JiraTarget.adfDocument(headline, document.agent_prompt));
    if (comment.status >= 300) throw new DeliveryError(`jira comment failed: ${comment.status} ${JSON.stringify(comment.json)}`);
    const filename = `instruction-set-${payload.instruction_set_id}-v${payload.version}.json`;
    const attachment = this.jira.addAttachment(this.issueKey, filename, JSON.stringify(document, null, 2));
    return { target: this.name, status: 'delivered', receipt: { issue: this.issueKey, comment: comment.json, attachment } };
  }
}
