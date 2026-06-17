// Pure health engine for the HealthMonitor dashboard. Given a service and its
// current sample window it derives a status, uptime, p95 latency, a sparkline
// path, and any firing alert. A small seeded PRNG (mulberry32) generates the
// next probe sample deterministically from the service seed plus the tick, so
// the whole fleet is reproducible and contains no eval, Math.random, or clock
// reads. Status comes purely from p95 latency and error rate against the
// configured thresholds.

import type {
  Alert,
  Rollup,
  Sample,
  Service,
  ServiceHealth,
  Status,
  Thresholds,
} from './types';

export const DEFAULT_THRESHOLDS: Thresholds = {
  latencyWarnMs: 250,
  latencyDownMs: 600,
  errorWarnPct: 2,
  errorDownPct: 8,
};

// Number of samples retained per service. Wide enough for a meaningful p95 and
// a readable sparkline, small enough to stay cheap on every tick.
export const WINDOW = 24;

// mulberry32: a compact, well-distributed seeded PRNG. Deterministic for a
// given seed, so it stands in for Math.random without the impurity.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mix a service seed with a tick into a fresh 32-bit seed, so successive ticks
// draw independent-looking but reproducible samples.
function mixSeed(seed: number, tick: number): number {
  let h = (seed ^ Math.imul(tick + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// Draw one probe sample for a service at a given tick. The fault state lifts
// latency and error probability so a faulted service lands in the degraded or
// down band deterministically.
export function sampleAt(service: Service, tick: number): Sample {
  const rng = mulberry32(mixSeed(service.seed, tick));
  let latency = service.baseLatencyMs;
  let errorP = service.baseErrorPct / 100;

  if (service.fault === 'latency') {
    latency *= 3.2;
    errorP += 0.015;
  } else if (service.fault === 'errors') {
    latency *= 1.4;
    errorP += 0.16;
  } else if (service.fault === 'outage') {
    latency *= 4.5;
    errorP += 0.55;
  }

  // Latency jitter: a centred multiplier in roughly [0.7, 1.5].
  const jitter = 0.7 + rng() * 0.8;
  const latencyMs = Math.max(1, Math.round(latency * jitter));
  const error = rng() < errorP;
  return { latencyMs, error };
}

// Seed a fresh sample window by replaying ticks 0..WINDOW-1 deterministically.
export function seedSamples(service: Service): Sample[] {
  const out: Sample[] = [];
  for (let t = 0; t < WINDOW; t += 1) out.push(sampleAt(service, t));
  return out;
}

// Append the next deterministic sample for `nextTick`, keeping the window size.
export function advanceSamples(
  service: Service,
  nextTick: number,
): Sample[] {
  const next = sampleAt(service, nextTick);
  return [...service.samples, next].slice(-WINDOW);
}

// p95 latency over the window: sort ascending and take the 95th-percentile
// index. Returns 0 for an empty window.
export function p95(samples: Sample[]): number {
  if (samples.length === 0) return 0;
  const sorted = samples.map((s) => s.latencyMs).sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

// Error rate as a percentage of errored samples over the window.
export function errorPct(samples: Sample[]): number {
  if (samples.length === 0) return 0;
  const errs = samples.reduce((n, s) => n + (s.error ? 1 : 0), 0);
  return (errs / samples.length) * 100;
}

// Uptime is the share of non-error samples, the complement of the error rate.
export function uptimePct(samples: Sample[]): number {
  if (samples.length === 0) return 100;
  return 100 - errorPct(samples);
}

// Derive a status from p95 latency and error rate against the thresholds. The
// worst of the two signals wins, and the breached dimension is reported.
export function deriveStatus(
  p95Ms: number,
  errPct: number,
  t: Thresholds,
): { status: Status; breach: 'latency' | 'errors' | null } {
  const latencyDown = p95Ms >= t.latencyDownMs;
  const errorDown = errPct >= t.errorDownPct;
  if (latencyDown || errorDown) {
    return { status: 'down', breach: errorDown ? 'errors' : 'latency' };
  }
  const latencyWarn = p95Ms >= t.latencyWarnMs;
  const errorWarn = errPct >= t.errorWarnPct;
  if (latencyWarn || errorWarn) {
    return { status: 'degraded', breach: errorWarn ? 'errors' : 'latency' };
  }
  return { status: 'up', breach: null };
}

// Build an SVG path string for the latency series, normalised into a viewBox of
// width x height. Flat line when the window is empty or single-valued.
export function sparklinePath(
  samples: Sample[],
  width = 120,
  height = 32,
): string {
  if (samples.length === 0) return `M0 ${height / 2} L${width} ${height / 2}`;
  const values = samples.map((s) => s.latencyMs);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = samples.length > 1 ? width / (samples.length - 1) : width;
  const pts = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / span) * height;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return `M${pts[0]} ${pts.slice(1).map((p) => `L${p}`).join(' ')}`;
}

// Compute full derived health for one service at the current sample window.
export function computeHealth(
  service: Service,
  thresholds: Thresholds,
): ServiceHealth {
  const samples = service.samples;
  const p95Ms = p95(samples);
  const errPct = errorPct(samples);
  const { status, breach } = deriveStatus(p95Ms, errPct, thresholds);
  const last = samples[samples.length - 1];
  return {
    id: service.id,
    name: service.name,
    region: service.region,
    kind: service.kind,
    status,
    latencyMs: last ? last.latencyMs : 0,
    p95Ms,
    errorPct: errPct,
    uptimePct: uptimePct(samples),
    samples,
    sparkline: sparklinePath(samples),
    breach,
  };
}

// Roll up status counts across the fleet for the summary bar.
export function rollup(healths: ServiceHealth[]): Rollup {
  const r: Rollup = { up: 0, degraded: 0, down: 0, total: healths.length };
  for (const h of healths) r[h.status] += 1;
  return r;
}

// Evaluate firing alerts for a service: a latency or error-rate breach yields
// an alert at warn or critical severity. A healthy service yields none.
export function evaluateAlerts(health: ServiceHealth, t: Thresholds): Alert[] {
  const alerts: Alert[] = [];
  if (health.p95Ms >= t.latencyDownMs) {
    alerts.push({
      id: `${health.id}:latency:critical`,
      serviceId: health.id,
      serviceName: health.name,
      kind: 'latency',
      severity: 'critical',
      message: `p95 latency ${health.p95Ms}ms over ${t.latencyDownMs}ms`,
      value: health.p95Ms,
      threshold: t.latencyDownMs,
    });
  } else if (health.p95Ms >= t.latencyWarnMs) {
    alerts.push({
      id: `${health.id}:latency:warn`,
      serviceId: health.id,
      serviceName: health.name,
      kind: 'latency',
      severity: 'warn',
      message: `p95 latency ${health.p95Ms}ms over ${t.latencyWarnMs}ms`,
      value: health.p95Ms,
      threshold: t.latencyWarnMs,
    });
  }
  const err = Math.round(health.errorPct * 10) / 10;
  if (health.errorPct >= t.errorDownPct) {
    alerts.push({
      id: `${health.id}:errors:critical`,
      serviceId: health.id,
      serviceName: health.name,
      kind: 'errors',
      severity: 'critical',
      message: `error rate ${err}% over ${t.errorDownPct}%`,
      value: err,
      threshold: t.errorDownPct,
    });
  } else if (health.errorPct >= t.errorWarnPct) {
    alerts.push({
      id: `${health.id}:errors:warn`,
      serviceId: health.id,
      serviceName: health.name,
      kind: 'errors',
      severity: 'warn',
      message: `error rate ${err}% over ${t.errorWarnPct}%`,
      value: err,
      threshold: t.errorWarnPct,
    });
  }
  return alerts;
}

// Evaluate firing alerts across the whole fleet, criticals first.
export function evaluateFleetAlerts(
  healths: ServiceHealth[],
  t: Thresholds,
): Alert[] {
  const all = healths.flatMap((h) => evaluateAlerts(h, t));
  return all.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    return a.serviceName.localeCompare(b.serviceName);
  });
}
