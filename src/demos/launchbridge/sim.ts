// Composes the signed-webhook bench, the delivery attempt timeline and the
// burst run over two in-process services on virtual clocks, and flattens them
// into a plain snapshot the component renders. The bench clock moves only
// while a delivery is open and by one second per action, so a click sequence
// signs the same bytes every time it is repeated.
import { BURST, runBurst, type BurstProgress } from './burst';
import { baseBackoff, DESTINATIONS, envelopeContext, renderPayload } from './delivery';
import { describeTransform, isIdentity, type RouteDecision } from './routing';
import { MAX_BODY_BYTES, Service, TOLERANCE_SECONDS, type SignedRequest, type WebhookResponse } from './service';
import { canonicalJson, type Json, type VerifyStep } from './signing';
import type { DeliveryRow, DeliveryStatus } from './store';

export const BENCH = {
  source: 'orders',
  eventType: 'order.created',
  seed: 7,
  burstSeed: 0x5eed,
  wrongSecret: 'not-the-secret',
  staleSeconds: 3600,
  tolerance: TOLERANCE_SECONDS,
  bodyLimit: MAX_BODY_BYTES,
  secondsPerAction: 1,
};

export interface Tamper {
  flipByte: boolean;
  wrongSecret: boolean;
  stale: boolean;
  oversize: boolean;
}

export interface ExchangeSnap {
  label: string;
  status: number;
  error: string | null;
  steps: VerifyStep[];
  timestamp: string;
  signature: string;
  body: string;
  bodyBytes: number;
  flipped: string | null;
  expected: string | null;
  deliveries: number;
  decisions: RouteDecision[];
}

export interface AttemptSnap {
  n: number;
  status: number | null;
  outcome: string;
  offsetMs: number;
  durationMs: number;
  backoffMs: number | null;
  baseMs: number | null;
}

export interface TimelineSnap {
  id: string;
  label: string;
  destination: string;
  status: DeliveryStatus;
  series: number;
  maxAttempts: number;
  key: string;
  attempts: AttemptSnap[];
  nextInMs: number | null;
  replayOf: string | null;
  payload: string;
  transform: string | null;
}

export interface Choice {
  id: string;
  label: string;
  status: DeliveryStatus;
}

export interface BridgeSnap {
  nextPayload: string;
  typed: boolean;
  down: boolean;
  last: ExchangeSnap | null;
  canReplay: boolean;
  ledger: { key: string; signature: string; event: string }[];
  counts: { accepted: number; deduplicated: number; rejected: Record<string, number>; failed: number; open: number };
  choices: Choice[];
  timeline: TimelineSnap | null;
  burst: BurstProgress | null;
  burstRunning: boolean;
}

function flipOneByte(body: string): { body: string; note: string } {
  const at = body.indexOf('"amount": ') + '"amount": '.length;
  const before = body.charCodeAt(at);
  const after = before ^ 0x01;
  return {
    body: body.slice(0, at) + String.fromCharCode(after) + body.slice(at + 1),
    note: `byte ${at}: 0x${before.toString(16)} '${body[at]}' to 0x${after.toString(16)} '${String.fromCharCode(after)}'`,
  };
}

// Grow the body past the service's limit after signing. api.py refuses the
// declared length before the signature is read, so what the padding holds
// never matters; the signature shown is the one computed over the unpadded body.
function padBody(body: string): string {
  const filler = 'x'.repeat(MAX_BODY_BYTES - body.length + 1);
  return `${body.slice(0, -1)}, "pad": "${filler}"}`;
}

function shown(body: string, bytes: number): string {
  return body.length > 160 ? `${body.slice(0, 120)} ... (${bytes.toLocaleString('en-US')} bytes)` : body;
}

export class BridgeSim {
  bench = new Service(BENCH.seed);
  burstService = new Service(BENCH.burstSeed);
  version = 0;
  down = false;
  typed = true;
  selected: string | null = null;
  private seq = 1001;
  private last: ExchangeSnap | null = null;
  private lastAccepted: { request: SignedRequest; payload: Json } | null = null;
  private burst: Generator<BurstProgress, BurstProgress, void> | null = null;
  private progress: BurstProgress | null = null;

  private payload(): Record<string, Json> {
    const p: Record<string, Json> = { id: `order-${this.seq}` };
    if (this.typed) p.type = BENCH.eventType;
    p.amount = 20 + ((this.seq * 37) % 180);
    if (this.down) p.tag = 'down';
    return p;
  }

  private record(label: string, request: SignedRequest, response: WebhookResponse, flipped: string | null, payload: Json): void {
    const bodyBytes = new TextEncoder().encode(request.body).length;
    this.last = {
      label,
      status: response.status,
      error: response.error,
      steps: response.steps,
      timestamp: request.headers['X-Timestamp'] ?? '',
      signature: request.headers['X-Signature'] ?? '',
      body: shown(request.body, bodyBytes),
      bodyBytes,
      flipped,
      expected: response.verification.expected,
      deliveries: response.result?.delivery_ids.length ?? 0,
      decisions: response.result?.decisions ?? [],
    };
    // A deduplicated request is kept as well: its signature is in the nonce
    // store, so replaying it is the 409 the service gives.
    if (response.status === 202 || response.status === 200) this.lastAccepted = { request, payload };
    const first = response.result?.delivery_ids[0];
    if (first) this.selected = first;
    this.version++;
  }

  // Every action moves the bench clock by a fixed second, so timestamps and
  // signatures depend on the click sequence, not on how long the tab was open.
  private step(): void {
    this.bench.clock.advance(BENCH.secondsPerAction * 1000);
  }

  // Sign a new event, then apply whatever tampering is switched on.
  send(t: Tamper): void {
    this.step();
    const payload = this.payload();
    this.seq++;
    const request = this.bench.sign(BENCH.source, payload, {
      secret: t.wrongSecret ? BENCH.wrongSecret : undefined,
      timestamp: t.stale ? this.bench.clock.seconds() - BENCH.staleSeconds : undefined,
    });
    let flipped: string | null = null;
    if (t.flipByte) {
      const f = flipOneByte(request.body);
      request.body = f.body;
      flipped = f.note;
    }
    if (t.oversize) request.body = padBody(request.body);
    const label =
      [t.oversize && 'body padded past the limit', t.flipByte && 'byte flipped', t.wrongSecret && 'wrong secret', t.stale && 'stale timestamp'].filter(Boolean).join(', ') || 'signed';
    this.record(`new event, ${label}`, request, this.bench.webhook(request), flipped, payload);
  }

  // The last accepted or deduplicated request, byte for byte, headers and signature included.
  replay(): void {
    if (!this.lastAccepted) return;
    this.step();
    const { request, payload } = this.lastAccepted;
    const skew = this.bench.clock.seconds() - Number(request.headers['X-Timestamp'] ?? 0);
    const label = skew > BENCH.tolerance ? `replayed request, same signature, captured ${skew} s ago, outside the ${BENCH.tolerance} s window` : 'replayed request, same signature';
    this.record(label, request, this.bench.webhook(request), null, payload);
  }

  // The same event a second later: a fresh signature over the same id.
  resend(): void {
    if (!this.lastAccepted) return;
    this.step();
    const payload = this.lastAccepted.payload;
    const request = this.bench.sign(BENCH.source, payload);
    this.record('same event id, fresh signature', request, this.bench.webhook(request), null, payload);
  }

  setTyped(on: boolean): void {
    this.typed = on;
    this.version++;
  }

  setDown(on: boolean): void {
    this.down = on;
    this.bench.receiver.clearRules();
    if (on) this.bench.receiver.addRule({ tag: 'down', status: 503 });
    this.version++;
  }

  replayFailed(): number {
    this.step();
    const ids = this.bench.replayBulk({ source: BENCH.source }, 'destination repaired');
    if (ids[0]) this.selected = ids[0];
    this.version++;
    return ids.length;
  }

  select(id: string): void {
    this.selected = id;
    this.version++;
  }

  startBurst(): void {
    this.burstService = new Service(BENCH.burstSeed);
    this.burst = runBurst(this.burstService);
    this.progress = null;
    this.version++;
  }

  // The bench clock advances only while a delivery is open, so an idle tab
  // does not age a captured request out of the timestamp window.
  tick(benchMs: number, burstSteps: number): void {
    if (this.bench.worker.openCount() > 0) {
      this.bench.advance(benchMs);
      this.version++;
    }
    if (!this.burst) return;
    for (let i = 0; i < burstSteps && this.burst; i++) {
      const r = this.burst.next();
      this.progress = r.value;
      if (r.done) {
        this.burst = null;
        this.selectBurstSample();
      }
    }
    this.version++;
  }

  private burstSamples(): Choice[] {
    const p = this.progress;
    if (!p) return [];
    const db = this.burstService.db;
    const tagOf = (d: DeliveryRow) => {
      const payload = db.events.get(d.event_id)?.payload;
      return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload['tag'] : undefined;
    };
    const rows = [...db.deliveries.values()];
    const flaky = rows.find((d) => tagOf(d) === p.flakyTag);
    const hard = rows.find((d) => tagOf(d) === p.hardTag && d.replay_of === null);
    const replay = hard ? rows.find((d) => d.replay_of === hard.id) : undefined;
    const plain = rows.find((d) => tagOf(d) === undefined);
    const out: Choice[] = [];
    if (plain) out.push({ id: plain.id, label: 'burst: plain', status: plain.status });
    if (flaky) out.push({ id: flaky.id, label: 'burst: 503 twice', status: flaky.status });
    if (hard) out.push({ id: hard.id, label: 'burst: 400', status: hard.status });
    if (replay) out.push({ id: replay.id, label: 'burst: 400, replayed', status: replay.status });
    return out;
  }

  private selectBurstSample(): void {
    const flaky = this.burstSamples().find((c) => c.label === 'burst: 503 twice');
    if (flaky) this.selected = flaky.id;
  }

  private timeline(id: string, label: string): TimelineSnap | null {
    const svc = this.bench.db.deliveries.has(id) ? this.bench : this.burstService;
    const d = svc.db.deliveries.get(id);
    if (!d) return null;
    const destination = DESTINATIONS.find((x) => x.name === d.destination);
    const event = svc.db.events.get(d.event_id);
    const policy = destination?.retry;
    return {
      id: d.id,
      label,
      destination: d.destination,
      status: d.status,
      series: d.series,
      maxAttempts: d.max_attempts,
      key: d.idempotency_key,
      attempts: svc.db.attemptsFor(d.id).map((a) => ({
        n: a.attempt_number,
        status: a.status_code,
        outcome: a.outcome,
        offsetMs: a.started_at - d.created_at,
        durationMs: a.duration_ms,
        backoffMs: a.backoff_ms,
        baseMs: a.backoff_ms !== null && policy ? Math.round(baseBackoff(policy, a.attempt_number) * 1000) : null,
      })),
      nextInMs: d.status === 'pending' && d.next_attempt_at !== null ? Math.max(0, d.next_attempt_at - svc.clock.now()) : null,
      replayOf: d.replay_of,
      payload: destination && event ? canonicalJson(renderPayload(destination, event, envelopeContext(event, svc.clock))) : '',
      transform: destination && !isIdentity(destination.transform) ? describeTransform(destination.transform) : null,
    };
  }

  snapshot(): BridgeSnap {
    const db = this.bench.db;
    const benchChoices: Choice[] = [...db.deliveries.values()]
      .slice(-6)
      .reverse()
      .map((d) => {
        const event = db.events.get(d.event_id);
        const id = event?.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? String(event.payload['id']) : 'event';
        return { id: d.id, label: `${id} to ${d.destination}${d.series > 1 ? `, series ${d.series}` : ''}`, status: d.status };
      });
    const choices = [...benchChoices, ...this.burstSamples()];
    const selected = choices.find((c) => c.id === this.selected) ?? choices[0];
    const rejected: Record<string, number> = {};
    for (const r of db.rejections) rejected[r.reason] = (rejected[r.reason] ?? 0) + 1;
    const events = [...db.events.values()];
    return {
      nextPayload: JSON.stringify(this.payload()).replace(/,/g, ', ').replace(/:/g, ': '),
      typed: this.typed,
      down: this.down,
      last: this.last,
      canReplay: this.lastAccepted !== null,
      ledger: [...db.ledger.values()].slice(-4).reverse().map((row) => ({ key: row.event_key, signature: row.signature.slice(7, 19), event: row.event_id.slice(0, 8) })),
      counts: {
        accepted: events.filter((e) => e.status === 'accepted').length,
        deduplicated: events.filter((e) => e.status === 'deduplicated').length,
        rejected,
        failed: [...db.deliveries.values()].filter((d) => d.status === 'failed').length,
        open: this.bench.worker.openCount(),
      },
      choices,
      timeline: selected ? this.timeline(selected.id, selected.label) : null,
      burst: this.progress,
      burstRunning: this.burst !== null,
    };
  }
}

export { BURST };
