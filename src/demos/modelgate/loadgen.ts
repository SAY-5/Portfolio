import { mulberry32, hexId, randInt } from './prng';
import { predict, type Version } from './model';
import { Registry } from './registry';
import { ShadowLog } from './shadow';
import { validate, type PredictInput, type Reason, type Rejection } from './validate';

// Open-loop load generator in simulated time: 200 requests per second for
// 20 s, every request valid, so anything that is not a 2xx counts as dropped.
// The engine also serves the request builder, whose rejections land in the
// same counters. All randomness comes from one seeded PRNG.

export const RPS = 200;
export const DURATION_MS = 20_000;

export type Bucket = { second: number; v1: number; v2: number };

export type Response =
  | { status: 200; body: { eta_minutes: number; model_version: Version; request_id: string }; shadowEta: number | null }
  | { status: 422; body: { error: string; rejections: Rejection[] } };

export type Snapshot = {
  now: number;
  running: boolean;
  finished: boolean;
  total: number;
  ok: number;
  rejected: number;
  dropped: number;
  buckets: Bucket[];
  byVersion: Record<Version, number>;
  rejections: Record<Reason, number>;
  swapBucket: number | null;
  swapLabel: string | null;
  shadowRequests: number;
};

export class Engine {
  readonly registry = new Registry();
  readonly shadow = new ShadowLog(1000);
  private rnd = mulberry32(7);
  private now = 0;
  private running = false;
  private total = 0;
  private ok = 0;
  private rejected = 0;
  private dropped = 0;
  private shadowRequests = 0;
  private buckets: Bucket[] = [];
  private byVersion: Record<Version, number> = { v1: 0, v2: 0 };
  private rejections: Record<Reason, number> = {
    out_of_range: 0,
    not_finite: 0,
    wrong_type: 0,
    unknown_zone: 0,
    unknown_field: 0,
    missing_field: 0,
    malformed_body: 0,
  };
  private swapBucket: number | null = null;
  private swapLabel: string | null = null;

  get time(): number {
    return this.now;
  }

  start(): void {
    if (this.now >= DURATION_MS) return;
    this.running = true;
  }

  pause(): void {
    this.running = false;
  }

  private sample(): PredictInput {
    const r = this.rnd;
    const distance = Math.round(Math.exp(1.0 + 1.6 * (r() + r() + r() - 1.5)) * 100) / 100;
    return {
      distance_km: Math.min(60, distance),
      hour_of_day: randInt(r, 0, 23),
      day_of_week: randInt(r, 0, 6),
      pickup_zone_id: randInt(r, 1, 12),
      traffic_index: Math.round(r() * 1000) / 1000,
      is_raining: r() < 0.2,
    };
  }

  // One request through the service: validate, capture the primary
  // reference, run the shadow, answer with the primary.
  handle(payload: Record<string, unknown>): Response {
    this.total++;
    const rejections = validate(payload);
    if (rejections.length > 0) {
      this.rejected++;
      for (const rej of rejections) this.rejections[rej.reason]++;
      return { status: 422, body: { error: 'invalid input', rejections } };
    }
    const x = payload as unknown as PredictInput;
    const primary = this.registry.primary;
    const eta = predict(primary, x);
    let shadowEta: number | null = null;
    const shadow = this.registry.shadow;
    if (shadow) {
      shadowEta = predict(shadow, x);
      this.shadow.record(eta, shadowEta);
      this.shadowRequests++;
    }
    this.ok++;
    this.byVersion[primary]++;
    const second = Math.floor(this.now / 1000);
    let b = this.buckets[this.buckets.length - 1];
    if (!b || b.second !== second) {
      b = { second, v1: 0, v2: 0 };
      this.buckets.push(b);
    }
    b[primary]++;
    return {
      status: 200,
      body: { eta_minutes: eta, model_version: primary, request_id: hexId(this.rnd, 12) },
      shadowEta,
    };
  }

  promote(): boolean {
    const target: Version = this.registry.primary === 'v1' ? 'v2' : 'v1';
    return this.registry.promote(target, this.now);
  }

  rollback(): boolean {
    const ok = this.registry.rollback(this.now);
    if (ok) {
      this.shadow.clear();
      const last = this.registry.swaps[this.registry.swaps.length - 1];
      this.swapBucket = Math.floor(this.now / 1000);
      this.swapLabel = `rollback ${last.from} -> ${last.to} at t+${(this.now / 1000).toFixed(3)}s`;
    }
    return ok;
  }

  // Advance simulated time by dtMs. Requests are spaced exactly 1000/RPS
  // apart; the registry is ticked between requests so a pending swap lands
  // right after the first request of a second has captured its reference,
  // which is the in-flight request the summary shows as the lone v1.
  tick(dtMs: number): void {
    if (!this.running) return;
    const target = Math.min(DURATION_MS, this.now + dtMs);
    const period = 1000 / RPS;
    while (this.now < target) {
      this.handle(this.sample() as unknown as Record<string, unknown>);
      this.now = Math.round((this.now + period) * 1000) / 1000;
      if (this.registry.tick(this.now)) {
        this.shadow.clear();
        const last = this.registry.swaps[this.registry.swaps.length - 1];
        this.swapBucket = Math.floor(this.now / 1000);
        this.swapLabel = `swap ${last.from} -> ${last.to} completed t+${(this.now / 1000).toFixed(3)}s`;
      }
    }
    if (this.now >= DURATION_MS) this.running = false;
  }

  snapshot(): Snapshot {
    return {
      now: this.now,
      running: this.running,
      finished: this.now >= DURATION_MS,
      total: this.total,
      ok: this.ok,
      rejected: this.rejected,
      dropped: this.dropped,
      buckets: this.buckets.slice(),
      byVersion: { ...this.byVersion },
      rejections: { ...this.rejections },
      swapBucket: this.swapBucket,
      swapLabel: this.swapLabel,
      shadowRequests: this.shadowRequests,
    };
  }
}
