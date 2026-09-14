// Source registry, drift detection and delivery targets (ports of
// expertloop/sources/registry.py, drift.py and targets/). A citation keeps the
// hash its source had at compile or edit time; re-hashing a source to a new
// digest flags every step that cites it. The webhook target signs canonical
// JSON with HMAC-SHA256 over "<timestamp>.<body>" and the fake receiver
// verifies the signature before it issues a receipt; the Jira fake keeps the
// comments and attachments it received.

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

function* iterCitations(document: InstructionDocument): Generator<Citation> {
  for (const key of CITED_SECTIONS) {
    for (const entry of document[key] as Array<{ citations?: Citation[] }>) {
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

export function signPayload(secret: string, timestamp: string, body: string): string {
  return 'sha256=' + hmacSha256(secret, `${timestamp}.${body}`);
}

export interface WebhookRecord {
  receipt_id: string;
  body_sha256: string;
  event: string;
  version: number;
  instruction_set_id: number;
}

/** Fake business-system receiver: verifies the signature and stores what it received. */
export class FakeWebhookReceiver {
  readonly received: WebhookRecord[] = [];
  private readonly secret: string;
  private counter = 0;

  constructor(secret: string) {
    this.secret = secret;
  }

  accept(body: string, headers: Record<string, string>): { status: number; json: Record<string, unknown> } {
    const timestamp = headers[TIMESTAMP_HEADER] ?? '';
    const signature = headers[SIGNATURE_HEADER] ?? '';
    if (signPayload(this.secret, timestamp, body) !== signature) return { status: 401, json: { error: 'bad signature' } };
    const payload = JSON.parse(body) as DeliveryPayload;
    this.counter += 1;
    const record: WebhookRecord = {
      receipt_id: `whr-${this.counter}`,
      body_sha256: sha256(body),
      event: payload.event,
      version: payload.version,
      instruction_set_id: payload.instruction_set_id,
    };
    this.received.push(record);
    return { status: 200, json: { receipt_id: record.receipt_id, verified: true, body_sha256: record.body_sha256 } };
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
    const response = this.receiver.accept(body, { [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signature });
    if (response.status >= 300) throw new DeliveryError(`webhook rejected delivery: ${response.status}`);
    return { target: this.name, status: 'delivered', receipt: { ...response.json, timestamp, signature } };
  }
}

/** Fake Jira: the comment and attachment endpoints, keeping what they received. */
export class FakeJira {
  readonly comments: { id: string; issue: string; body: string }[] = [];
  readonly attachments: { id: string; issue: string; filename: string; size: number }[] = [];
  private nextId = 10001;

  addComment(issue: string, body: string): { id: string } {
    const comment = { id: String(this.nextId++), issue, body };
    this.comments.push(comment);
    return comment;
  }

  addAttachment(issue: string, filename: string, content: string): { id: string; size: number } {
    const attachment = { id: String(this.nextId++), issue, filename, size: content.length };
    this.attachments.push(attachment);
    return attachment;
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

  deliver(payload: DeliveryPayload): DeliveryReceipt {
    const document = payload.document;
    const comment = this.jira.addComment(
      this.issueKey,
      `ExpertLoop ${payload.action}: ${document.title} (instruction set ${payload.instruction_set_id} v${payload.version})\n\n${document.agent_prompt}`,
    );
    const filename = `instruction-set-${payload.instruction_set_id}-v${payload.version}.json`;
    const attachment = this.jira.addAttachment(this.issueKey, filename, JSON.stringify(document, null, 2));
    return {
      target: this.name,
      status: 'delivered',
      receipt: { issue: this.issueKey, comment: { id: comment.id }, attachment: { id: attachment.id, filename, size: attachment.size } },
    };
  }
}
