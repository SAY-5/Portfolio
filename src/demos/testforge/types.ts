// Domain model for the in-browser test-suite manager. A suite groups test
// cases; a case carries the steps it runs and the expectation it asserts. A run
// records one result per case (pass, fail, or skip) plus a duration, so the
// engine can aggregate counts, track history, and detect flaky cases across
// recent runs. Nothing here executes user code: a "run" is recorded data, never
// evaluated, so there is no eval and no code path that interprets input.

export type CaseStatus = 'pass' | 'fail' | 'skip';

// Authoring status of a case independent of any single run: a case can be
// active (included in runs) or skipped (recorded as skip without running).
export type CaseState = 'active' | 'skipped';

export type TestCase = {
  id: string;
  name: string;
  steps: string;
  expected: string;
  state: CaseState;
};

export type Suite = {
  id: string;
  name: string;
  description: string;
  caseIds: string[];
};

// One recorded result for a single case within a run.
export type CaseResult = {
  caseId: string;
  status: CaseStatus;
  // Deterministic, recorded duration in milliseconds. No wall clock is read.
  durationMs: number;
};

// A run is the recorded outcome of executing a suite once.
export type Run = {
  id: string;
  suiteId: string;
  // Monotonic sequence number used for ordering and labels, not a wall clock.
  seq: number;
  results: CaseResult[];
};

// Aggregated counts for a single run.
export type RunSummary = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  // Pass rate over executed (non-skipped) cases, 0..1; 0 when nothing executed.
  passRate: number;
  durationMs: number;
};

// A case that has both passed and failed across the recent run window.
export type FlakyCase = {
  caseId: string;
  name: string;
  passes: number;
  fails: number;
  // Per-run outcome over the recent window, oldest first, for a flip history.
  history: CaseStatus[];
};

// A case ranked by its typical (median) duration over recent runs.
export type SlowCase = {
  caseId: string;
  name: string;
  medianMs: number;
  maxMs: number;
  samples: number;
};

// One point on the pass-rate trend, one per run, oldest first.
export type TrendPoint = {
  runId: string;
  seq: number;
  passRate: number;
  passed: number;
  failed: number;
  skipped: number;
};

// Roll-up health for a suite over its recorded runs.
export type SuiteHealth = {
  suiteId: string;
  runs: number;
  caseCount: number;
  activeCount: number;
  // Pass rate of the most recent run, or null when the suite has never run.
  lastPassRate: number | null;
  // Mean pass rate across all recorded runs of the suite.
  meanPassRate: number | null;
  flakyCount: number;
};
