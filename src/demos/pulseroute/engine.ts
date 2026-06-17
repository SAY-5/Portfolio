// Pure routing engine. Given a pool of backends and a strategy, it picks a
// backend per request and tallies a batch into a distribution. Unhealthy
// backends are always skipped. Nothing here reads the clock or Math.random, so
// a given pool plus seed is fully deterministic and unit-testable.

import type { Backend, BatchResult, RouteResult, Strategy } from './types';

// A tiny deterministic PRNG (mulberry32). Seeded from a counter the caller
// advances, it stands in for Math.random while staying reproducible. Returns a
// float in [0, 1).
export function seededUnit(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function healthyBackends(pool: Backend[]): Backend[] {
  return pool.filter((b) => b.healthy);
}

// Mutable cursor the strategies carry between requests so a batch behaves like a
// real router walking its pool rather than restarting each call.
export type RouterCursor = {
  // Next index for round-robin, over the healthy subset order.
  rrIndex: number;
  // Counter feeding the seeded PRNG for the random strategy.
  randomSeed: number;
};

export function makeCursor(seed = 1): RouterCursor {
  return { rrIndex: 0, randomSeed: seed };
}

// Pick one backend for a single request under the given strategy. Skips every
// unhealthy backend. Returns a clear result when nothing is in rotation.
export function pickBackend(
  pool: Backend[],
  strategy: Strategy,
  cursor: RouterCursor,
): RouteResult {
  const healthy = healthyBackends(pool);
  if (healthy.length === 0) {
    return { ok: false, reason: 'no-healthy-backend' };
  }

  let chosen: Backend;

  switch (strategy) {
    case 'round-robin': {
      const idx = cursor.rrIndex % healthy.length;
      chosen = healthy[idx];
      cursor.rrIndex = (cursor.rrIndex + 1) % healthy.length;
      break;
    }
    case 'weighted': {
      // Walk the cumulative weight line using the round-robin cursor as a
      // deterministic position, so weights produce a stable repeating pattern.
      const weights = healthy.map((b) => Math.max(1, Math.floor(b.weight)));
      const total = weights.reduce((a, w) => a + w, 0);
      const pos = cursor.rrIndex % total;
      let acc = 0;
      let idx = 0;
      for (let i = 0; i < weights.length; i++) {
        acc += weights[i];
        if (pos < acc) {
          idx = i;
          break;
        }
      }
      chosen = healthy[idx];
      cursor.rrIndex = (cursor.rrIndex + 1) % total;
      break;
    }
    case 'least-connections': {
      // Lowest activeConns wins; ties break on pool order for determinism.
      let best = healthy[0];
      for (const b of healthy) {
        if (b.activeConns < best.activeConns) best = b;
      }
      chosen = best;
      break;
    }
    case 'random': {
      const u = seededUnit(cursor.randomSeed);
      cursor.randomSeed = (cursor.randomSeed + 1) | 0;
      const idx = Math.min(healthy.length - 1, Math.floor(u * healthy.length));
      chosen = healthy[idx];
      break;
    }
    default: {
      // Exhaustiveness guard: any new strategy must be handled above.
      const never: never = strategy;
      return never;
    }
  }

  return { ok: true, backendId: chosen.id };
}

// Route a batch of `count` requests through the strategy, returning the
// per-backend distribution. Works on a cloned pool so least-connections can see
// its own picks accumulate without mutating the caller's backends.
export function routeBatch(
  pool: Backend[],
  strategy: Strategy,
  count: number,
  seed = 1,
): BatchResult {
  const work = pool.map((b) => ({ ...b }));
  const cursor = makeCursor(seed);
  const distribution: Record<string, number> = {};
  for (const b of pool) distribution[b.id] = 0;

  let dropped = 0;
  const n = Math.max(0, Math.floor(count));

  for (let i = 0; i < n; i++) {
    const result = pickBackend(work, strategy, cursor);
    if (!result.ok) {
      dropped += 1;
      continue;
    }
    distribution[result.backendId] += 1;
    const target = work.find((b) => b.id === result.backendId);
    if (target) target.activeConns += 1;
  }

  return { distribution, dropped, total: n };
}
