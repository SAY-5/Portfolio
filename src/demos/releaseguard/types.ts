// Domain types for the in-browser release-readiness gate and canary rollout
// simulator. Everything here is plain data so the engine can stay a set of
// pure functions with no side effects and no eval.

// A threshold gate compares a numeric current value against a required bound.
// `atLeast` passes when current >= threshold (test pass %, coverage %).
// `atMost` passes when current <= threshold (open blockers, error budget).
export type ThresholdGate = {
  id: string;
  label: string;
  kind: 'threshold';
  // How the current value is compared to the threshold.
  compare: 'atLeast' | 'atMost';
  // What the value represents, used for formatting in the UI.
  unit: 'percent' | 'count';
  current: number;
  threshold: number;
  // Hard min/max the editor clamps to, so values stay sensible.
  min: number;
  max: number;
  // Step for the editor slider.
  step: number;
  // A required gate failing forces an overall NO-GO regardless of score.
  required: boolean;
  // Weight contributes to the readiness score for non-required gates and
  // required gates alike; required only changes the GO/NO-GO veto.
  weight: number;
};

// A boolean gate is a simple met / not-met condition (approvals collected,
// security scan clean).
export type BooleanGate = {
  id: string;
  label: string;
  kind: 'boolean';
  current: boolean;
  // The value that counts as passing. Almost always true, but kept explicit.
  expected: boolean;
  required: boolean;
  weight: number;
};

export type Gate = ThresholdGate | BooleanGate;

// Result of evaluating a single gate.
export type GateResult = {
  id: string;
  label: string;
  pass: boolean;
  required: boolean;
  weight: number;
  // Human-readable current vs required summary for the checklist row.
  currentText: string;
  requiredText: string;
};

export type Decision = 'GO' | 'NO-GO';

// Overall evaluation across every gate.
export type Readiness = {
  decision: Decision;
  // 0..100 weighted share of passing gates.
  score: number;
  results: GateResult[];
  passCount: number;
  total: number;
  // Required gates that are failing; non-empty means the gate vetoes GO.
  blockingIds: string[];
};

// ----- canary rollout model -----

// Ramp stages a canary advances through. Each stage exposes more traffic and
// carries a deterministic simulated error rate (percent).
export type CanaryStage = {
  // Traffic share at this stage, e.g. 1, 10, 50, 100.
  percent: number;
  // Simulated observed error rate at this stage, in percent.
  errorRate: number;
};

export type CanaryStatus = 'pending' | 'active' | 'promoted' | 'rolledback';

export type CanaryState = {
  stages: CanaryStage[];
  // Index of the stage currently being observed.
  stageIndex: number;
  status: CanaryStatus;
  // Maximum tolerated error rate (percent) before a stage rolls back.
  errorBudget: number;
};

// One step produced by advancing the canary, so the UI can explain what
// happened without re-deriving the rule.
export type CanaryStep =
  | { kind: 'promote'; from: number; to: number }
  | { kind: 'complete'; at: number }
  | { kind: 'rollback'; at: number; errorRate: number; budget: number }
  | { kind: 'noop' };
