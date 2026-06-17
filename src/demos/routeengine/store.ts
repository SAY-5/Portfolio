// Browser-side model of the delivery planner. The depot and stops persist in
// localStorage; the optimized route is derived from them by the safe engine and
// kept on the state for the UI to draw. A framework-agnostic store with a
// subscribe/getSnapshot pair feeds React through useSyncExternalStore.

import { naiveRoute, optimizeRoute } from './engine';
import {
  DEPOT_ID,
  GRID_MAX,
  GRID_MIN,
  type Point,
  type Route,
  type Stop,
} from './types';

const DEPOT_KEY = 'routeengine.depot.v1';
const STOPS_KEY = 'routeengine.stops.v1';

export type State = {
  depot: Point;
  stops: Stop[];
  // The route currently drawn on the map. Starts as the naive order and becomes
  // the optimized tour after an optimize pass.
  route: Route;
  // Whether `route` is the optimized tour (true) or the naive order (false).
  optimized: boolean;
};

// ---------- seed ----------

const DEFAULT_DEPOT: Point = { x: 50, y: 50 };

// Eight delivery stops scattered across the grid. Fixed coordinates keep the
// demo deterministic: the same naive and optimized routes appear on every load.
const SEED_STOPS: Stop[] = [
  { id: 's1', label: 'Riverside', x: 14, y: 22 },
  { id: 's2', label: 'Hillcrest', x: 78, y: 18 },
  { id: 's3', label: 'Old Town', x: 88, y: 64 },
  { id: 's4', label: 'Market Sq', x: 30, y: 80 },
  { id: 's5', label: 'Dockside', x: 8, y: 58 },
  { id: 's6', label: 'Greenway', x: 60, y: 38 },
  { id: 's7', label: 'Elm Park', x: 42, y: 12 },
  { id: 's8', label: 'Bayview', x: 70, y: 88 },
];

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
    // storage may be unavailable (private mode); the planner still runs in-memory.
  }
}

function clamp(n: number): number {
  if (Number.isNaN(n)) return GRID_MIN;
  return Math.max(GRID_MIN, Math.min(GRID_MAX, Math.round(n)));
}

function loadState(): State {
  const depot = readJSON<Point>(DEPOT_KEY, DEFAULT_DEPOT);
  const stops = readJSON<Stop[]>(STOPS_KEY, SEED_STOPS);
  return {
    depot: { x: clamp(depot.x), y: clamp(depot.y) },
    stops,
    route: naiveRoute(depot, stops),
    optimized: false,
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

// ---------- id minting (deterministic counter, no clock) ----------

let counter = SEED_STOPS.length;
function nextId(): string {
  counter += 1;
  return `s${counter}`;
}

// ---------- recompute ----------

// Recompute the drawn route from the current depot and stops, preserving the
// optimize/naive mode the user last chose.
function recompute(depot: Point, stops: Stop[], optimized: boolean): void {
  const route = optimized ? optimizeRoute(depot, stops) : naiveRoute(depot, stops);
  writeJSON(DEPOT_KEY, depot);
  writeJSON(STOPS_KEY, stops);
  set({ depot, stops, route, optimized });
}

// ---------- actions ----------

export function addStop(x: number, y: number, label?: string): void {
  const stop: Stop = {
    id: nextId(),
    label: label && label.trim() ? label.trim() : `Stop ${state.stops.length + 1}`,
    x: clamp(x),
    y: clamp(y),
  };
  recompute(state.depot, [...state.stops, stop], state.optimized);
}

export function removeStop(id: string): void {
  if (id === DEPOT_ID) return;
  recompute(state.depot, state.stops.filter((s) => s.id !== id), state.optimized);
}

export function moveDepot(x: number, y: number): void {
  recompute({ x: clamp(x), y: clamp(y) }, state.stops, state.optimized);
}

// Run nearest-neighbour then 2-opt and draw the improved tour.
export function optimize(): void {
  recompute(state.depot, state.stops, true);
}

// Drop back to the depot-then-stops-in-order baseline.
export function showNaive(): void {
  recompute(state.depot, state.stops, false);
}

// Wipe persisted depot and stops and restore the seed.
export function resetAll(): void {
  try {
    localStorage.removeItem(DEPOT_KEY);
    localStorage.removeItem(STOPS_KEY);
  } catch {
    // ignore storage errors
  }
  counter = SEED_STOPS.length;
  recompute(DEFAULT_DEPOT, SEED_STOPS, false);
}
