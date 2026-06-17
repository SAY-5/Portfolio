// Browser-side gateway store. Routes, API keys, the request log, the per
// key+route window counters and a settable window clock all live in
// localStorage and survive reload. The store is framework-agnostic: it exposes
// subscribe/getSnapshot so a React component can bind through
// useSyncExternalStore. The virtual window clock is advanced explicitly by a UI
// action, so the admission decision never depends on a real clock and the whole
// simulator stays deterministic and replayable.

import type { ApiKey, Decision, LogEntry, Route, Status } from './types';
import { decide, windowKey } from './engine';

const KEY = 'apiplatform.state.v1';

// Everything the store persists in one record.
export type GatewayState = {
  routes: Route[];
  keys: ApiKey[];
  log: LogEntry[];
  // Fixed-window counters keyed by windowKey(keyId, routeId, window).
  counts: Record<string, number>;
  // The current virtual window number. Advancing it resets every per-key rate
  // budget because counts are scoped by window.
  window: number;
  // Monotonic id source for log entries, persisted so ids stay unique.
  seq: number;
};

// Seed configuration: three routes spanning an open health check, an auth-gated
// metered users API, and a tighter admin route, plus three keys including one
// suspended so every outcome (200/401/403/429) is reachable out of the box.
function seed(): GatewayState {
  const routes: Route[] = [
    { id: 'r-health', prefix: '/health', upstream: 'status-svc', requiresAuth: false, rateLimit: 0 },
    { id: 'r-users', prefix: '/v1/users', upstream: 'users-svc', requiresAuth: true, rateLimit: 3 },
    { id: 'r-v1', prefix: '/v1', upstream: 'core-svc', requiresAuth: true, rateLimit: 5 },
    { id: 'r-admin', prefix: '/v1/admin', upstream: 'admin-svc', requiresAuth: true, rateLimit: 2 },
  ];
  const keys: ApiKey[] = [
    { id: 'k-live', label: 'live-app', active: true },
    { id: 'k-ci', label: 'ci-runner', active: true },
    { id: 'k-old', label: 'legacy-suspended', active: false },
  ];
  return { routes, keys, log: [], counts: {}, window: 1, seq: 0 };
}

// ---------- persistence ----------

function read(): GatewayState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GatewayState;
    if (!parsed || !Array.isArray(parsed.routes) || !Array.isArray(parsed.keys)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function write(s: GatewayState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage may be unavailable (private mode); the app still works in memory.
  }
}

function load(): GatewayState {
  return read() ?? seed();
}

// ---------- store ----------

let state: GatewayState = load();
write(state);
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function commit(next: GatewayState): void {
  state = next;
  write(state);
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSnapshot(): GatewayState {
  return state;
}

// ---------- id helpers ----------

function routeId(): string {
  return `r-${Date.now().toString(36)}-${state.routes.length}`;
}

function keyId(): string {
  return `k-${Date.now().toString(36)}-${state.keys.length}`;
}

// ---------- route actions ----------

export type NewRoute = Omit<Route, 'id'>;

export function addRoute(input: NewRoute): void {
  const route: Route = { ...input, id: routeId(), prefix: normalisePrefix(input.prefix) };
  commit({ ...state, routes: [...state.routes, route] });
}

export function updateRoute(id: string, patch: Partial<Omit<Route, 'id'>>): void {
  const next = state.routes.map((r) =>
    r.id === id
      ? { ...r, ...patch, prefix: patch.prefix !== undefined ? normalisePrefix(patch.prefix) : r.prefix }
      : r,
  );
  commit({ ...state, routes: next });
}

export function removeRoute(id: string): void {
  commit({ ...state, routes: state.routes.filter((r) => r.id !== id) });
}

// Force a path to start with a single slash and drop a trailing slash so the
// longest-prefix match in the engine behaves predictably.
function normalisePrefix(raw: string): string {
  let p = raw.trim();
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

// ---------- key actions ----------

export function addKey(label: string): void {
  const key: ApiKey = { id: keyId(), label: label.trim() || 'key', active: true };
  commit({ ...state, keys: [...state.keys, key] });
}

export function setKeyActive(id: string, active: boolean): void {
  commit({ ...state, keys: state.keys.map((k) => (k.id === id ? { ...k, active } : k)) });
}

export function removeKey(id: string): void {
  commit({ ...state, keys: state.keys.filter((k) => k.id !== id) });
}

// ---------- request simulation ----------

// Send one simulated request through the gateway. The decision is computed by
// the pure engine against the current window and counts; an admitted (200)
// request increments the key+route counter so the next call moves toward the
// limit. The clock is read here, in the action, never during render.
export function sendRequest(path: string, requestKeyId: string | null): Decision {
  const decision = decide(state.routes, state.keys, { path, keyId: requestKeyId }, state.window, state.counts);

  let counts = state.counts;
  if (decision.status === 200 && decision.keyId && decision.limit > 0) {
    const wk = windowKey(decision.keyId, decision.match.route!.id, state.window);
    counts = { ...counts, [wk]: (counts[wk] ?? 0) + 1 };
  }

  const seq = state.seq + 1;
  const entry: LogEntry = {
    id: `req-${seq}`,
    path,
    keyId: requestKeyId,
    status: decision.status,
    reason: decision.reason,
    routeId: decision.match.route?.id ?? null,
    window: state.window,
    at: Date.now(),
  };

  commit({ ...state, counts, log: [entry, ...state.log].slice(0, 60), seq });
  return decision;
}

// Current admitted count for a key+route in the live window, for usage meters.
export function usage(keyIdValue: string, routeIdValue: string): number {
  return state.counts[windowKey(keyIdValue, routeIdValue, state.window)] ?? 0;
}

// ---------- window clock ----------

// Advance the virtual window. Counters are scoped by window, so the next window
// starts every key's rate budget fresh without touching the log.
export function advanceWindow(): void {
  commit({ ...state, window: state.window + 1 });
}

// ---------- reset ----------

// Wipe persisted state and reseed, for the dashboard reset control.
export function resetAll(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore storage errors
  }
  commit(seed());
}

// Re-export the outcome type for convenience.
export type { Status };
