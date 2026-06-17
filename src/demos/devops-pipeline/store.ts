// Browser-side store for the pipeline runner. It keeps the editable pipeline
// definition, the seed, the last run, and a bounded run history in
// localStorage, and exposes a tiny framework-agnostic subscribe/getSnapshot
// pair that the React binding wires into useSyncExternalStore. All mutation
// goes through the actions here; the deterministic engine does the actual work.

import { runPipeline, retryStage, type RunOptions } from './engine';
import type { JobDef, PipelineDef, RunRecord, StageDef } from './types';

const DEF_KEY = 'devops-pipeline.def.v1';
const SEED_KEY = 'devops-pipeline.seed.v1';
const HISTORY_KEY = 'devops-pipeline.history.v1';

const HISTORY_LIMIT = 12;

// The seeded default pipeline: an ordered build then test then deploy flow,
// each stage running parallel jobs. The test stage carries a flaky job that is
// tolerated via allowFailure so it cannot sink the stage on its own.
function defaultPipeline(): PipelineDef {
  return {
    stages: [
      {
        id: 'build',
        name: 'build',
        jobs: [
          { id: 'compile', name: 'compile', failureRate: 0.1, allowFailure: false, durationMs: 1200 },
          { id: 'assets', name: 'bundle assets', failureRate: 0.05, allowFailure: false, durationMs: 800 },
        ],
      },
      {
        id: 'test',
        name: 'test',
        jobs: [
          { id: 'unit', name: 'unit', failureRate: 0.15, allowFailure: false, durationMs: 900 },
          { id: 'integration', name: 'integration', failureRate: 0.25, allowFailure: false, durationMs: 1500 },
          { id: 'flaky-e2e', name: 'flaky e2e', failureRate: 0.4, allowFailure: true, durationMs: 1800 },
        ],
      },
      {
        id: 'deploy',
        name: 'deploy',
        jobs: [
          { id: 'image', name: 'build image', failureRate: 0.08, allowFailure: false, durationMs: 1000 },
          { id: 'release', name: 'release', failureRate: 0.12, allowFailure: false, durationMs: 700 },
        ],
      },
    ],
  };
}

export type State = {
  def: PipelineDef;
  seed: number;
  lastRun: RunRecord | null;
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

function loadState(): State {
  return {
    def: readJSON<PipelineDef>(DEF_KEY, defaultPipeline()),
    seed: readJSON<number>(SEED_KEY, 1),
    lastRun: null,
    history: readJSON<RunRecord[]>(HISTORY_KEY, []),
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

// ---------- run id ----------

let runCounter = 0;

function makeRunId(now: number): string {
  runCounter += 1;
  return `run-${now.toString(36)}-${runCounter}`;
}

// ---------- seed ----------

export function setSeed(seed: number): void {
  const next = Number.isFinite(seed) ? Math.floor(seed) : 1;
  writeJSON(SEED_KEY, next);
  set({ seed: next });
}

// ---------- pipeline editing ----------

export function setJobFailureRate(stageId: string, jobId: string, rate: number): void {
  const clamped = Math.min(1, Math.max(0, rate));
  updateJob(stageId, jobId, (j) => ({ ...j, failureRate: clamped }));
}

export function setJobAllowFailure(stageId: string, jobId: string, allow: boolean): void {
  updateJob(stageId, jobId, (j) => ({ ...j, allowFailure: allow }));
}

export function setJobDuration(stageId: string, jobId: string, durationMs: number): void {
  const clamped = Math.max(100, Math.floor(durationMs));
  updateJob(stageId, jobId, (j) => ({ ...j, durationMs: clamped }));
}

function updateJob(
  stageId: string,
  jobId: string,
  fn: (job: JobDef) => JobDef,
): void {
  const stages = state.def.stages.map((stage: StageDef) =>
    stage.id !== stageId
      ? stage
      : {
          ...stage,
          jobs: stage.jobs.map((job) => (job.id === jobId ? fn(job) : job)),
        },
  );
  const def = { stages };
  writeJSON(DEF_KEY, def);
  set({ def });
}

// ---------- running ----------

// Run the whole pipeline with the current seed. The caller passes a clock
// snapshot so render code never reads the clock directly. The produced record
// becomes the last run and is prepended to the bounded history.
export function run(now: number): RunRecord {
  const opts: RunOptions = { now, runId: makeRunId(now) };
  const record = runPipeline(state.def, state.seed, opts);
  commitRun(record);
  return record;
}

// Retry one stage of the last run. If the stage now passes, downstream stages
// continue; the resulting record replaces the last run and the matching history
// entry so the history shows the post-retry outcome.
export function retry(stageId: string): RunRecord | null {
  if (!state.lastRun) return null;
  const record = retryStage(state.def, state.lastRun, stageId);
  const history = state.history.map((r) => (r.id === record.id ? record : r));
  writeJSON(HISTORY_KEY, history);
  set({ lastRun: record, history });
  return record;
}

function commitRun(record: RunRecord): void {
  const history = [record, ...state.history].slice(0, HISTORY_LIMIT);
  writeJSON(HISTORY_KEY, history);
  set({ lastRun: record, history });
}

// ---------- reset ----------

// Wipe persisted state and return to the seeded default pipeline.
export function resetAll(): void {
  try {
    localStorage.removeItem(DEF_KEY);
    localStorage.removeItem(SEED_KEY);
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore storage errors
  }
  state = {
    def: defaultPipeline(),
    seed: 1,
    lastRun: null,
    history: [],
  };
  emit();
}
