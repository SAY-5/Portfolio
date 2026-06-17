// GovGate models a compliance assessment. A policy framework is an ordered set
// of controls. Each control belongs to a category, states a requirement, and
// carries a weight (how much it counts toward the score) and a severity (how bad
// it is to leave it open). An assessment maps each control to a status with a
// short note. The engine turns an assessment into a weighted compliance score, a
// per-category breakdown, a pass or fail gate against a threshold, and a
// prioritized remediation list. Every type here is plain data so the engine can
// stay a pure, eval-free transform.

// How serious an open control is. Used to rank remediation work.
export type Severity = 'low' | 'medium' | 'high' | 'critical';

// Where a control stands in an assessment.
//  - met:     the requirement is fully satisfied (full credit)
//  - partial: partly satisfied (half credit)
//  - not-met: not satisfied (no credit, surfaces in remediation)
//  - n-a:     not applicable, excluded from the score denominator
export type ControlStatus = 'met' | 'partial' | 'not-met' | 'n-a';

// A single requirement in the framework.
export type Control = {
  id: string;
  category: string;
  // Short name shown as the control heading.
  title: string;
  // The full requirement text the assessor checks against.
  requirement: string;
  // Relative importance toward the weighted score. Higher counts for more.
  weight: number;
  severity: Severity;
};

export type Framework = {
  id: string;
  name: string;
  // The threshold a compliance percent must reach to pass the gate, 0 to 100.
  controls: Control[];
};

// The recorded outcome for one control within an assessment.
export type ControlResult = {
  status: ControlStatus;
  note: string;
};

// An assessment is keyed by control id, plus the configurable pass threshold.
export type Assessment = {
  // Map of control id to its recorded result.
  results: Record<string, ControlResult>;
  // Pass mark as a percent, 0 to 100. The gate passes when score >= threshold.
  threshold: number;
};

// ---------- engine output shapes ----------

// The weighted compliance score for the whole assessment.
export type Score = {
  // Earned weight as a percent of applicable weight, rounded to a whole number.
  percent: number;
  // Sum of weight earned (met = full, partial = half).
  earned: number;
  // Sum of weight in scope (everything except n-a controls).
  applicable: number;
  // Whether percent meets or beats the threshold.
  passed: boolean;
  threshold: number;
};

// A per-category roll-up of the same weighted math.
export type CategoryBreakdown = {
  category: string;
  percent: number;
  earned: number;
  applicable: number;
  counts: StatusCounts;
};

// Tally of how many controls sit in each status.
export type StatusCounts = {
  met: number;
  partial: number;
  'not-met': number;
  'n-a': number;
  total: number;
};

// One row in the prioritized remediation list.
export type RemediationItem = {
  control: Control;
  status: Extract<ControlStatus, 'not-met' | 'partial'>;
  note: string;
  // severity rank x weight, used to sort the list (higher first).
  priority: number;
};
