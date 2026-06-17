// Domain model for the in-browser CI/CD pipeline runner. A pipeline is an
// ordered list of stages (build then test then deploy); each stage holds jobs
// that run in parallel. Nothing here touches the network: a job's outcome is
// drawn from a seeded PRNG against its configured failure probability, so a
// given seed always produces the same run.

export type JobStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
export type StageStatus = JobStatus;
export type RunStatus = 'idle' | 'running' | 'passed' | 'failed';

// A single unit of work inside a stage. failureRate is the probability in
// [0, 1] that the job fails on a given attempt; allowFailure lets a failed job
// be tolerated so it does not sink its stage. durationMs is the simulated wall
// time the job takes.
export type JobDef = {
  id: string;
  name: string;
  failureRate: number;
  allowFailure: boolean;
  durationMs: number;
};

// An ordered stage. Its jobs run concurrently, so the stage takes as long as
// its slowest job.
export type StageDef = {
  id: string;
  name: string;
  jobs: JobDef[];
};

export type PipelineDef = {
  stages: StageDef[];
};

// The outcome of running one job during one attempt.
export type JobResult = {
  jobId: string;
  name: string;
  status: Extract<JobStatus, 'passed' | 'failed' | 'skipped'>;
  durationMs: number;
  // True when the job failed but allowFailure let the stage continue.
  tolerated: boolean;
};

export type StageResult = {
  stageId: string;
  name: string;
  status: Extract<StageStatus, 'passed' | 'failed' | 'skipped'>;
  durationMs: number;
  // Attempt number for this stage, starting at 1; a retry bumps it.
  attempt: number;
  jobs: JobResult[];
};

export type RunRecord = {
  id: string;
  seed: number;
  // Snapshot of the clock taken once at run start, never read in render.
  startedAt: number;
  status: Extract<RunStatus, 'passed' | 'failed'>;
  durationMs: number;
  stages: StageResult[];
};
