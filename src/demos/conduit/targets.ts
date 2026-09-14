// Port of the three adapters and the FastAPI fakes they talk to in the demo.
// Each adapter renders the request the real one sends (Slack chat.postMessage,
// a Jira REST v3 issue, a signed webhook POST), always with an Idempotency-Key
// header; each fake records an inbox keyed by that header and takes runtime
// fault injection: 429 for chosen tasks, a hard 400, or a full 503 outage.
import type { Task } from './models';
import type { Rng } from './prng';
import { classifyResponse, type FakeResponse } from './retry';
import { applyMapping } from './schema';
import { sha256Hex } from './sha256';
import type { ConnectorSpec } from './specs';

export interface Faults {
  rateLimitTasks: Set<string>;
  rateLimitCount: number;
  hardFailTasks: Set<string>;
  outage: boolean;
}

export interface InboxEntry {
  taskId: string;
  version: number;
  idempotencyKey: string;
  remoteId: string;
  replayed: boolean;
}

export interface RenderedRequest {
  method: 'POST' | 'PUT';
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export const noFaults = (): Faults => ({ rateLimitTasks: new Set(), rateLimitCount: 2, hardFailTasks: new Set(), outage: false });

export class FakeTarget {
  readonly spec: ConnectorSpec;
  faults: Faults = noFaults();
  readonly inbox: InboxEntry[] = [];
  readonly rateLimitHits = new Map<string, number>();
  calls = 0;
  rejected = 0;
  lastLatency = 0;
  private readonly rng: Rng;

  constructor(spec: ConnectorSpec, rng: Rng) {
    this.spec = spec;
    this.rng = rng;
  }

  setFaults(faults: Partial<Faults>): void {
    this.faults = { ...this.faults, ...faults };
    this.rateLimitHits.clear();
  }

  private inject(taskId: string): FakeResponse | null {
    this.calls += 1;
    const f = this.faults;
    const error = (status: number, reason: string, headers: Record<string, string> = {}): FakeResponse => {
      this.rejected += 1;
      return { status, headers, body: { error: 'injected', reason } };
    };
    if (f.outage) return error(503, 'outage');
    if (f.hardFailTasks.has(taskId)) return error(400, 'hard_fail');
    if (f.rateLimitTasks.has(taskId)) {
      const hits = this.rateLimitHits.get(taskId) ?? 0;
      if (hits < f.rateLimitCount) {
        this.rateLimitHits.set(taskId, hits + 1);
        return error(429, 'rate_limited', { 'Retry-After': '0' });
      }
    }
    return null;
  }

  handle(request: RenderedRequest, task: Task, replayed: boolean): FakeResponse {
    this.lastLatency = this.rng.uniform(0.0004, 0.0026);
    const fault = this.inject(task.id);
    if (fault) return fault;
    const key = request.headers['Idempotency-Key'];
    let entry = this.inbox.find((e) => e.idempotencyKey === key);
    if (!entry) {
      const n = this.inbox.length;
      const remoteId = this.spec.type === 'slack' ? `${1700000000 + n}.${this.rng.hex(6)}` : this.spec.type === 'jira' ? `SUP-${1001 + n}` : `evt_${this.rng.hex(10)}`;
      entry = { taskId: task.id, version: task.version, idempotencyKey: key, remoteId, replayed };
      this.inbox.push(entry);
    }
    const body = this.spec.type === 'slack' ? { ok: true, ts: entry.remoteId } : this.spec.type === 'jira' ? { key: entry.remoteId } : { id: entry.remoteId, status: 'accepted' };
    return { status: this.spec.type === 'slack' ? 200 : this.spec.type === 'jira' ? 201 : 202, headers: {}, body };
  }
}

// Adapter.render: the request deliver() sends, built from the mapping rules.
export function renderRequest(spec: ConnectorSpec, task: Task, key: string, remoteId: string | null): RenderedRequest {
  const mapped = applyMapping(spec, task);
  const headers: Record<string, string> = { 'Idempotency-Key': key };
  if (spec.type === 'slack') {
    headers.Authorization = `Bearer <${spec.secrets.token}>`;
    const title = String(mapped.title ?? task.title).slice(0, 150);
    return {
      method: 'POST',
      url: `${(spec.baseUrl ?? 'https://slack.com').replace(/\/$/, '')}/api/chat.postMessage`,
      headers,
      body: { channel: spec.target, text: `${task.title} [${task.id} v${task.version}]`, blocks: [{ type: 'header', text: title }], metadata: { task_id: task.id, idempotency_key: key } },
    };
  }
  if (spec.type === 'jira') {
    headers.Authorization = `Basic base64(<${spec.secrets.email}>:<${spec.secrets.api_token}>)`;
    const { summary, issuetype, description, ...rest } = mapped;
    const fields = { project: { key: spec.target }, summary: `${String(summary ?? task.title)} [conduit:${task.id}]`.slice(0, 255), issuetype: { name: String(issuetype ?? 'Task') }, description, ...rest };
    const base = `${(spec.baseUrl ?? '').replace(/\/$/, '')}/rest/api/3/issue`;
    return remoteId ? { method: 'PUT', url: `${base}/${remoteId}`, headers, body: { fields } } : { method: 'POST', url: base, headers, body: { fields } };
  }
  const body = { event: 'task.synced', connector: spec.name, idempotency_key: key, task: mapped };
  const timestamp = String(1_700_000_000);
  headers['X-Conduit-Timestamp'] = timestamp;
  headers['X-Conduit-Signature'] = `sha256=${sha256Hex(`${spec.secrets.signing_secret}.${timestamp}.${JSON.stringify(body)}`).slice(0, 24)}`;
  return { method: 'POST', url: spec.target, headers, body };
}

// Adapter.deliver: one attempt; raises TransientError or PermanentError.
export function deliver(spec: ConnectorSpec, target: FakeTarget, task: Task, key: string, remoteId: string | null, replayed: boolean): string | null {
  const response = target.handle(renderRequest(spec, task, key, remoteId), task, replayed);
  const err = classifyResponse(response, spec.retry);
  if (err) throw err;
  const b = response.body;
  return String(b.ts ?? b.key ?? b.id ?? '') || null;
}
