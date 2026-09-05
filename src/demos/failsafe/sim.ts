// Composes the chaos run with the two hands-on panels (a small token bucket
// and the per-replica breakers) on one simulated clock, and flattens the whole
// thing into a plain snapshot the component can render.

import type { BreakerState, Transition } from './breaker';
import { ChaosRun, type Summary } from './chaos';
import type { RequestOutcome } from './gateway';
import { TokenBucket } from './ratelimit';
import type { PoolEvent } from './upstreams';

export const SEED = 19;

export interface BucketSnap {
  capacity: number;
  refillPerSecond: number;
  tokens: number;
  allowed: number;
  limited: number;
  lastRetryAfterMs: number | null;
}

export interface BreakerSnap {
  state: BreakerState;
  outcomes: boolean[];
  consecutive: number;
  failureRate: number;
  requests: number;
  remainingOpenMs: number;
  transitions: Transition[];
}

export interface ReplicaSnap {
  name: string;
  alive: boolean;
  healthy: boolean;
  restartInMs: number;
  served: number;
  breaker: BreakerSnap;
}

export interface MetricRow {
  name: string;
  value: string;
  pinned?: boolean;
}

export interface Snap {
  now: number;
  running: boolean;
  finished: boolean;
  autoKill: boolean;
  replicas: ReplicaSnap[];
  summary: Summary;
  recent: RequestOutcome[];
  timeline: PoolEvent[];
  bucket: BucketSnap;
  breakerNote: string;
  metrics: MetricRow[];
}

export class DemoSim {
  readonly run = new ChaosRun(SEED);
  readonly bucket = new TokenBucket({ capacity: 20, refillPerSecond: 10 }, 0);
  private allowed = 0;
  private limited = 0;
  private lastRetryAfterMs: number | null = null;
  private breakerNote = 'record outcomes to drive the breaker';

  get now(): number {
    return this.run.now;
  }

  tick(dtMs: number): void {
    this.run.tick(dtMs);
  }

  setBucket(capacity: number, refillPerSecond: number): void {
    this.bucket.configure({ capacity, refillPerSecond }, this.now);
  }

  burst(n: number): void {
    for (let i = 0; i < n; i++) {
      const t = this.bucket.take(this.now);
      if (t.allowed) this.allowed++;
      else {
        this.limited++;
        this.lastRetryAfterMs = t.retryAfterMs;
      }
    }
  }

  breakerRecord(name: string, ok: boolean): void {
    const r = this.run.pool.get(name);
    if (!r) return;
    const b = r.breaker;
    if (!b.allow(this.now)) {
      this.breakerNote = `${name}: attempt rejected while ${b.state.replace('_', '-')}`;
      return;
    }
    const before = b.state;
    b.record(ok, this.now);
    this.breakerNote =
      before === b.state
        ? `${name}: ${ok ? 'success' : 'failure'} recorded, stays ${b.state.replace('_', '-')}`
        : `${name}: ${before.replace('_', '-')} to ${b.state.replace('_', '-')}`;
  }

  snapshot(): Snap {
    const now = this.now;
    this.bucket.refill(now);
    const replicas: ReplicaSnap[] = this.run.pool.replicas.map((r) => ({
      name: r.name,
      alive: r.alive,
      healthy: r.healthy,
      restartInMs: r.restartAt === null ? 0 : Math.max(0, r.restartAt - now),
      served: r.served,
      breaker: {
        state: r.breaker.state,
        outcomes: [...r.breaker.outcomes],
        consecutive: r.breaker.consecutive,
        failureRate: r.breaker.failureRate,
        requests: r.breaker.outcomes.length,
        remainingOpenMs: r.breaker.remainingOpenMs(now),
        transitions: [...r.breaker.transitions],
      },
    }));
    const m = this.run.gateway.metrics;
    const summary = this.run.summary();
    const metrics: MetricRow[] = [
      { name: 'failsafe_requests_total{route="/orders",status="200"}', value: String(m.requestsTotal['200'] ?? 0) },
      { name: 'failsafe_rate_limited_total{route="/orders"}', value: String(m.rateLimitedTotal) },
      { name: 'failsafe_retries_total{route="/orders",reason="connect"}', value: String(m.retriesTotal.connect) },
      { name: 'failsafe_failovers_total', value: String(m.failoversTotal) },
      ...replicas.map((r) => ({ name: `failsafe_breaker_state{upstream="${r.name}"}`, value: String(r.breaker.state === 'closed' ? 0 : r.breaker.state === 'half_open' ? 1 : 2) })),
      ...replicas.map((r) => ({ name: `failsafe_upstream_healthy{upstream="${r.name}"}`, value: r.healthy ? '1' : '0' })),
      { name: 'failsafe_breaker_transitions_total', value: String(summary.breakerTransitions) },
      { name: 'failsafe_client_failed_requests_total{route="/orders"}', value: String(m.clientFailedTotal), pinned: true },
    ];
    return {
      now,
      running: this.run.running,
      finished: this.run.finished,
      autoKill: this.run.autoKill,
      replicas,
      summary,
      recent: [...this.run.recent].reverse(),
      timeline: this.run.timeline(),
      bucket: {
        capacity: this.bucket.config.capacity,
        refillPerSecond: this.bucket.config.refillPerSecond,
        tokens: this.bucket.tokens,
        allowed: this.allowed,
        limited: this.limited,
        lastRetryAfterMs: this.lastRetryAfterMs,
      },
      breakerNote: this.breakerNote,
      metrics,
    };
  }
}
