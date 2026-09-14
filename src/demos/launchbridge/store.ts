// In-memory stand-in for the PostgreSQL schema, plus the seeded PRNG and the
// virtual clock. The dedup ledger enforces both unique constraints the way the
// database does: (source, event_key) is the ON CONFLICT arbiter that turns a
// repeat into a no-op, and signature raises an integrity error.
import { contentHash, parseJson, type Json } from './signing';

export class Prng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // random.uniform(a, b)
  uniform(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  hex(length: number): string {
    let out = '';
    while (out.length < length) out += Math.floor(this.next() * 16).toString(16);
    return out.slice(0, length);
  }

  uuid(): string {
    const h = this.hex(32).split('');
    h[12] = '4';
    h[16] = '89ab'[Math.floor(this.next() * 4)];
    const s = h.join('');
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  }
}

// 2026-09-08T12:00:00Z, a fixed epoch so every run is reproducible.
export const EPOCH_MS = Date.UTC(2026, 8, 8, 12, 0, 0);

export class VirtualClock {
  private ms = EPOCH_MS;

  now(): number {
    return this.ms;
  }

  seconds(): number {
    return Math.floor(this.ms / 1000);
  }

  advance(deltaMs: number): void {
    if (deltaMs > 0) this.ms += deltaMs;
  }

  set(ms: number): void {
    if (ms > this.ms) this.ms = ms;
  }

  iso(ms: number = this.ms): string {
    return new Date(ms).toISOString().replace('Z', '+00:00');
  }
}

export type DeliveryStatus = 'pending' | 'in_progress' | 'delivered' | 'failed' | 'replayed';

export interface EventRow {
  id: string;
  source: string;
  event_key: string;
  signature: string;
  payload: Json | null;
  raw_body: string;
  status: 'accepted' | 'deduplicated';
  received_at: number;
}

export interface LedgerRow {
  id: number;
  source: string;
  event_key: string;
  signature: string;
  event_id: string;
  processed_at: number;
}

export interface DeliveryRow {
  id: string;
  event_id: string;
  destination: string;
  idempotency_key: string;
  status: DeliveryStatus;
  series: number;
  attempts: number;
  max_attempts: number;
  next_attempt_at: number | null;
  last_status_code: number | null;
  last_error: string | null;
  replay_of: string | null;
  created_at: number;
  updated_at: number;
  delivered_at: number | null;
  latency_ms: number | null;
}

export interface AttemptRow {
  delivery_id: string;
  attempt_number: number;
  started_at: number;
  duration_ms: number;
  status_code: number | null;
  outcome: 'success' | 'transient' | 'permanent';
  error: string | null;
  backoff_ms: number | null;
}

export class Database {
  readonly events = new Map<string, EventRow>();
  readonly ledger = new Map<number, LedgerRow>();
  readonly deliveries = new Map<string, DeliveryRow>();
  readonly attempts: AttemptRow[] = [];
  readonly replays: { original: string; replacement: string; actor: string; mode: 'single' | 'bulk'; reason: string | null; at: number }[] = [];
  readonly rejections: { source: string; reason: string; at: number }[] = [];
  private readonly bySourceKey = new Map<string, number>();
  private readonly bySignature = new Map<string, number>();
  private serial = 0;
  readonly rng: Prng;

  constructor(rng: Prng) {
    this.rng = rng;
  }

  signatureSeen(signature: string): boolean {
    return this.bySignature.has(signature);
  }

  // INSERT ... ON CONFLICT (source, event_key) DO NOTHING RETURNING id.
  insertLedger(row: Omit<LedgerRow, 'id'>): number | null | 'integrity' {
    if (this.bySignature.has(row.signature)) return 'integrity';
    const key = `${row.source} ${row.event_key}`;
    if (this.bySourceKey.has(key)) return null;
    const id = ++this.serial;
    this.ledger.set(id, { ...row, id });
    this.bySourceKey.set(key, id);
    this.bySignature.set(row.signature, id);
    return id;
  }

  ledgerRow(source: string, eventKey: string): LedgerRow | null {
    const id = this.bySourceKey.get(`${source} ${eventKey}`);
    return id === undefined ? null : (this.ledger.get(id) ?? null);
  }

  attemptsFor(deliveryId: string): AttemptRow[] {
    return this.attempts.filter((a) => a.delivery_id === deliveryId).sort((a, b) => a.attempt_number - b.attempt_number);
  }
}

export interface Destination {
  name: string;
  secret: string;
  sources: string[];
  maxAttempts: number;
}

export interface IngestResult {
  event_id: string;
  event_key: string;
  deduplicated: boolean;
  delivery_ids: string[];
  replayed: boolean;
}

// Prefer an explicit event id header, then a payload id, then the content hash.
export function deriveEventKey(payload: Json | null, body: string, headerEventId: string | undefined): string {
  if (headerEventId) return `id:${headerEventId}`.slice(0, 255);
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const id = payload['id'];
    if (id !== undefined && id !== null && id !== '') return `id:${String(id)}`.slice(0, 255);
  }
  return `hash:${contentHash(body)}`;
}

// Record an inbound request and fan out deliveries unless it is a duplicate. A
// signature seen before is a replay, whichever constraint catches it.
export function ingestEvent(
  db: Database,
  input: { source: string; body: string; headers: Record<string, string>; signature: string; now: number; destinations: Destination[] },
): IngestResult {
  const { source, body, headers, signature, now } = input;
  if (db.signatureSeen(signature)) return { event_id: '', event_key: '', deduplicated: false, delivery_ids: [], replayed: true };
  const parsed = parseJson(body);
  const payload = parsed !== undefined && typeof parsed === 'object' ? parsed : null;
  const eventKey = deriveEventKey(payload, body, headers['x-event-id']);
  const event: EventRow = { id: db.rng.uuid(), source, event_key: eventKey, signature, payload, raw_body: body, status: 'accepted', received_at: now };
  db.events.set(event.id, event);
  const inserted = db.insertLedger({ source, event_key: eventKey, signature, event_id: event.id, processed_at: now });
  if (inserted === 'integrity') {
    db.events.delete(event.id);
    return { event_id: '', event_key: eventKey, deduplicated: false, delivery_ids: [], replayed: true };
  }
  if (inserted === null) {
    event.status = 'deduplicated';
    return { event_id: event.id, event_key: eventKey, deduplicated: true, delivery_ids: [], replayed: false };
  }
  const ids: string[] = [];
  for (const dest of input.destinations.filter((d) => d.sources.includes('*') || d.sources.includes(source))) {
    const row: DeliveryRow = {
      id: db.rng.uuid(),
      event_id: event.id,
      destination: dest.name,
      idempotency_key: `${event.id}:${dest.name}`,
      status: 'pending',
      series: 1,
      attempts: 0,
      max_attempts: dest.maxAttempts,
      next_attempt_at: now,
      last_status_code: null,
      last_error: null,
      replay_of: null,
      created_at: now,
      updated_at: now,
      delivered_at: null,
      latency_ms: null,
    };
    db.deliveries.set(row.id, row);
    ids.push(row.id);
  }
  return { event_id: event.id, event_key: eventKey, deduplicated: false, delivery_ids: ids, replayed: false };
}

// A new attempt series with the same idempotency key; the original is marked replayed.
export function replayDelivery(db: Database, delivery: DeliveryRow, actor: string, mode: 'single' | 'bulk', now: number, reason: string | null): DeliveryRow | null {
  if (delivery.status !== 'failed') return null;
  const replacement: DeliveryRow = {
    ...delivery,
    id: db.rng.uuid(),
    status: 'pending',
    series: delivery.series + 1,
    attempts: 0,
    next_attempt_at: now,
    last_status_code: null,
    last_error: null,
    replay_of: delivery.id,
    created_at: now,
    updated_at: now,
    delivered_at: null,
    latency_ms: null,
  };
  db.deliveries.set(replacement.id, replacement);
  delivery.status = 'replayed';
  delivery.updated_at = now;
  db.replays.push({ original: delivery.id, replacement: replacement.id, actor, mode, reason, at: now });
  return replacement;
}

export function failedDeliveries(db: Database, filter: { source?: string; since?: number; destination?: string; limit?: number }): DeliveryRow[] {
  return [...db.deliveries.values()]
    .filter((d) => {
      if (d.status !== 'failed') return false;
      const event = db.events.get(d.event_id);
      if (!event) return false;
      if (filter.source && event.source !== filter.source) return false;
      if (filter.since != null && event.received_at < filter.since) return false;
      return !filter.destination || d.destination === filter.destination;
    })
    .sort((a, b) => a.created_at - b.created_at)
    .slice(0, filter.limit ?? 500);
}

export interface Stats {
  events: { accepted: number; deduplicated: number; received: number };
  deliveries: Record<DeliveryStatus, number>;
  retries: number;
  replays: { requested: number; delivered: number };
  signature_rejections: number;
  latency_ms: { p50: number | null; p95: number | null };
}

// percentile_cont: linear interpolation between sorted values.
export function percentileCont(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] * (1 - (position - lower)) + sorted[upper] * (position - lower);
}

// GET /stats?source=&since=
export function collectStats(db: Database, filter: { source?: string; since?: number } = {}): Stats {
  const events = [...db.events.values()].filter((e) => (!filter.source || e.source === filter.source) && (filter.since == null || e.received_at >= filter.since));
  const eventIds = new Set(events.map((e) => e.id));
  const deliveries = [...db.deliveries.values()].filter((d) => eventIds.has(d.event_id));
  const deliveryIds = new Set(deliveries.map((d) => d.id));
  const byStatus: Record<DeliveryStatus, number> = { pending: 0, in_progress: 0, delivered: 0, failed: 0, replayed: 0 };
  let retried = 0;
  const latencies: number[] = [];
  for (const d of deliveries) {
    byStatus[d.status] += 1;
    retried += Math.max(d.attempts - 1, 0);
    if (d.status === 'delivered' && d.latency_ms !== null) latencies.push(d.latency_ms);
  }
  const accepted = events.filter((e) => e.status === 'accepted').length;
  const deduplicated = events.length - accepted;
  const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
  return {
    events: { accepted, deduplicated, received: accepted + deduplicated },
    deliveries: byStatus,
    retries: retried,
    replays: {
      requested: db.replays.filter((r) => deliveryIds.has(r.original)).length,
      delivered: deliveries.filter((d) => d.replay_of !== null && d.status === 'delivered').length,
    },
    signature_rejections: db.rejections.filter((r) => (!filter.source || r.source === filter.source) && (filter.since == null || r.at >= filter.since)).length,
    latency_ms: { p50: round1(percentileCont(latencies, 0.5)), p95: round1(percentileCont(latencies, 0.95)) },
  };
}
