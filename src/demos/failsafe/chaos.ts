// Port of chaos/run.py and chaos/kill.sh on a simulated clock: an open-loop
// generator at a fixed rate, a kill script that SIGKILLs a replica and starts
// it again a few seconds later, and a summary that counts every client-visible
// outcome. The run passes only if client-visible failed requests stays 0.

import { Gateway, type RequestOutcome } from './gateway';
import { mulberry32 } from './prng';
import { TokenBucket } from './ratelimit';
import { DEFAULT_RETRY } from './retry';
import { ReplicaPool, type PoolEvent } from './upstreams';

export interface ChaosConfig {
  rps: number;
  durationMs: number;
  totalRequests: number;
  restartAfterMs: number;
  autoKillAtMs: number[];
}

export const CHAOS: ChaosConfig = {
  rps: 150,
  durationMs: 45_000,
  // The generator's final tick fires during shutdown, so a 45 s run at 150 rps
  // reports 6751 requests, the same figure as the measured run.
  totalRequests: 6751,
  restartAfterMs: 3000,
  autoKillAtMs: [8300, 19400, 29200, 38600],
};

export const REPLICAS = ['upstream-1', 'upstream-2', 'upstream-3'];

export interface Summary {
  total: number;
  ok: number;
  rateLimited: number;
  clientFailed: number;
  retries: Record<string, number>;
  retriesTotal: number;
  failovers: number;
  breakerTransitions: number;
  kills: number;
  p50: number;
  p95: number;
  maxMs: number;
  elapsedMs: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)));
  return sorted[idx];
}

export class ChaosRun {
  now = 0;
  running = false;
  finished = false;
  startedAt = 0;
  sent = 0;
  kills = 0;
  autoKill = true;
  readonly pool: ReplicaPool;
  readonly gateway: Gateway;
  readonly recent: RequestOutcome[] = [];
  private latencies: number[] = [];
  private acc = 0;
  private autoIdx = 0;
  private readonly rnd: () => number;

  constructor(seed: number) {
    this.rnd = mulberry32(seed);
    this.pool = new ReplicaPool(REPLICAS);
    const bucket = new TokenBucket({ capacity: 200, refillPerSecond: 400 }, 0);
    this.gateway = new Gateway(this.pool, bucket, DEFAULT_RETRY, this.rnd);
  }

  get elapsedMs(): number {
    return this.running || this.finished ? this.now - this.startedAt : 0;
  }

  start(): void {
    this.running = true;
    this.finished = false;
    this.startedAt = this.now;
    this.sent = 0;
    this.kills = 0;
    this.acc = 0;
    this.autoIdx = 0;
    this.latencies = [];
    this.recent.length = 0;
    this.pool.events.length = 0;
    this.gateway.resetMetrics();
    for (const r of this.pool.replicas) r.served = 0;
  }

  kill(name: string): boolean {
    const killed = this.pool.kill(name, this.now, CHAOS.restartAfterMs);
    if (killed) this.kills++;
    return killed;
  }

  randomKill(): string | null {
    const alive = this.pool.replicas.filter((r) => r.alive);
    if (alive.length === 0) return null;
    const r = alive[Math.floor(this.rnd() * alive.length)];
    return this.kill(r.name) ? r.name : null;
  }

  private send(): void {
    const out = this.gateway.handle(this.now);
    this.sent++;
    this.latencies.push(out.latencyMs);
    const notable = out.retries.length > 0 || out.status !== 200;
    if (notable) {
      this.recent.push(out);
      const idx = this.recent.findIndex((o) => o.retries.length === 0 && o.status === 200);
      if (this.recent.length > 8) this.recent.splice(idx >= 0 ? idx : 0, 1);
      return;
    }
    // Keep a few plain successes in view so the list reads as a stream.
    if (this.sent % 97 === 0 || this.recent.length < 3) {
      const plain = this.recent.filter((o) => o.retries.length === 0 && o.status === 200);
      if (plain.length >= 3) this.recent.splice(this.recent.indexOf(plain[0]), 1);
      this.recent.push(out);
      if (this.recent.length > 8) this.recent.shift();
    }
  }

  // Advance the simulated clock in 10 ms steps so probes, restarts, and
  // request arrivals interleave in order.
  tick(dtMs: number): void {
    const target = this.now + dtMs;
    while (this.now < target) {
      this.now += 10;
      this.pool.tick(this.now);
      if (!this.running) continue;
      const elapsed = this.now - this.startedAt;
      if (this.autoKill && this.autoIdx < CHAOS.autoKillAtMs.length && elapsed >= CHAOS.autoKillAtMs[this.autoIdx]) {
        this.autoIdx++;
        this.randomKill();
      }
      this.acc += (CHAOS.rps * 10) / 1000;
      while (this.acc >= 1 && this.sent < CHAOS.totalRequests) {
        this.acc -= 1;
        this.send();
      }
      if (elapsed >= CHAOS.durationMs) {
        while (this.sent < CHAOS.totalRequests) this.send();
        this.running = false;
        this.finished = true;
      }
    }
  }

  timeline(): PoolEvent[] {
    return this.pool.events.filter((e) => e.kind === 'kill' || e.kind === 'start');
  }

  summary(): Summary {
    const m = this.gateway.metrics;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const retries: Record<string, number> = {};
    let retriesTotal = 0;
    for (const [reason, n] of Object.entries(m.retriesTotal)) {
      if (n > 0) retries[reason] = n;
      retriesTotal += n;
    }
    return {
      total: this.sent,
      ok: m.requestsTotal['200'] ?? 0,
      rateLimited: m.rateLimitedTotal,
      clientFailed: m.clientFailedTotal,
      retries,
      retriesTotal,
      failovers: m.failoversTotal,
      breakerTransitions: this.pool.replicas.reduce((n, r) => n + r.breaker.transitions.length, 0),
      kills: this.kills,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      maxMs: sorted.length ? sorted[sorted.length - 1] : 0,
      elapsedMs: this.elapsedMs,
    };
  }
}
