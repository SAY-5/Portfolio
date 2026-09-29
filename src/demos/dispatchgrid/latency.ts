import type { Rng } from './rng.ts';

// Service time model. The real matcher's latency is the time between the rider
// service producing the request and the Streams task claiming a driver: a
// shard insert, a produce, a poll, one GEOSEARCH and one claim script per
// candidate tried. In the browser those take microseconds, so this illustrative
// model charges synthetic log-normal service time, per-claim work and a rare
// tail. It is not fitted to the retained benchmark; browser counters are not
// infrastructure measurements.
export function drawMatchLatencyMs(rnd: Rng, claimsTried: number): number {
  const base = Math.exp(Math.log(13) + 0.78 * rnd.gaussian());
  const perClaim = Math.max(0, claimsTried - 1) * 1.2;
  const tail = rnd.next() < 0.012 ? 120 + rnd.next() * 260 : 0;
  return Math.round(base + perClaim + tail);
}

// Poll to poll gap of the Streams task.
export function drawPollDelayMs(rnd: Rng): number {
  return 2 + Math.floor(rnd.next() * 6);
}
