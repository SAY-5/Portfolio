// Outbound delivery: the retry policy, the receiver fake that verifies the
// outbound signature and injects failures by payload tag, and the worker that
// claims due deliveries, posts signed requests and schedules jittered backoff.
import { canonicalJson, EVENT_ID_HEADER, IDEMPOTENCY_HEADER, parseJson, SIGNATURE_HEADER, signHeaders, TIMESTAMP_HEADER, verifySignature, type Json } from './signing';
import type { AttemptRow, Database, Destination, DeliveryStatus, Prng, VirtualClock } from './store';

export interface RetryPolicy {
  maxAttempts: number;
  baseDelaySeconds: number;
  maxDelaySeconds: number;
  multiplier: number;
  jitter: number;
}

export interface DestinationConfig extends Destination {
  retry: RetryPolicy;
}

// destinations.yaml: crm takes every source, billing only orders.
export const DESTINATIONS: DestinationConfig[] = [
  { name: 'crm', secret: 'crm-dev-secret', sources: ['*'], maxAttempts: 4, retry: { maxAttempts: 4, baseDelaySeconds: 0.5, maxDelaySeconds: 8, multiplier: 2, jitter: 0.2 } },
  { name: 'billing', secret: 'billing-dev-secret', sources: ['orders'], maxAttempts: 6, retry: { maxAttempts: 6, baseDelaySeconds: 1, maxDelaySeconds: 30, multiplier: 2, jitter: 0.2 } },
];

// Deterministic delay before the retry that follows `attempt` (1-based).
export function baseBackoff(policy: RetryPolicy, attempt: number): number {
  return Math.min(policy.baseDelaySeconds * policy.multiplier ** (attempt - 1), policy.maxDelaySeconds);
}

// Backoff with symmetric jitter, never above max_delay_seconds.
export function jitteredBackoff(policy: RetryPolicy, attempt: number, rng: Prng): number {
  const base = baseBackoff(policy, attempt);
  if (policy.jitter === 0 || base === 0) return base;
  return Math.min(base * (1 + rng.uniform(-policy.jitter, policy.jitter)), policy.maxDelaySeconds);
}

const RETRYABLE = new Set([408, 425, 429]);

// 2xx success; 408, 425, 429 and 5xx transient; any other status permanent.
export function classify(statusCode: number): AttemptRow['outcome'] {
  if (statusCode >= 200 && statusCode < 300) return 'success';
  if (RETRYABLE.has(statusCode) || statusCode >= 500) return 'transient';
  return 'permanent';
}

export interface Rule {
  tag: string;
  status: number;
  times?: number;
}

export class Receiver {
  readonly rules: Rule[] = [];
  readonly inbox = new Map<string, { count: number; signatureValid: boolean; lastStatus: number }>();
  private readonly hits = new Map<string, number>();
  private readonly rng: Prng;
  private readonly secrets: Record<string, string> = { crm: 'crm-dev-secret', billing: 'billing-dev-secret' };

  constructor(rng: Prng) {
    this.rng = rng;
  }

  addRule(rule: Rule): void {
    this.rules.push(rule);
  }

  clearRules(): void {
    this.rules.length = 0;
    this.hits.clear();
  }

  // A rule with `times` counts per idempotency key, so retries eventually pass.
  private injected(tag: string | null, key: string): number | null {
    if (tag === null) return null;
    for (let i = 0; i < this.rules.length; i++) {
      const rule = this.rules[i];
      if (rule.tag !== tag) continue;
      const hitKey = `${i}:${key}`;
      const hits = this.hits.get(hitKey) ?? 0;
      if (rule.times !== undefined && hits >= rule.times) continue;
      this.hits.set(hitKey, hits + 1);
      return rule.status;
    }
    return null;
  }

  // POST /hooks/{name}
  hook(name: string, body: string, headers: Record<string, string>, nowMs: number): { status: number; duration: number } {
    const duration = Math.round(this.rng.uniform(55, 135));
    const key = headers[IDEMPOTENCY_HEADER];
    if (!key) return { status: 400, duration };
    const record = (signatureValid: boolean, lastStatus: number) => {
      const entry = this.inbox.get(key) ?? { count: 0, signatureValid, lastStatus };
      entry.count += 1;
      entry.signatureValid = signatureValid;
      entry.lastStatus = lastStatus;
      this.inbox.set(key, entry);
    };
    const check = verifySignature(this.secrets[name] ?? '', headers[TIMESTAMP_HEADER], headers[SIGNATURE_HEADER], body, 300, Math.floor(nowMs / 1000));
    if (!check.ok) {
      record(false, 401);
      return { status: 401, duration };
    }
    let tag: string | null = null;
    const envelope = parseJson(body);
    if (envelope && typeof envelope === 'object' && !Array.isArray(envelope)) {
      const payload = envelope['payload'];
      if (payload && typeof payload === 'object' && !Array.isArray(payload) && typeof payload['tag'] === 'string') tag = payload['tag'];
    }
    const status = this.injected(tag, key) ?? 200;
    record(true, status);
    return { status, duration };
  }
}

export class Worker {
  readonly batchSize = 50;
  readonly concurrency = 8;
  private readonly db: Database;
  private readonly receiver: Receiver;
  private readonly clock: VirtualClock;

  constructor(db: Database, receiver: Receiver, clock: VirtualClock) {
    this.db = db;
    this.receiver = receiver;
    this.clock = clock;
  }

  // Pending rows that are due, oldest first, marked in_progress.
  claim(now: number): string[] {
    const due = [...this.db.deliveries.values()]
      .filter((d) => d.status === 'pending' && d.next_attempt_at !== null && d.next_attempt_at <= now)
      .sort((a, b) => (a.next_attempt_at ?? 0) - (b.next_attempt_at ?? 0))
      .slice(0, this.batchSize);
    for (const d of due) {
      d.status = 'in_progress';
      d.updated_at = now;
    }
    return due.map((d) => d.id);
  }

  process(deliveryId: string, now: number): DeliveryStatus | 'missing' {
    const delivery = this.db.deliveries.get(deliveryId);
    if (!delivery) return 'missing';
    const event = this.db.events.get(delivery.event_id);
    const destination = DESTINATIONS.find((d) => d.name === delivery.destination);
    if (!event || !destination) {
      delivery.status = 'failed';
      delivery.last_error = event ? 'unknown destination' : 'event missing';
      return delivery.status;
    }
    const attemptNumber = delivery.attempts + 1;
    const envelope: Json = {
      event_id: event.id,
      source: event.source,
      event_key: event.event_key,
      received_at: this.clock.iso(event.received_at),
      destination: delivery.destination,
      payload: event.payload !== null ? event.payload : event.raw_body,
    };
    const body = canonicalJson(envelope);
    const headers = signHeaders(destination.secret, body, Math.floor(now / 1000));
    headers[IDEMPOTENCY_HEADER] = delivery.idempotency_key;
    headers[EVENT_ID_HEADER] = delivery.event_id;
    const response = this.receiver.hook(destination.name, body, headers, now);
    const statusCode = response.status;
    const error = statusCode < 200 || statusCode >= 300 ? `HTTP ${statusCode}` : null;
    const outcome = classify(statusCode);
    const finishedAt = now + response.duration;
    const attempt: AttemptRow = { delivery_id: delivery.id, attempt_number: attemptNumber, started_at: now, duration_ms: response.duration, status_code: statusCode, outcome, error, backoff_ms: null };
    this.db.attempts.push(attempt);
    delivery.attempts = attemptNumber;
    delivery.last_status_code = statusCode;
    delivery.last_error = error;
    delivery.updated_at = finishedAt;
    if (outcome === 'success') {
      delivery.status = 'delivered';
      delivery.delivered_at = finishedAt;
      delivery.next_attempt_at = null;
      delivery.latency_ms = Math.max(finishedAt - delivery.created_at, 0);
    } else if (outcome === 'transient' && attemptNumber < delivery.max_attempts) {
      const delayMs = Math.round(jitteredBackoff(destination.retry, attemptNumber, this.db.rng) * 1000);
      attempt.backoff_ms = delayMs;
      delivery.status = 'pending';
      delivery.next_attempt_at = finishedAt + delayMs;
    } else {
      delivery.status = 'failed';
      delivery.next_attempt_at = null;
      if (outcome === 'transient') delivery.last_error = `${error}; retries exhausted after ${attemptNumber} attempts`;
    }
    return delivery.status;
  }

  // Claim one batch and run it in waves of `concurrency`; the clock moves by
  // the slowest request in each wave, the way a thread pool would.
  runOnce(now: number = this.clock.now()): number {
    const ids = this.claim(now);
    let waveStart = now;
    for (let offset = 0; offset < ids.length; offset += this.concurrency) {
      let slowest = 0;
      for (const id of ids.slice(offset, offset + this.concurrency)) {
        this.process(id, waveStart);
        const row = this.db.deliveries.get(id);
        if (row) slowest = Math.max(slowest, row.updated_at - waveStart);
      }
      waveStart += slowest;
    }
    this.clock.set(waveStart);
    return ids.length;
  }

  drain(maxBatches = 100): number {
    let total = 0;
    for (let i = 0; i < maxBatches; i++) {
      const processed = this.runOnce(this.clock.now());
      if (processed === 0) break;
      total += processed;
    }
    return total;
  }

  nextDue(): number | null {
    let next = Infinity;
    for (const d of this.db.deliveries.values()) {
      if ((d.status === 'pending' || d.status === 'in_progress') && d.next_attempt_at !== null) next = Math.min(next, d.next_attempt_at);
    }
    return Number.isFinite(next) ? next : null;
  }

  openCount(): number {
    let n = 0;
    for (const d of this.db.deliveries.values()) if (d.status === 'pending' || d.status === 'in_progress') n++;
    return n;
  }
}
