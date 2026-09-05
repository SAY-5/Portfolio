// Port of failsafe/upstreams.py: the replica pool with an active health
// checker (interval 1 s, one failed probe pulls a replica, one passed probe
// restores it) plus the passive path where a connection error pulls the
// replica immediately instead of waiting for the next probe.

import { CircuitBreaker } from './breaker';

export interface HealthConfig {
  intervalMs: number;
  unhealthyThreshold: number;
  healthyThreshold: number;
}

export const DEFAULT_HEALTH: HealthConfig = {
  intervalMs: 1000,
  unhealthyThreshold: 1,
  healthyThreshold: 1,
};

export type PoolEventKind = 'kill' | 'start' | 'unhealthy' | 'healthy';

export interface PoolEvent {
  at: number;
  kind: PoolEventKind;
  replica: string;
}

export interface Replica {
  name: string;
  // Process is up; false between a kill and the restart.
  alive: boolean;
  // In rotation according to the health checker.
  healthy: boolean;
  restartAt: number | null;
  breaker: CircuitBreaker;
  served: number;
  probesFailed: number;
  probesPassed: number;
}

export class ReplicaPool {
  readonly replicas: Replica[];
  readonly events: PoolEvent[] = [];
  private nextProbeAt = 0;
  private rr = 0;

  readonly health: HealthConfig;

  constructor(names: string[], health: HealthConfig = DEFAULT_HEALTH) {
    this.health = health;
    this.replicas = names.map((name) => ({
      name,
      alive: true,
      healthy: true,
      restartAt: null,
      breaker: new CircuitBreaker(name),
      served: 0,
      probesFailed: 0,
      probesPassed: 0,
    }));
  }

  get(name: string): Replica | undefined {
    return this.replicas.find((r) => r.name === name);
  }

  private log(kind: PoolEventKind, replica: string, at: number): void {
    this.events.push({ at, kind, replica });
    if (this.events.length > 40) this.events.shift();
  }

  // SIGKILL the container; it restarts after restartAfterMs.
  kill(name: string, now: number, restartAfterMs: number): boolean {
    const r = this.get(name);
    if (!r || !r.alive) return false;
    r.alive = false;
    r.restartAt = now + restartAfterMs;
    this.log('kill', name, now);
    return true;
  }

  // Passive detection: a connection error is proof enough, no probe needed.
  markUnhealthy(r: Replica, now: number): void {
    if (!r.healthy) return;
    r.healthy = false;
    this.log('unhealthy', r.name, now);
  }

  tick(now: number): void {
    for (const r of this.replicas) {
      if (!r.alive && r.restartAt !== null && now >= r.restartAt) {
        r.alive = true;
        r.restartAt = null;
        this.log('start', r.name, now);
      }
    }
    if (now < this.nextProbeAt) return;
    this.nextProbeAt = now + this.health.intervalMs;
    for (const r of this.replicas) {
      if (r.alive) {
        r.probesPassed++;
        r.probesFailed = 0;
        if (!r.healthy && r.probesPassed >= this.health.healthyThreshold) {
          r.healthy = true;
          this.log('healthy', r.name, now);
        }
      } else {
        r.probesFailed++;
        r.probesPassed = 0;
        if (r.healthy && r.probesFailed >= this.health.unhealthyThreshold) {
          this.markUnhealthy(r, now);
        }
      }
    }
  }

  // Replicas the forwarder may try: in rotation and with an admitting breaker.
  candidates(now: number): Replica[] {
    return this.replicas.filter((r) => r.healthy && r.breaker.available(now));
  }

  // Round-robin over candidates, skipping replicas this request already tried.
  pick(now: number, exclude: ReadonlySet<string>): Replica | null {
    const pool = this.candidates(now).filter((r) => !exclude.has(r.name));
    if (pool.length === 0) return null;
    const r = pool[this.rr % pool.length];
    this.rr++;
    return r;
  }

  get healthyCount(): number {
    return this.replicas.filter((r) => r.healthy).length;
  }
}
