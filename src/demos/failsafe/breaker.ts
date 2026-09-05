// Port of failsafe/breaker.py: one breaker per upstream replica. Closed while
// the failure window looks healthy, open for open_seconds after it trips,
// half-open with a bounded number of probes, then closed again on a success
// or straight back to open on a failure. Every change is a transition record,
// which is what failsafe_breaker_transitions_total counts.

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface BreakerConfig {
  window: number;
  failureRatio: number;
  minRequests: number;
  consecutiveFailures: number;
  openMs: number;
  halfOpenMax: number;
}

export const DEFAULT_BREAKER: BreakerConfig = {
  window: 20,
  failureRatio: 0.5,
  minRequests: 5,
  consecutiveFailures: 3,
  openMs: 3000,
  halfOpenMax: 2,
};

export interface Transition {
  from: BreakerState;
  to: BreakerState;
  at: number;
}

export class CircuitBreaker {
  state: BreakerState = 'closed';
  consecutive = 0;
  readonly transitions: Transition[] = [];
  private window: boolean[] = [];
  private openedAt = 0;
  private probes = 0;

  readonly name: string;
  readonly config: BreakerConfig;

  constructor(name: string, config: BreakerConfig = DEFAULT_BREAKER) {
    this.name = name;
    this.config = config;
  }

  get outcomes(): readonly boolean[] {
    return this.window;
  }

  get failures(): number {
    return this.window.filter((ok) => !ok).length;
  }

  get failureRate(): number {
    return this.window.length === 0 ? 0 : this.failures / this.window.length;
  }

  // failsafe_breaker_state: 0 closed, 1 half-open, 2 open.
  get gauge(): number {
    return this.state === 'closed' ? 0 : this.state === 'half_open' ? 1 : 2;
  }

  remainingOpenMs(now: number): number {
    if (this.state !== 'open') return 0;
    return Math.max(0, this.openedAt + this.config.openMs - now);
  }

  private go(to: BreakerState, at: number): void {
    if (to === this.state) return;
    this.transitions.push({ from: this.state, to, at });
    this.state = to;
    if (to === 'open') this.openedAt = at;
    if (to === 'half_open') this.probes = 0;
    if (to === 'closed') {
      this.window = [];
      this.consecutive = 0;
    }
  }

  // Would an attempt be admitted right now? Moves open to half-open once the
  // open period has elapsed but does not consume a probe slot.
  available(now: number): boolean {
    if (this.state === 'open' && now - this.openedAt >= this.config.openMs) {
      this.go('half_open', now);
    }
    if (this.state === 'open') return false;
    if (this.state === 'half_open') return this.probes < this.config.halfOpenMax;
    return true;
  }

  // Admit one attempt. In half-open this consumes one of half_open_max probes.
  allow(now: number): boolean {
    if (!this.available(now)) return false;
    if (this.state === 'half_open') this.probes++;
    return true;
  }

  record(ok: boolean, now: number): void {
    if (this.state === 'half_open') {
      this.go(ok ? 'closed' : 'open', now);
      return;
    }
    if (this.state === 'open') return;
    this.window.push(ok);
    if (this.window.length > this.config.window) this.window.shift();
    this.consecutive = ok ? 0 : this.consecutive + 1;
    const tripped =
      this.consecutive >= this.config.consecutiveFailures ||
      (this.window.length >= this.config.minRequests &&
        this.failureRate >= this.config.failureRatio);
    if (tripped) this.go('open', now);
  }
}
