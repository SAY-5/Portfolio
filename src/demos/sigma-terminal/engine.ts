// Pure, deterministic market engine for the Sigma Terminal. Every series is
// generated from an instrument seed through an xorshift PRNG, so the same
// instrument and tick count always yield the same bars. Nothing here reads the
// clock or Math.random, and there is no eval: alert evaluation is a plain
// numeric comparison. The UI advances a series by asking for one more bar.

import type { Alert, Bar, Instrument, Quote, TriggeredAlert } from './types';

// How many bars make up a fresh series before any user ticks are applied.
export const BASE_BARS = 56;

// Deterministic xorshift32. Seeded from the instrument so renders agree.
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Derive the next bar from the previous close using a PRNG drawn from the
// instrument seed combined with the bar index, so bar N is a pure function of
// (seed, index) and never depends on call order.
function barAt(inst: Instrument, index: number, prevClose: number): Bar {
  const rng = makeRng((inst.seed * 2654435761 + index * 40503) >>> 0);
  const o = prevClose;
  // Slight negative bias keeps the walk from drifting up unbounded.
  const drift = (rng() - 0.48) * inst.vol;
  const c = Math.max(1, o + drift);
  const wick = (rng() * 0.6 + 0.2) * inst.vol;
  const h = Math.max(o, c) + wick * rng();
  const l = Math.max(0.5, Math.min(o, c) - wick * rng());
  return { o: round2(o), h: round2(h), l: round2(l), c: round2(c) };
}

// Build a deterministic series of `count` bars for an instrument. The same
// arguments always return identical bars.
export function buildSeries(inst: Instrument, count: number): Bar[] {
  const out: Bar[] = [];
  let prev = inst.base;
  for (let i = 0; i < count; i++) {
    const bar = barAt(inst, i, prev);
    out.push(bar);
    prev = bar.c;
  }
  return out;
}

// Append one deterministic bar to an existing series, keyed by its length so
// advancing is reproducible regardless of how many ticks came before.
export function advanceSeries(inst: Instrument, series: Bar[]): Bar[] {
  if (series.length === 0) return buildSeries(inst, 1);
  const prev = series[series.length - 1].c;
  return [...series, barAt(inst, series.length, prev)];
}

// Summary statistics over a series: last price, day change against the prior
// bar, and the open/high/low/close across the whole window.
export function quoteFromSeries(ticker: string, series: Bar[]): Quote {
  if (series.length === 0) {
    return {
      ticker,
      last: 0,
      prevClose: 0,
      change: 0,
      changePct: 0,
      open: 0,
      high: 0,
      low: 0,
      close: 0,
    };
  }
  const last = series[series.length - 1].c;
  const prevClose =
    series.length > 1 ? series[series.length - 2].c : series[0].o;
  const open = series[0].o;
  let high = series[0].h;
  let low = series[0].l;
  for (const bar of series) {
    if (bar.h > high) high = bar.h;
    if (bar.l < low) low = bar.l;
  }
  const change = round2(last - prevClose);
  const changePct = prevClose === 0 ? 0 : round2((change / prevClose) * 100);
  return {
    ticker,
    last,
    prevClose,
    change,
    changePct,
    open: round2(open),
    high: round2(high),
    low: round2(low),
    close: last,
  };
}

// Build an SVG path string for a close-price sparkline over the series, mapped
// into the given width and height. Returns an empty string for a thin series.
export function sparklinePath(
  series: Bar[],
  width: number,
  height: number,
): string {
  if (series.length < 2) return '';
  const closes = series.map((b) => b.c);
  let min = closes[0];
  let max = closes[0];
  for (const v of closes) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  const stepX = width / (closes.length - 1);
  let d = '';
  closes.forEach((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / span) * height;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  return d;
}

// Evaluate every alert against the current series price. An `above` alert fires
// when the last price is at or above its threshold; `below` when at or below.
// `now` is passed in so the engine never reads the clock itself.
export function evaluateAlerts(
  alerts: Alert[],
  priceOf: (ticker: string) => number,
  now: number,
): TriggeredAlert[] {
  const fired: TriggeredAlert[] = [];
  for (const alert of alerts) {
    const price = priceOf(alert.ticker);
    if (price <= 0) continue;
    const hit =
      alert.direction === 'above'
        ? price >= alert.threshold
        : price <= alert.threshold;
    if (hit) fired.push({ alert, price, at: now });
  }
  return fired;
}
