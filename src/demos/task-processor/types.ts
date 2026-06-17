// Domain model for the task-processor simulator: a job queue drained by a pool
// of concurrent workers. A job moves queued -> running -> done | failed, and a
// failed job re-queues until it exhausts its retries, at which point it lands in
// the dead-letter queue as dead. Everything is deterministic for a given seed so
// the same starting state always advances the same way.

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'dead';

export type Job = {
  id: string;
  label: string;
  status: JobStatus;
  // How many times this job has been attempted (incremented when a worker
  // finishes running it, whether it succeeded or failed).
  attempts: number;
  // Worker currently holding the job, or null when not running.
  workerId: number | null;
  // Tick at which the job entered its current status, for ordering and display.
  updatedAt: number;
};

export type Worker = {
  id: number;
  busy: boolean;
  // Id of the job this worker is processing, or null when idle.
  currentJob: string | null;
};

export type Config = {
  // Number of workers that can run jobs at the same time.
  concurrency: number;
  // Attempts allowed before a job is dead-lettered. maxRetries of 2 means up to
  // 3 total attempts (1 initial + 2 retries).
  maxRetries: number;
  // Probability in [0, 1] that any single attempt fails, applied through the
  // seeded PRNG rather than Math.random so runs are reproducible.
  failRate: number;
};

// Counts the UI reads for its metric tiles. Derived from jobs on each tick.
export type Metrics = {
  queued: number;
  running: number;
  done: number;
  failed: number;
  dead: number;
  inFlight: number;
  // Jobs completed (done) during the most recent tick.
  throughput: number;
};

// A single point in the per-tick history the trend chart renders.
export type TrendPoint = {
  tick: number;
  queueDepth: number;
  throughput: number;
};

export type SimState = {
  jobs: Job[];
  workers: Worker[];
  tick: number;
  config: Config;
  // PRNG state, advanced deterministically as outcomes are drawn.
  seed: number;
  trend: TrendPoint[];
  // Running counter so enqueued jobs get stable, unique ids.
  nextId: number;
};
