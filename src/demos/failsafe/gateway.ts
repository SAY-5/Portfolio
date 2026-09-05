// Port of failsafe/proxy.py: route match, token bucket, then the forwarder
// loop. Each attempt picks a replica the pool still admits, a connection error
// pulls that replica and moves the attempt to another one (a failover), and
// only after max_attempts is exhausted does the client see a 5xx, which is the
// counter that must stay at 0 during chaos.

import { gaussian } from './prng';
import type { TokenBucket } from './ratelimit';
import { backoffMs, isRetryable, type FailureReason, type RetryPolicy } from './retry';
import type { Replica, ReplicaPool } from './upstreams';

export interface RequestOutcome {
  id: number;
  method: string;
  path: string;
  status: number;
  replica: string | null;
  attempts: number;
  retries: FailureReason[];
  failovers: Array<[string, string]>;
  latencyMs: number;
  retryAfterMs: number | null;
  clientFailed: boolean;
}

export interface GatewayMetrics {
  requestsTotal: Record<string, number>;
  retriesTotal: Record<FailureReason, number>;
  failoversTotal: number;
  rateLimitedTotal: number;
  clientFailedTotal: number;
}

function emptyMetrics(): GatewayMetrics {
  return {
    requestsTotal: {},
    retriesTotal: { connect: 0, timeout: 0, read: 0, status: 0 },
    failoversTotal: 0,
    rateLimitedTotal: 0,
    clientFailedTotal: 0,
  };
}

// Service time of one successful upstream call, fitted to the measured run
// (p50 3.2 ms, p95 5.1 ms): log-normal around 3.2 ms.
export function drawServiceMs(rnd: () => number): number {
  return Math.exp(Math.log(3.2) + 0.29 * gaussian(rnd));
}

export class Gateway {
  metrics: GatewayMetrics = emptyMetrics();
  private seq = 0;

  readonly pool: ReplicaPool;
  readonly bucket: TokenBucket | null;
  readonly policy: RetryPolicy;
  private readonly rnd: () => number;

  constructor(pool: ReplicaPool, bucket: TokenBucket | null, policy: RetryPolicy, rnd: () => number) {
    this.pool = pool;
    this.bucket = bucket;
    this.policy = policy;
    this.rnd = rnd;
  }

  resetMetrics(): void {
    this.metrics = emptyMetrics();
  }

  private count(status: number): void {
    const key = String(status);
    this.metrics.requestsTotal[key] = (this.metrics.requestsTotal[key] ?? 0) + 1;
  }

  handle(now: number, method = 'GET', path = '/orders/42'): RequestOutcome {
    const id = ++this.seq;
    const base = { id, method, path, retries: [] as FailureReason[], failovers: [] as Array<[string, string]> };
    if (this.bucket) {
      const t = this.bucket.take(now);
      if (!t.allowed) {
        this.metrics.rateLimitedTotal++;
        this.count(429);
        return { ...base, status: 429, replica: null, attempts: 0, latencyMs: 0.2, retryAfterMs: t.retryAfterMs, clientFailed: false };
      }
    }
    const tried = new Set<string>();
    let attempts = 0;
    let latency = 0;
    let prev: Replica | null = null;
    while (attempts < this.policy.maxAttempts) {
      const r = this.pool.pick(now, tried);
      if (!r) break;
      if (!r.breaker.allow(now)) {
        tried.add(r.name);
        continue;
      }
      attempts++;
      tried.add(r.name);
      if (prev && prev.name !== r.name) {
        base.failovers.push([prev.name, r.name]);
        this.metrics.failoversTotal++;
      }
      if (!r.alive) {
        // Connection refused: nothing reached the upstream, so any method retries.
        latency += 0.6;
        r.breaker.record(false, now);
        this.pool.markUnhealthy(r, now);
        if (attempts >= this.policy.maxAttempts || !isRetryable(method, 'connect', this.policy)) break;
        base.retries.push('connect');
        this.metrics.retriesTotal.connect++;
        latency += backoffMs(attempts - 1, this.policy, this.rnd);
        prev = r;
        continue;
      }
      r.breaker.record(true, now);
      r.served++;
      latency += drawServiceMs(this.rnd);
      this.count(200);
      return { ...base, status: 200, replica: r.name, attempts, latencyMs: latency, retryAfterMs: null, clientFailed: false };
    }
    this.metrics.clientFailedTotal++;
    this.count(502);
    return { ...base, status: 502, replica: prev?.name ?? null, attempts, latencyMs: latency, retryAfterMs: null, clientFailed: true };
  }
}
