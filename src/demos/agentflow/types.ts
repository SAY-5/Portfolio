// AgentFlow runs an ordered task pipeline. Each step is a plain unit of work
// (fetch, transform, validate, publish and the like) with a configurable
// chance of flaking, a retry budget, and an exponential backoff. The runner
// is fully deterministic: given the same definition and seed it always
// produces the same trace, so a run can be reasoned about and replayed.

// A single ordered task in the pipeline.
export type Step = {
  id: string;
  name: string;
  // Probability in [0, 1] that any one attempt of this step flakes.
  failureRate: number;
  // Extra retries allowed after the first attempt fails.
  maxRetries: number;
  // First backoff in ms; doubled on each subsequent retry.
  baseBackoffMs: number;
};

// The full pipeline plus the seed that drives the deterministic runner.
export type Workflow = {
  steps: Step[];
  seed: number;
};

// Why a single attempt ended.
export type AttemptOutcome = 'ok' | 'retry' | 'failed';

// One attempt of one step. `backoffMs` is the wait that follows a `retry`
// before the next attempt; it is 0 for `ok` and the final `failed` attempt.
export type Attempt = {
  stepId: string;
  stepName: string;
  attempt: number;
  outcome: AttemptOutcome;
  durationMs: number;
  backoffMs: number;
};

export type RunStatus = 'ok' | 'failed';

// The result of running a whole workflow.
export type RunResult = {
  status: RunStatus;
  seed: number;
  attempts: Attempt[];
  // Step at which the run failed, or null when every step succeeded.
  failedStepId: string | null;
  // Sum of every simulated attempt duration and backoff wait.
  totalMs: number;
  finishedAt: number;
};

// A history entry kept for the run log.
export type RunRecord = {
  id: string;
  seed: number;
  status: RunStatus;
  totalMs: number;
  stepCount: number;
  attemptCount: number;
  finishedAt: number;
};
