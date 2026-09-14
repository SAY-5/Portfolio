// Seeded PRNG (mulberry32) and a virtual clock. Backoff jitter, target
// latency, task priorities, resubmit sampling and interleaving all draw from
// one seeded stream, and nothing reads Math.random or Date.now, so a given
// seed replays the same run.

export class Rng {
  private state: number;

  constructor(seed: string) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    this.state = h;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  choice<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  sample<T>(items: readonly T[], k: number): T[] {
    const pool = items.slice();
    const out: T[] = [];
    for (let i = 0; i < k && pool.length; i++) out.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0]);
    return out;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  hex(n: number): string {
    let s = '';
    for (let i = 0; i < n; i++) s += Math.floor(this.next() * 16).toString(16);
    return s;
  }
}

export class Clock {
  private t = 0;

  now(): number {
    return this.t;
  }

  advance(seconds: number): void {
    this.t += Math.max(0, seconds);
  }
}
