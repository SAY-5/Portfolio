// Deterministic, side-effect-free workflow runner. No eval, no Math.random,
// no real timers: a seeded PRNG decides whether each attempt flakes, and all
// durations and backoffs are simulated numbers, so an identical workflow and
// seed always yield an identical trace.

import type {
  Attempt,
  RunRecord,
  RunResult,
  Step,
  Workflow,
} from './types';

// Mulberry32: a small, fast, well-distributed 32-bit PRNG. Pure given its
// state, so the whole runner stays deterministic.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Derive a stable per-step seed so editing or reordering one step does not
// reshuffle the luck of every other step in surprising ways.
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// Simulated work duration for an attempt, drawn deterministically from the
// step's own random stream so it reads like real but reproducible jitter.
function simulatedDuration(rng: () => number): number {
  return 40 + Math.round(rng() * 160);
}

// Run one workflow start to finish and return the full trace. `clockNow` is
// the snapshot of the wall clock taken in render state by the caller, kept out
// of this module so the runner itself stays pure.
export function runWorkflow(wf: Workflow, clockNow: number): RunResult {
  const attempts: Attempt[] = [];
  let totalMs = 0;
  let failedStepId: string | null = null;
  let status: RunResult['status'] = 'ok';

  for (const step of wf.steps) {
    const rng = mulberry32((wf.seed >>> 0) ^ hashString(step.id));
    const rate = clamp01(step.failureRate);
    const budget = Math.max(0, Math.floor(step.maxRetries));
    let stepSucceeded = false;

    for (let attempt = 1; attempt <= budget + 1; attempt++) {
      const flaked = rng() < rate;
      const duration = simulatedDuration(rng);
      totalMs += duration;

      const isLastAttempt = attempt === budget + 1;

      if (!flaked) {
        attempts.push({
          stepId: step.id,
          stepName: step.name,
          attempt,
          outcome: 'ok',
          durationMs: duration,
          backoffMs: 0,
        });
        stepSucceeded = true;
        break;
      }

      if (isLastAttempt) {
        // Retry budget exhausted: the step, and the run, fail here.
        attempts.push({
          stepId: step.id,
          stepName: step.name,
          attempt,
          outcome: 'failed',
          durationMs: duration,
          backoffMs: 0,
        });
        break;
      }

      // Flaked with budget remaining: wait an exponential backoff and retry.
      const backoff = step.baseBackoffMs * Math.pow(2, attempt - 1);
      totalMs += backoff;
      attempts.push({
        stepId: step.id,
        stepName: step.name,
        attempt,
        outcome: 'retry',
        durationMs: duration,
        backoffMs: backoff,
      });
    }

    if (!stepSucceeded) {
      status = 'failed';
      failedStepId = step.id;
      break;
    }
  }

  return {
    status,
    seed: wf.seed,
    attempts,
    failedStepId,
    totalMs,
    finishedAt: clockNow,
  };
}

// Condense a result into a compact history record.
export function toRecord(result: RunResult, id: string): RunRecord {
  const stepIds = new Set(result.attempts.map((a) => a.stepId));
  return {
    id,
    seed: result.seed,
    status: result.status,
    totalMs: result.totalMs,
    stepCount: stepIds.size,
    attemptCount: result.attempts.length,
    finishedAt: result.finishedAt,
  };
}

// A small starter pipeline so the demo opens with something runnable.
export function defaultSteps(): Step[] {
  return [
    { id: 'fetch', name: 'fetch', failureRate: 0.35, maxRetries: 2, baseBackoffMs: 100 },
    { id: 'transform', name: 'transform', failureRate: 0.15, maxRetries: 1, baseBackoffMs: 120 },
    { id: 'validate', name: 'validate', failureRate: 0.5, maxRetries: 3, baseBackoffMs: 80 },
    { id: 'publish', name: 'publish', failureRate: 0.2, maxRetries: 2, baseBackoffMs: 150 },
  ];
}
