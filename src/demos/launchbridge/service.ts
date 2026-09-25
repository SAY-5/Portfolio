// The service as one object: POST /webhooks/{source}, the admin replay routes
// and /stats over one database, with the worker and the receiver fake beside
// it. Responses carry the FastAPI status codes: 413 body too large, 202 new,
// 200 deduplicated, 401 bad or stale signature, 409 replayed signature.
import { utf8 } from './crypto';
import { DESTINATIONS, Receiver, Worker } from './delivery';
import {
  HEADER_LABEL,
  HMAC_LABEL,
  pyDumps,
  signHeaders,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  TIMESTAMP_LABEL,
  verifySignature,
  windowLabel,
  type Json,
  type StepId,
  type Verification,
  type VerifyStep,
} from './signing';
import { collectStats, Database, failedDeliveries, ingestEvent, Prng, replayDelivery, VirtualClock, type IngestResult, type Stats } from './store';

export const SECRETS: Record<string, string> = { smoke: 'smoke-dev-secret', demo: 'demo-dev-secret', orders: 'orders-dev-secret' };
export const TOLERANCE_SECONDS = 300;
// api.py MAX_BODY_BYTES: an oversized body is refused with 413 before the
// signature is read, so the size check is step 0 of the list.
export const MAX_BODY_BYTES = 1_000_000;

// The verification list in the order the service applies it; the page shows
// the same label before and after a send, only the detail column changes.
export const STEP_ORDER = ['size', 'timestamp', 'window', 'header', 'hmac', 'nonce', 'dedup'] as const satisfies readonly StepId[];
export const STEP_LABELS: Record<StepId, string> = {
  size: `body <= ${MAX_BODY_BYTES.toLocaleString('en-US')} bytes (413 before verification)`,
  timestamp: TIMESTAMP_LABEL,
  window: windowLabel(TOLERANCE_SECONDS),
  header: HEADER_LABEL,
  hmac: HMAC_LABEL,
  nonce: 'signature_nonces INSERT ON CONFLICT DO NOTHING (409 on repeat)',
  dedup: 'INSERT processed_events ON CONFLICT (source, event_key) DO NOTHING',
};

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
    // raw_body(): the declared length is checked before the route runs, so an
    // oversized request never reaches signature verification and records no
    // rejection row.
    const bytes = utf8(req.body).length;
    if (bytes > MAX_BODY_BYTES) {
      const size: VerifyStep = { id: 'size', label: STEP_LABELS.size, ok: false, detail: `body too large: ${bytes.toLocaleString('en-US')} bytes, refused before the signature is read` };
      const verification: Verification = { ok: false, timestamp: null, reason: null, detail: 'body too large', expected: null, steps: [] };
      return { status: 413, error: 'body too large', result: null, verification, steps: [size] };
    }
    const steps: VerifyStep[] = [{ id: 'size', label: STEP_LABELS.size, ok: true, detail: `${bytes.toLocaleString('en-US')} bytes` }];
    const signature = headers[SIGNATURE_HEADER.toLowerCase()];
    const verification = verifySignature(secret, headers[TIMESTAMP_HEADER.toLowerCase()], signature, req.body, TOLERANCE_SECONDS, Math.floor(now / 1000));
    steps.push(...verification.steps);
    if (!verification.ok) {
      this.db.rejections.push({ source: req.source, reason: verification.reason ?? 'invalid_signature', at: now });
      return { status: 401, error: verification.reason, result: null, verification, steps };
    }
    const recorded: Record<string, string> = {};
    if (headers['x-event-id']) recorded['x-event-id'] = headers['x-event-id'];
    const result = ingestEvent(this.db, { source: req.source, body: req.body, headers: recorded, signature: signature ?? '', now, destinations: DESTINATIONS });
    if (result.replayed) {
      this.db.rejections.push({ source: req.source, reason: 'replayed_signature', at: now });
      steps.push({ id: 'nonce', label: STEP_LABELS.nonce, ok: false, detail: 'replayed_signature: signature already in signature_nonces' });
      return { status: 409, error: 'replayed_signature', result: null, verification, steps };
    }
    steps.push({ id: 'nonce', label: STEP_LABELS.nonce, ok: true, detail: 'new signature, nonce inserted' });
    steps.push({
      id: 'dedup',
      label: STEP_LABELS.dedup,
      ok: true,
      detail: result.deduplicated ? `${result.event_key} already in the ledger, deduplicated` : `${result.event_key} inserted, ${result.delivery_ids.length} of ${result.decisions.length} destinations matched`,
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
