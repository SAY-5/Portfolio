// Port of conduit/core/ratelimit.py and conduit/core/breaker.py. The token
// bucket paces one connector's sends and absorbs Retry-After pauses; the
// breaker stops the connector polling while its target looks down, so queued
// messages keep their receive count instead of burning it on an outage.

export class TokenBucket {
  readonly rate: number;
  readonly capacity: number;
  readonly maxPenalty: number;
  tokens: number;
  notBefore: number;
  private updated: number;
  private readonly clock: () => number;

  constructor(rate: number, burst: number, maxPenalty: number, clock: () => number) {
    this.rate = rate;
    this.capacity = burst;
    this.maxPenalty = maxPenalty;
    this.clock = clock;
    this.tokens = burst;
    this.updated = clock();
    this.notBefore = this.updated;
  }

  private refill(): number {
    const now = this.clock();
    this.tokens = Math.min(this.capacity, this.tokens + Math.max(0, now - this.updated) * this.rate);
    this.updated = now;
    return now;
  }

  // Reserve one token and return the seconds the send must wait. Tokens go
  // negative while reservations are outstanding, which keeps sends 1/rate apart
  // once the burst is spent.
  acquire(): number {
    const now = this.refill();
    const wait = this.tokens >= 1 ? 0 : (1 - this.tokens) / this.rate;
    this.tokens -= 1;
    return Math.max(wait, this.notBefore - now, 0);
  }

  // A 429 with Retry-After pauses every send on the connector, capped.
  penalize(seconds: number): number {
    const pause = Math.min(Math.max(0, seconds), this.maxPenalty);
    this.notBefore = Math.max(this.notBefore, this.clock() + pause);
    return pause;
  }

  level(): number {
    this.refill();
    return this.tokens;
  }
}

export type BreakerState = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  readonly failureThreshold: number;
  readonly recoverySeconds: number;
  failures = 0;
  opens = 0;
  private openedAt: number | null = null;
  private probing = false;
  private readonly clock: () => number;

  constructor(failureThreshold: number, recoverySeconds: number, clock: () => number) {
    this.failureThreshold = failureThreshold;
    this.recoverySeconds = recoverySeconds;
    this.clock = clock;
  }

  get state(): BreakerState {
    if (this.openedAt === null) return 'closed';
    return this.clock() - this.openedAt >= this.recoverySeconds ? 'half_open' : 'open';
  }

  remaining(): number {
    return this.openedAt === null ? 0 : Math.max(0, this.recoverySeconds - (this.clock() - this.openedAt));
  }

  // Half-open admits exactly one probe.
  allow(): boolean {
    const state = this.state;
    if (state === 'closed') return true;
    if (state === 'open' || this.probing) return false;
    this.probing = true;
    return true;
  }

  recordSuccess(): boolean {
    const wasOpen = this.openedAt !== null;
    this.failures = 0;
    this.openedAt = null;
    this.probing = false;
    return wasOpen;
  }

  // True when this failure opened the breaker; a failed probe reopens it at once.
  recordFailure(): boolean {
    this.failures += 1;
    if (!this.probing && this.failures < this.failureThreshold) return false;
    this.openedAt = this.clock();
    this.probing = false;
    this.failures = 0;
    this.opens += 1;
    return true;
  }
}

// 5xx, timeouts and connection errors mean the target is unwell; 429 is throttling.
export const isTargetFailure = (status: number | null) => status !== 429;
