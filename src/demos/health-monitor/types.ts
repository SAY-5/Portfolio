// Type model for the HealthMonitor observability dashboard. Every service
// carries a seeded latency series and a derived health status. Nothing here
// reads the wall clock or Math.random: the series is advanced deterministically
// from a per-service seed so a given tick count always yields the same fleet.

export type Status = 'up' | 'degraded' | 'down';

// Thresholds that map raw latency and error rate onto a status. A service is
// degraded when either p95 latency or error rate crosses the warn line, and
// down when either crosses the critical line.
export type Thresholds = {
  latencyWarnMs: number;
  latencyDownMs: number;
  errorWarnPct: number;
  errorDownPct: number;
};

// A single probe sample: response latency and whether the probe errored. The
// uptime percentage is the share of non-error samples over the window.
export type Sample = {
  latencyMs: number;
  error: boolean;
};

// A monitored service. The seed drives its deterministic latency/error series;
// baseLatency and baseError set its healthy centre, and the optional fault
// fields let the seed data ship a service that is already degraded or down.
export type Service = {
  id: string;
  name: string;
  region: string;
  kind: 'http' | 'grpc' | 'tcp';
  seed: number;
  baseLatencyMs: number;
  baseErrorPct: number;
  // A persistent fault raises latency and error rate so the service sits in a
  // degraded or down band regardless of tick. null means healthy.
  fault: 'latency' | 'errors' | 'outage' | null;
  samples: Sample[];
};

// Derived health for one service at the current tick. Everything the cards and
// the detail view render comes from here, computed by the engine.
export type ServiceHealth = {
  id: string;
  name: string;
  region: string;
  kind: Service['kind'];
  status: Status;
  latencyMs: number; // most recent sample latency
  p95Ms: number;
  errorPct: number;
  uptimePct: number;
  samples: Sample[];
  sparkline: string; // SVG path over the latency series
  // Which threshold, if any, the service is currently breaching.
  breach: 'latency' | 'errors' | null;
};

// A single firing alert produced when a service crosses a threshold.
export type Alert = {
  id: string;
  serviceId: string;
  serviceName: string;
  kind: 'latency' | 'errors';
  severity: 'warn' | 'critical';
  message: string;
  value: number; // the measured value that tripped the alert
  threshold: number; // the line it crossed
};

// An immutable log entry capturing a status transition over time.
export type Incident = {
  id: number;
  serviceName: string;
  from: Status;
  to: Status;
  tick: number;
};

// Counts of services in each status, for the top summary bar.
export type Rollup = {
  up: number;
  degraded: number;
  down: number;
  total: number;
};
