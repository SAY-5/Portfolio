// Browser-side state for the PulseRoute simulator. It owns the backend pool,
// the chosen strategy, a seed, and a short routing log, all persisted in
// localStorage. A minimal external store with subscribe/getSnapshot lets React
// bind through useSyncExternalStore (see state.ts). No server, no clock reads in
// the store: the routing maths lives in the pure engine.

import { routeBatch } from './engine';
import type { Backend, BatchResult, Strategy } from './types';
import { STRATEGIES } from './types';

const POOL_KEY = 'pulseroute.pool.v1';
const STRATEGY_KEY = 'pulseroute.strategy.v1';
const LOG_KEY = 'pulseroute.log.v1';

// Cap the persisted log so localStorage never grows unbounded.
const MAX_LOG = 12;

export type LogEntry = {
  id: string;
  strategy: Strategy;
  count: number;
  dropped: number;
};

export type State = {
  backends: Backend[];
  strategy: Strategy;
  // Distribution of the most recent batch, or null before any run.
  lastBatch: BatchResult | null;
  log: LogEntry[];
  // Deterministic seed feeding the random strategy and entry ids.
  seed: number;
};

// ---------- defaults ----------

function defaultPool(): Backend[] {
  return [
    { id: 'eu-west', label: 'eu-west', weight: 3, healthy: true, activeConns: 0 },
    { id: 'us-east', label: 'us-east', weight: 2, healthy: true, activeConns: 0 },
    { id: 'ap-south', label: 'ap-south', weight: 1, healthy: true, activeConns: 0 },
  ];
}

// ---------- persistence ----------

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage may be unavailable (private mode); state still works in-memory.
  }
}

function isStrategy(value: unknown): value is Strategy {
  return typeof value === 'string' && (STRATEGIES as readonly string[]).includes(value);
}

function loadState(): State {
  const stored = readJSON<Backend[]>(POOL_KEY, defaultPool());
  const backends = Array.isArray(stored) && stored.length > 0 ? stored : defaultPool();
  const rawStrategy = readJSON<string>(STRATEGY_KEY, 'round-robin');
  return {
    backends: backends.map((b) => ({ ...b, activeConns: 0 })),
    strategy: isStrategy(rawStrategy) ? rawStrategy : 'round-robin',
    lastBatch: null,
    log: readJSON<LogEntry[]>(LOG_KEY, []),
    seed: 1,
  };
}

// ---------- minimal external store ----------

let state: State = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

function persistPool(backends: Backend[]): void {
  writeJSON(POOL_KEY, backends);
}

// ---------- backend actions ----------

let backendCounter = 0;

function makeBackendId(): string {
  backendCounter += 1;
  return `node-${backendCounter}`;
}

export function addBackend(): void {
  const id = makeBackendId();
  const backends = [
    ...state.backends,
    { id, label: id, weight: 1, healthy: true, activeConns: 0 },
  ];
  persistPool(backends);
  set({ backends });
}

export function removeBackend(id: string): void {
  const backends = state.backends.filter((b) => b.id !== id);
  persistPool(backends);
  set({ backends });
}

export function renameBackend(id: string, label: string): void {
  const clean = label.trim().slice(0, 24) || id;
  const backends = state.backends.map((b) =>
    b.id === id ? { ...b, label: clean } : b,
  );
  persistPool(backends);
  set({ backends });
}

export function setWeight(id: string, weight: number): void {
  const clamped = Math.max(1, Math.min(99, Math.floor(weight)));
  const backends = state.backends.map((b) =>
    b.id === id ? { ...b, weight: clamped } : b,
  );
  persistPool(backends);
  set({ backends });
}

export function toggleHealth(id: string): void {
  const backends = state.backends.map((b) =>
    b.id === id ? { ...b, healthy: !b.healthy } : b,
  );
  persistPool(backends);
  set({ backends });
}

export function setStrategy(strategy: Strategy): void {
  writeJSON(STRATEGY_KEY, strategy);
  set({ strategy });
}

// ---------- routing ----------

// Route a batch through the current strategy, record the distribution, and push
// a log entry. The seed advances each run so the random strategy varies between
// batches while staying reproducible for a given starting seed.
export function route(count: number): BatchResult {
  const result = routeBatch(state.backends, state.strategy, count, state.seed);
  const entry: LogEntry = {
    id: `b-${state.seed}`,
    strategy: state.strategy,
    count: result.total,
    dropped: result.dropped,
  };
  const log = [entry, ...state.log].slice(0, MAX_LOG);
  writeJSON(LOG_KEY, log);
  set({ lastBatch: result, log, seed: (state.seed + 1) | 0 });
  return result;
}

// Compute a distribution for a strategy without recording it, so the compare
// view can show every strategy's split side by side.
export function previewBatch(strategy: Strategy, count: number): BatchResult {
  return routeBatch(state.backends, strategy, count, state.seed);
}

// ---------- reset ----------

export function resetAll(): void {
  try {
    localStorage.removeItem(POOL_KEY);
    localStorage.removeItem(STRATEGY_KEY);
    localStorage.removeItem(LOG_KEY);
  } catch {
    // ignore storage errors
  }
  backendCounter = 0;
  state = {
    backends: defaultPool(),
    strategy: 'round-robin',
    lastBatch: null,
    log: [],
    seed: 1,
  };
  emit();
}
