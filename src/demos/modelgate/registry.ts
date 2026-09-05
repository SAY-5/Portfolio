import type { Version } from './model';

// Port of ModelRegistry: a primary, an optional shadow, and the previous
// primary as the rollback target. Promotion loads and warms the candidate off
// the request path (a load state visible here as "loading" then "warm"), and
// the swap itself is one reference replacement under a lock. In-flight
// requests keep the reference they captured, so a request that started on v1
// finishes on v1 even if the swap lands mid-flight.

export type LoadState = 'idle' | 'loading' | 'warm';

export type Swap = { kind: 'promote' | 'rollback'; from: Version; to: Version; at: number };

export class Registry {
  primary: Version = 'v1';
  shadow: Version | null = 'v2';
  previous: Version | null = null;
  loadState: LoadState = 'idle';
  candidate: Version | null = null;
  swaps: Swap[] = [];
  private loadedAt = 0;

  // Load + warm takes about 1 s of simulated time (torch.load and a warm-up
  // batch), then the swap is applied at the next opportunity.
  promote(version: Version, now: number): boolean {
    if (version === this.primary || this.loadState === 'loading') return false;
    this.candidate = version;
    this.loadState = 'loading';
    this.loadedAt = now + 1000;
    return true;
  }

  // Returns true on the tick where the reference is swapped.
  tick(now: number): boolean {
    if (this.loadState !== 'loading' || this.candidate === null) return false;
    if (now <= this.loadedAt) return false;
    const from = this.primary;
    this.previous = from;
    this.primary = this.candidate;
    if (this.shadow === this.primary) this.shadow = null;
    this.candidate = null;
    this.loadState = 'warm';
    this.swaps.push({ kind: 'promote', from, to: this.primary, at: now });
    return true;
  }

  rollback(now: number): boolean {
    if (this.previous === null || this.loadState === 'loading') return false;
    const from = this.primary;
    this.primary = this.previous;
    this.previous = from;
    this.shadow = from;
    this.loadState = 'idle';
    this.swaps.push({ kind: 'rollback', from, to: this.primary, at: now });
    return true;
  }

  roles(): Array<{ version: Version; role: string }> {
    const out: Array<{ version: Version; role: string }> = [{ version: this.primary, role: 'primary' }];
    if (this.shadow) out.push({ version: this.shadow, role: 'shadow' });
    if (this.previous) out.push({ version: this.previous, role: 'previous' });
    return out;
  }
}
