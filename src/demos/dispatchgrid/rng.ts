// Deterministic PRNG (splitmix32 step, xoshiro-style mixing). The demo never
// uses the runtime random source, so the same seed always produces the same fleet, the
// same rides, and the same match decisions.
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  next(): number {
    this.s = (this.s + 0x9e3779b9) >>> 0;
    let z = this.s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    z = (z ^ (z >>> 15)) >>> 0;
    return z / 4294967296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  gaussian(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
