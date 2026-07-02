// Seeded PRNG (mulberry32). The demo never touches Math.random, so the same
// (scenario, seed) pair always produces the same incident, the same clusters,
// and the same ranking, mirroring diagkit's same-seed-same-answer guarantee.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer in [lo, hi] inclusive.
export function randInt(rnd: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rnd() * (hi - lo + 1));
}

// Short hex id for request/statement tokens in raw log lines.
export function hexId(rnd: () => number, len: number): string {
  const digits = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < len; i++) out += digits[Math.floor(rnd() * 16)];
  return out;
}
