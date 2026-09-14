// The service as one object: POST /webhooks/{source}, the admin replay routes
// and /stats over one database, with the worker and the receiver fake beside
// it. Responses carry the FastAPI status codes: 202 new, 200 deduplicated, 401
// bad or stale signature, 409 replayed signature.
import { DESTINATIONS, Receiver, Worker } from './delivery';
import { pyDumps, signHeaders, SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature, type Json, type Verification, type VerifyStep } from './signing';
import { collectStats, Database, failedDeliveries, ingestEvent, Prng, replayDelivery, VirtualClock, type IngestResult, type Stats } from './store';

export const SECRETS: Record<string, string> = { smoke: 'smoke-dev-secret', demo: 'demo-dev-secret', orders: 'orders-dev-secret' };
export const TOLERANCE_SECONDS = 300;

export interface SignedRequest {
  source: string;
  body: string;
  headers: Record<string, string>;
}

export interface WebhookResponse {
  status: number;
  error: string | null;
  result: IngestResult | null;
  verification: Verification;
  steps: VerifyStep[];
}

export class Service {
  readonly clock = new VirtualClock();
  readonly rng: Prng;
  readonly db: Database;
  readonly receiver: Receiver;
  readonly worker: Worker;

  constructor(seed: number) {
    this.rng = new Prng(seed);
    this.db = new Database(this.rng);
    this.receiver = new Receiver(this.rng);
    this.worker = new Worker(this.db, this.receiver, this.clock);
  }

  webhook(req: SignedRequest): WebhookResponse {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = v;
    const secret = SECRETS[req.source] ?? '';
    const now = this.clock.now();
    const signature = headers[SIGNATURE_HEADER.toLowerCase()];
    const verification = verifySignature(secret, headers[TIMESTAMP_HEADER.toLowerCase()], signature, req.body, TOLERANCE_SECONDS, Math.floor(now / 1000));
    const steps = [...verification.steps];
    if (!verification.ok) {
      this.db.rejections.push({ source: req.source, reason: verification.reason ?? 'invalid_signature', at: now });
      return { status: 401, error: verification.reason, result: null, verification, steps };
    }
    const recorded: Record<string, string> = {};
    if (headers['x-event-id']) recorded['x-event-id'] = headers['x-event-id'];
    const result = ingestEvent(this.db, { source: req.source, body: req.body, headers: recorded, signature: signature ?? '', now, destinations: DESTINATIONS });
    const nonceLabel = 'signature not accepted before (processed_events.signature unique)';
    if (result.replayed) {
      this.db.rejections.push({ source: req.source, reason: 'replayed_signature', at: now });
      steps.push({ id: 'nonce', label: nonceLabel, ok: false, detail: 'replayed_signature: signature already accepted' });
      return { status: 409, error: 'replayed_signature', result: null, verification, steps };
    }
    steps.push({ id: 'nonce', label: nonceLabel, ok: true, detail: 'new signature' });
    steps.push({
      id: 'dedup',
      label: 'INSERT processed_events ON CONFLICT (source, event_key) DO NOTHING',
      ok: true,
      detail: result.deduplicated ? `${result.event_key} already in the ledger, deduplicated` : `${result.event_key} inserted, ${result.delivery_ids.length} deliveries enqueued`,
    });
    return { status: result.deduplicated ? 200 : 202, error: null, result, verification, steps };
  }

  // Sign a JSON payload the way a source would.
  sign(source: string, payload: Json, opts: { secret?: string; timestamp?: number } = {}): SignedRequest {
    const body = pyDumps(payload);
    const headers = signHeaders(opts.secret ?? SECRETS[source] ?? '', body, opts.timestamp ?? this.clock.seconds());
    headers['Content-Type'] = 'application/json';
    return { source, body, headers };
  }

  post(source: string, payload: Json, opts: { secret?: string; timestamp?: number } = {}): WebhookResponse {
    return this.webhook(this.sign(source, payload, opts));
  }

  // POST /replay?source=&since=: every failed delivery gets a new series.
  replayBulk(filter: { source?: string; since?: number; destination?: string }, reason: string | null = null): string[] {
    const now = this.clock.now();
    return failedDeliveries(this.db, filter)
      .map((d) => replayDelivery(this.db, d, 'dev', 'bulk', now, reason))
      .filter((d) => d !== null)
      .map((d) => d.id);
  }

  stats(filter: { source?: string; since?: number } = {}): Stats {
    return collectStats(this.db, filter);
  }

  // Advance virtual time and let the worker poll whatever came due.
  advance(ms: number): void {
    this.clock.advance(ms);
    this.worker.drain();
  }
}
