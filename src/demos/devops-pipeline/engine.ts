// Deterministic, dependency-free runner for the pipeline model. Given a
// pipeline definition and a numeric seed it produces a full RunRecord with
// per-job outcomes and durations. No eval, no Math.random: every random draw
// comes from a seeded mulberry32 PRNG so the same seed yields the same run,
// which is what lets the UI replay a run and retry a single stage reproducibly.

import type {
  JobDef,
  JobResult,
  PipelineDef,
  RunRecord,
  StageDef,
  StageResult,
} from './types';

// mulberry32: a small, fast, well-distributed 32-bit PRNG. Returns a function
// yielding floats in [0, 1). Pure given its seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Derive a stable per-stage seed so each stage draws from its own stream and a
// retry can re-seed just that stage with a fresh attempt without disturbing the
// others.
function stageSeed(seed: number, stageIndex: number, attempt: number): number {
  // Mix the inputs with odd multipliers to spread the bits.
  return (
    (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) +
      Math.imul(stageIndex + 1, 0xc2b2ae35) +
      Math.imul(attempt, 0x27d4eb2f)) >>>
    0
  );
}

// Run every job in a stage against a single PRNG stream. Jobs run in parallel,
// so the stage duration is the slowest job duration; a job fails when its draw
// falls under its failure rate. A failed job whose allowFailure is set is
// tolerated and does not fail the stage.
function runStage(
  stage: StageDef,
  seed: number,
  stageIndex: number,
  attempt: number,
): StageResult {
  const rng = mulberry32(stageSeed(seed, stageIndex, attempt));
  const jobs: JobResult[] = [];
  let stageFailed = false;
  let maxDuration = 0;

  for (const job of stage.jobs) {
    const draw = rng();
    const failed = draw < clampRate(job.failureRate);
    const tolerated = failed && job.allowFailure;
    if (failed && !job.allowFailure) stageFailed = true;
    if (job.durationMs > maxDuration) maxDuration = job.durationMs;
    jobs.push({
      jobId: job.id,
      name: job.name,
      status: failed ? 'failed' : 'passed',
      durationMs: job.durationMs,
      tolerated,
    });
  }

  return {
    stageId: stage.id,
    name: stage.name,
    status: stageFailed ? 'failed' : 'passed',
    durationMs: maxDuration,
    attempt,
    jobs,
  };
}

function clampRate(rate: number): number {
  if (Number.isNaN(rate)) return 0;
  return Math.min(1, Math.max(0, rate));
}

function skippedStage(stage: StageDef): StageResult {
  return {
    stageId: stage.id,
    name: stage.name,
    status: 'skipped',
    durationMs: 0,
    attempt: 1,
    jobs: stage.jobs.map((j: JobDef) => ({
      jobId: j.id,
      name: j.name,
      status: 'skipped' as const,
      durationMs: 0,
      tolerated: false,
    })),
  };
}

export type RunOptions = {
  // Clock value snapshotted by the caller; never read from the clock here so
  // the engine stays pure and render code stays free of Date.now impurity.
  now: number;
  // Stable id for the produced run record.
  runId: string;
};

// Run the whole pipeline. Stages run in order; the first stage that fails halts
// the pipeline and every later stage is recorded as skipped. The run passes
// only when every stage passes.
export function runPipeline(
  def: PipelineDef,
  seed: number,
  opts: RunOptions,
): RunRecord {
  const stages: StageResult[] = [];
  let halted = false;
  let total = 0;

  def.stages.forEach((stage, index) => {
    if (halted) {
      stages.push(skippedStage(stage));
      return;
    }
    const result = runStage(stage, seed, index, 1);
    stages.push(result);
    total += result.durationMs;
    if (result.status === 'failed') halted = true;
  });

  return {
    id: opts.runId,
    seed,
    startedAt: opts.now,
    status: halted ? 'failed' : 'passed',
    durationMs: total,
    stages,
  };
}

// Retry a single stage of an existing run with a fresh attempt. If the stage now
// passes, the stages after it are run in order (continuing the pipeline);
// otherwise everything downstream stays skipped. Returns a new RunRecord; the
// input is not mutated.
export function retryStage(
  def: PipelineDef,
  prior: RunRecord,
  stageId: string,
): RunRecord {
  const index = def.stages.findIndex((s) => s.id === stageId);
  if (index < 0) return prior;

  const stages: StageResult[] = prior.stages
    .slice(0, index)
    .map((s) => ({ ...s }));
  let halted = false;
  let total = stages.reduce((sum, s) => sum + s.durationMs, 0);

  const priorAttempt = prior.stages[index]?.attempt ?? 1;
  const retried = runStage(
    def.stages[index],
    prior.seed,
    index,
    priorAttempt + 1,
  );
  stages.push(retried);
  total += retried.durationMs;
  if (retried.status === 'failed') halted = true;

  for (let i = index + 1; i < def.stages.length; i++) {
    if (halted) {
      stages.push(skippedStage(def.stages[i]));
      continue;
    }
    const result = runStage(def.stages[i], prior.seed, i, 1);
    stages.push(result);
    total += result.durationMs;
    if (result.status === 'failed') halted = true;
  }

  return {
    ...prior,
    status: halted ? 'failed' : 'passed',
    durationMs: total,
    stages,
  };
}
