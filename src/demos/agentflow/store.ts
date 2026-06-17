// Browser-side state for AgentFlow. The workflow definition, the last run
// trace, and a short run history all live in localStorage so they survive a
// reload. Running the workflow is a pure call into the deterministic engine;
// nothing here talks to a server or to any external service.

import { defaultSteps, runWorkflow, toRecord } from './engine';
import type { RunRecord, RunResult, Step, Workflow } from './types';

const WF_KEY = 'agentflow.workflow.v1';
const LAST_KEY = 'agentflow.last.v1';
const HISTORY_KEY = 'agentflow.history.v1';

const HISTORY_LIMIT = 12;

export type State = {
  workflow: Workflow;
  last: RunResult | null;
  history: RunRecord[];
};

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
    // storage may be unavailable (private mode); the app still works in-memory.
  }
}

function loadWorkflow(): Workflow {
  const fallback: Workflow = { steps: defaultSteps(), seed: 1 };
  const wf = readJSON<Workflow>(WF_KEY, fallback);
  if (!wf || !Array.isArray(wf.steps) || wf.steps.length === 0) return fallback;
  return wf;
}

function loadState(): State {
  return {
    workflow: loadWorkflow(),
    last: readJSON<RunResult | null>(LAST_KEY, null),
    history: readJSON<RunRecord[]>(HISTORY_KEY, []),
  };
}

// ---------- minimal external store ----------

let state: State = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function setWorkflow(steps: Step[], seed: number): void {
  const workflow: Workflow = { steps, seed };
  writeJSON(WF_KEY, workflow);
  state = { ...state, workflow };
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

// ---------- id helpers ----------

let seq = 0;

// Deterministic-ish unique id for new steps and run records. Avoids
// Math.random so the store has no hidden nondeterminism of its own.
function uid(prefix: string, clockNow: number): string {
  seq = (seq + 1) % 100000;
  return `${prefix}-${clockNow.toString(36)}-${seq.toString(36)}`;
}

// ---------- step edits ----------

const clampInt = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : lo)));

const clampRate = (n: number) =>
  Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

export function updateStep(id: string, patch: Partial<Step>): void {
  const steps = state.workflow.steps.map((s) => {
    if (s.id !== id) return s;
    const next: Step = { ...s, ...patch };
    return {
      ...next,
      failureRate: clampRate(next.failureRate),
      maxRetries: clampInt(next.maxRetries, 0, 8),
      baseBackoffMs: clampInt(next.baseBackoffMs, 0, 5000),
      name: next.name.trim() === '' ? s.name : next.name,
    };
  });
  setWorkflow(steps, state.workflow.seed);
}

export function addStep(clockNow: number): void {
  const id = uid('step', clockNow);
  const n = state.workflow.steps.length + 1;
  const step: Step = {
    id,
    name: `task ${n}`,
    failureRate: 0.25,
    maxRetries: 2,
    baseBackoffMs: 100,
  };
  setWorkflow([...state.workflow.steps, step], state.workflow.seed);
}

export function removeStep(id: string): void {
  if (state.workflow.steps.length <= 1) return;
  const steps = state.workflow.steps.filter((s) => s.id !== id);
  setWorkflow(steps, state.workflow.seed);
}

export function moveStep(id: string, dir: -1 | 1): void {
  const steps = [...state.workflow.steps];
  const i = steps.findIndex((s) => s.id === id);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= steps.length) return;
  [steps[i], steps[j]] = [steps[j], steps[i]];
  setWorkflow(steps, state.workflow.seed);
}

export function setSeed(seed: number): void {
  const next = clampInt(seed, 0, 999999);
  setWorkflow(state.workflow.steps, next);
}

// ---------- running ----------

// Run the current workflow against the engine and persist the trace plus a
// history record. `clockNow` is the wall clock snapshot the caller took in
// render state, kept out of the pure engine.
export function run(clockNow: number): RunResult {
  const result = runWorkflow(state.workflow, clockNow);
  const record = toRecord(result, uid('run', clockNow));
  const history = [record, ...state.history].slice(0, HISTORY_LIMIT);
  writeJSON(LAST_KEY, result);
  writeJSON(HISTORY_KEY, history);
  state = { ...state, last: result, history };
  emit();
  return result;
}

// Wipe persisted workflow, trace, and history and return to defaults.
export function resetAll(): void {
  try {
    localStorage.removeItem(WF_KEY);
    localStorage.removeItem(LAST_KEY);
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore storage errors
  }
  state = {
    workflow: { steps: defaultSteps(), seed: 1 },
    last: null,
    history: [],
  };
  emit();
}
