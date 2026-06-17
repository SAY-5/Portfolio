// Deterministic engine for the task-processor simulator. A tick advances the
// whole system one discrete step:
//   1. running jobs from the previous tick resolve: each succeeds or fails based
//      on a draw from the seeded PRNG against the configured fail rate. A success
//      becomes done; a failure either re-queues (retry left) or dead-letters.
//   2. idle workers then pull the next queued jobs, up to the concurrency limit,
//      marking those jobs running for the next tick to resolve.
// No eval, no Math.random, no Date: outcomes come only from the seed, so the same
// state plus the same config always produces the same next state.

import type {
  Config,
  Job,
  Metrics,
  SimState,
  TrendPoint,
  Worker,
} from './types';

const MAX_TREND = 60;

// Mulberry32: a small, fast, well-distributed 32-bit PRNG. Returns the next
// float in [0, 1) together with the advanced seed so callers stay pure.
export function nextRandom(seed: number): { value: number; seed: number } {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, seed: t >>> 0 };
}

export function makeWorkers(concurrency: number): Worker[] {
  return Array.from({ length: concurrency }, (_, id) => ({
    id,
    busy: false,
    currentJob: null,
  }));
}

export function makeJob(id: string, label: string, tick: number): Job {
  return { id, label, status: 'queued', attempts: 0, workerId: null, updatedAt: tick };
}

// Build a fresh simulation: a batch of queued jobs, an idle worker pool sized to
// the concurrency, and a single trend point for the starting state.
export function createInitialState(config: Config, seed: number, batch: number): SimState {
  const jobs: Job[] = Array.from({ length: batch }, (_, i) =>
    makeJob(`J-${i + 1}`, `job ${i + 1}`, 0),
  );
  const state: SimState = {
    jobs,
    workers: makeWorkers(config.concurrency),
    tick: 0,
    config,
    seed,
    trend: [],
    nextId: batch + 1,
  };
  return { ...state, trend: [snapshotTrend(state)] };
}

// Resize the worker pool when concurrency changes without dropping in-flight
// work: shrinking returns any jobs held by removed workers to the queue.
export function resizeWorkers(state: SimState, concurrency: number): SimState {
  const safe = Math.max(1, Math.floor(concurrency));
  if (safe === state.workers.length) return state;

  const workers: Worker[] = [];
  const jobs = state.jobs.map((j) => ({ ...j }));

  for (let id = 0; id < safe; id++) {
    const prev = state.workers[id];
    workers.push(prev ? { ...prev } : { id, busy: false, currentJob: null });
  }
  // Return jobs that were held by workers beyond the new limit to the queue.
  for (let id = safe; id < state.workers.length; id++) {
    const held = state.workers[id]?.currentJob;
    if (!held) continue;
    const job = jobs.find((j) => j.id === held);
    if (job && job.status === 'running') {
      job.status = 'queued';
      job.workerId = null;
      job.updatedAt = state.tick;
    }
  }
  return { ...state, workers, jobs, config: { ...state.config, concurrency: safe } };
}

function clampRate(rate: number): number {
  if (Number.isNaN(rate)) return 0;
  return Math.min(1, Math.max(0, rate));
}

// Advance the system one tick. Pure: returns a new state, never mutates input.
export function tick(state: SimState): SimState {
  const { config } = state;
  let seed = state.seed;
  const jobs = state.jobs.map((j) => ({ ...j }));
  const nextTick = state.tick + 1;
  let completedThisTick = 0;

  // Phase 1: resolve everything that was running.
  for (const job of jobs) {
    if (job.status !== 'running') continue;
    const draw = nextRandom(seed);
    seed = draw.seed;
    job.attempts += 1;
    job.workerId = null;
    job.updatedAt = nextTick;

    const failed = draw.value < clampRate(config.failRate);
    if (!failed) {
      job.status = 'done';
      completedThisTick += 1;
    } else if (job.attempts > config.maxRetries) {
      job.status = 'dead';
    } else {
      job.status = 'queued';
    }
  }

  // Reset the pool: every worker is idle at the start of the dispatch phase.
  const workers: Worker[] = state.workers.map((w) => ({
    ...w,
    busy: false,
    currentJob: null,
  }));

  // Phase 2: idle workers pull the next queued jobs, oldest first, up to the
  // worker count. updatedAt ties break by id so dispatch order is deterministic.
  const queued = jobs
    .filter((j) => j.status === 'queued')
    .sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id));

  let next = 0;
  for (const worker of workers) {
    if (next >= queued.length) break;
    const job = queued[next++];
    job.status = 'running';
    job.workerId = worker.id;
    job.updatedAt = nextTick;
    worker.busy = true;
    worker.currentJob = job.id;
  }

  const advanced: SimState = { ...state, jobs, workers, tick: nextTick, seed };
  const point = snapshotTrend(advanced, completedThisTick);
  const trend = [...state.trend, point].slice(-MAX_TREND);
  return { ...advanced, trend };
}

export function computeMetrics(state: SimState, throughput = 0): Metrics {
  let queued = 0;
  let running = 0;
  let done = 0;
  let failed = 0;
  let dead = 0;
  for (const job of state.jobs) {
    if (job.status === 'queued') queued += 1;
    else if (job.status === 'running') running += 1;
    else if (job.status === 'done') done += 1;
    else if (job.status === 'failed') failed += 1;
    else if (job.status === 'dead') dead += 1;
  }
  return { queued, running, done, failed, dead, inFlight: running, throughput };
}

function snapshotTrend(state: SimState, throughput = 0): TrendPoint {
  const m = computeMetrics(state, throughput);
  return { tick: state.tick, queueDepth: m.queued, throughput: m.throughput };
}
