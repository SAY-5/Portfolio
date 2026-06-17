// Framework-agnostic store for ReleaseGuard. It holds the release gates and the
// canary rollout in localStorage, exposes typed actions that edit gate values
// and thresholds, configure the canary error budget, and advance or roll back
// the ramp. The engine stays pure; this file owns persistence and the action
// surface. useSyncExternalStore (in state.ts) renders against getSnapshot.

import { advanceCanary, resetCanary } from './engine';
import type { CanaryState, CanaryStep, Gate } from './types';

const GATES_KEY = 'releaseguard.gates.v1';
const CANARY_KEY = 'releaseguard.canary.v1';

export type State = {
  gates: Gate[];
  canary: CanaryState;
  // Last canary step, surfaced as a one-line explanation in the UI.
  lastStep: CanaryStep | null;
};

// ----- realistic seed -----

// A plausible release where most gates are healthy but one required gate
// (open blockers) is just over the line, so the default decision is NO-GO and
// the user can flip it to GO by tuning. Boolean approvals start met; the
// security scan starts clean.
function seedGates(): Gate[] {
  return [
    {
      id: 'tests',
      label: 'Test pass rate',
      kind: 'threshold',
      compare: 'atLeast',
      unit: 'percent',
      current: 98,
      threshold: 95,
      min: 0,
      max: 100,
      step: 1,
      required: true,
      weight: 3,
    },
    {
      id: 'coverage',
      label: 'Line coverage',
      kind: 'threshold',
      compare: 'atLeast',
      unit: 'percent',
      current: 82,
      threshold: 80,
      min: 0,
      max: 100,
      step: 1,
      required: false,
      weight: 2,
    },
    {
      id: 'blockers',
      label: 'Open blocker bugs',
      kind: 'threshold',
      compare: 'atMost',
      unit: 'count',
      current: 2,
      threshold: 0,
      min: 0,
      max: 10,
      step: 1,
      required: true,
      weight: 3,
    },
    {
      id: 'approvals',
      label: 'Approvals collected',
      kind: 'boolean',
      current: true,
      expected: true,
      required: true,
      weight: 2,
    },
    {
      id: 'security',
      label: 'Security scan clean',
      kind: 'boolean',
      current: true,
      expected: true,
      required: true,
      weight: 2,
    },
  ];
}

// A canary that clears the first two stages, then exceeds a 2% budget at 50%
// traffic, so advancing it all the way demonstrates a rollback. Tuning the
// budget up to 5% lets it reach 100%.
function seedCanary(): CanaryState {
  return {
    stages: [
      { percent: 1, errorRate: 0.4 },
      { percent: 10, errorRate: 1.2 },
      { percent: 50, errorRate: 3.1 },
      { percent: 100, errorRate: 0.9 },
    ],
    stageIndex: 0,
    status: 'active',
    errorBudget: 2,
  };
}

// ----- persistence -----

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
    // storage may be unavailable (private mode); the app still works in-memory.
  }
}

function loadState(): State {
  return {
    gates: readJSON<Gate[]>(GATES_KEY, seedGates()),
    canary: readJSON<CanaryState>(CANARY_KEY, seedCanary()),
    lastStep: null,
  };
}

// ----- minimal external store -----

let state: State = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  emit();
}

function persistGates(gates: Gate[]): void {
  writeJSON(GATES_KEY, gates);
}

function persistCanary(canary: CanaryState): void {
  writeJSON(CANARY_KEY, canary);
}

// ----- gate actions -----

// Replace a single field on a gate by id, keeping the rest immutable. Numeric
// fields are clamped to the gate's min/max where applicable.
export function setGateCurrent(id: string, value: number): void {
  const gates = state.gates.map((g) => {
    if (g.id !== id || g.kind !== 'threshold') return g;
    const clamped = Math.min(g.max, Math.max(g.min, Math.round(value)));
    return { ...g, current: clamped };
  });
  persistGates(gates);
  set({ gates });
}

export function setGateThreshold(id: string, value: number): void {
  const gates = state.gates.map((g) => {
    if (g.id !== id || g.kind !== 'threshold') return g;
    const clamped = Math.min(g.max, Math.max(g.min, Math.round(value)));
    return { ...g, threshold: clamped };
  });
  persistGates(gates);
  set({ gates });
}

export function setGateBoolean(id: string, value: boolean): void {
  const gates = state.gates.map((g) =>
    g.id === id && g.kind === 'boolean' ? { ...g, current: value } : g,
  );
  persistGates(gates);
  set({ gates });
}

export function setGateRequired(id: string, required: boolean): void {
  const gates = state.gates.map((g) =>
    g.id === id ? { ...g, required } : g,
  );
  persistGates(gates);
  set({ gates });
}

// ----- canary actions -----

export function setErrorBudget(value: number): void {
  const clamped = Math.min(20, Math.max(0, value));
  const rounded = Math.round(clamped * 10) / 10;
  const canary = { ...state.canary, errorBudget: rounded };
  persistCanary(canary);
  set({ canary });
}

// Advance the canary one step through the pure engine, persisting the result.
export function advance(): void {
  const { next, step } = advanceCanary(state.canary);
  persistCanary(next);
  set({ canary: next, lastStep: step });
}

// Restart the canary ramp at the first stage without touching the gates.
export function resetRamp(): void {
  const canary = resetCanary(state.canary);
  persistCanary(canary);
  set({ canary, lastStep: null });
}

// ----- reset -----

// Re-seed both gates and canary and clear persisted state.
export function reseed(): void {
  const gates = seedGates();
  const canary = seedCanary();
  persistGates(gates);
  persistCanary(canary);
  set({ gates, canary, lastStep: null });
}

// Wipe persisted state entirely and reload the seed into memory.
export function resetAll(): void {
  try {
    localStorage.removeItem(GATES_KEY);
    localStorage.removeItem(CANARY_KEY);
  } catch {
    // ignore storage errors
  }
  state = {
    gates: seedGates(),
    canary: seedCanary(),
    lastStep: null,
  };
  emit();
}
