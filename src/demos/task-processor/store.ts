// Browser-side store for the task-processor simulator. It holds the full
// simulation state (jobs, workers, tick, config, PRNG seed, trend) in
// localStorage and exposes actions the UI calls: enqueue jobs, change config,
// advance one tick, run a batch of ticks, and reset. The engine does the work;
// this module only persists and notifies. useSyncExternalStore reads it.

import { useSyncExternalStore } from 'react';
import {
  computeMetrics,
  createInitialState,
  makeJob,
  resizeWorkers,
  tick as engineTick,
} from './engine';
import type { Config, Metrics, SimState } from './types';

const STATE_KEY = 'task-processor.state.v1';

const DEFAULT_CONFIG: Config = { concurrency: 3, maxRetries: 2, failRate: 0.3 };
const DEFAULT_SEED = 0x1f2e3d4c;
const DEFAULT_BATCH = 12;

// Bounds keep the controls and persisted state sane.
export const LIMITS = {
  concurrency: { min: 1, max: 8 },
  maxRetries: { min: 0, max: 5 },
  failRate: { min: 0, max: 1 },
  batch: { min: 1, max: 24 },
} as const;

function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function clampRate(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(LIMITS.failRate.max, Math.max(LIMITS.failRate.min, value));
}

// ---------- persistence ----------

function readState(): SimState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SimState;
    if (!Array.isArray(parsed.jobs) || !Array.isArray(parsed.workers)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeState(value: SimState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(value));
  } catch {
    // storage may be unavailable (private mode); the sim still runs in memory.
  }
}

function freshState(): SimState {
  return createInitialState({ ...DEFAULT_CONFIG }, DEFAULT_SEED, DEFAULT_BATCH);
}

// ---------- external store ----------

let state: SimState = readState() ?? freshState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function commit(next: SimState): void {
  state = next;
  writeState(state);
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): SimState {
  return state;
}

// ---------- actions ----------

// Add a batch of fresh queued jobs, numbered continuously from nextId.
export function enqueue(count = 4): void {
  const n = clampInt(count, LIMITS.batch.min, LIMITS.batch.max);
  const jobs = state.jobs.slice();
  let nextId = state.nextId;
  for (let i = 0; i < n; i++) {
    jobs.push(makeJob(`J-${nextId}`, `job ${nextId}`, state.tick));
    nextId += 1;
  }
  commit({ ...state, jobs, nextId });
}

export function setConcurrency(value: number): void {
  const safe = clampInt(value, LIMITS.concurrency.min, LIMITS.concurrency.max);
  commit(resizeWorkers(state, safe));
}

export function setMaxRetries(value: number): void {
  const safe = clampInt(value, LIMITS.maxRetries.min, LIMITS.maxRetries.max);
  commit({ ...state, config: { ...state.config, maxRetries: safe } });
}

export function setFailRate(value: number): void {
  commit({ ...state, config: { ...state.config, failRate: clampRate(value) } });
}

// Advance the system exactly one tick.
export function step(): void {
  commit(engineTick(state));
}

// Advance up to n ticks, stopping early once there is nothing left to process.
export function runTicks(n: number): void {
  const count = clampInt(n, 1, 50);
  let next = state;
  for (let i = 0; i < count; i++) {
    const m = computeMetrics(next);
    if (m.queued === 0 && m.running === 0) break;
    next = engineTick(next);
  }
  commit(next);
}

// Wipe persisted state and start a fresh batch with default config and seed.
export function reset(): void {
  try {
    localStorage.removeItem(STATE_KEY);
  } catch {
    // ignore storage errors
  }
  commit(freshState());
}

// ---------- derived ----------

export function selectMetrics(s: SimState = state): Metrics {
  const last = s.trend[s.trend.length - 1];
  return computeMetrics(s, last ? last.throughput : 0);
}

// ---------- react binding ----------

export function useSim(): SimState {
  return useSyncExternalStore(subscribe, getState, getState);
}
