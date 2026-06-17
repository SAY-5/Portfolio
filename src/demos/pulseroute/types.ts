// Shared types for the PulseRoute load-balancer simulator. A pool of backends
// sits behind a router; a strategy decides which healthy backend a request goes
// to. Everything is pure data so the engine can be tested without any UI.

// One upstream the router can send requests to.
export type Backend = {
  id: string;
  label: string;
  // Relative share used by the weighted strategy. Higher weight takes more
  // traffic. Clamped to at least 1 by the store so a backend in rotation never
  // has a zero weight.
  weight: number;
  // Out-of-rotation backends are skipped by every strategy.
  healthy: boolean;
  // Live count of in-flight requests, used by least-connections.
  activeConns: number;
};

// The supported routing strategies. All are deterministic: random uses a seeded
// counter, never Math.random, so a given pool plus seed always produces the
// same split.
export type Strategy =
  | 'round-robin'
  | 'weighted'
  | 'least-connections'
  | 'random';

export const STRATEGIES: readonly Strategy[] = [
  'round-robin',
  'weighted',
  'least-connections',
  'random',
] as const;

export const STRATEGY_LABELS: Record<Strategy, string> = {
  'round-robin': 'Round robin',
  weighted: 'Weighted',
  'least-connections': 'Least connections',
  random: 'Random (seeded)',
};

// The outcome of routing a single request.
export type RouteResult =
  | { ok: true; backendId: string }
  | { ok: false; reason: 'no-healthy-backend' };

// The outcome of routing a whole batch: per-backend counts plus any requests
// that found no healthy backend.
export type BatchResult = {
  // backend id -> number of requests routed to it.
  distribution: Record<string, number>;
  dropped: number;
  total: number;
};
