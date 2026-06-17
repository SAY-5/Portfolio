// Shared types for the in-browser case evaluation harness. A suite is a set of
// cases plus a chosen scorer. Each case carries an expected value and a slot for
// a candidate (actual) output the user pastes in. A run applies the scorer to
// every case and yields a pass/fail and a 0..1 score per case, plus an
// aggregate pass rate. Everything is deterministic: the same inputs always
// produce the same results. Nothing here makes a network call.

// Scorer identifiers. Each maps to a pure comparison in the engine.
export type ScorerId =
  | 'exact'
  | 'contains'
  | 'case-insensitive'
  | 'numeric-tolerance'
  | 'regex';

export type Scorer = {
  id: ScorerId;
  name: string;
  // Short description shown next to the selector.
  blurb: string;
  // Whether the tolerance control applies to this scorer.
  usesTolerance: boolean;
};

// A single test case. `expected` is the reference value; for the regex scorer
// it is treated as a pattern string compiled with the RegExp constructor inside
// a try/catch (never eval). `actual` is the candidate output under test.
export type TestCase = {
  id: string;
  input: string;
  expected: string;
  actual: string;
};

// The persisted suite definition.
export type Suite = {
  cases: TestCase[];
  scorer: ScorerId;
  // Absolute tolerance for the numeric scorer, e.g. 0.5 means within +/- 0.5.
  tolerance: number;
};

// Per-case outcome from a run.
export type CaseResult = {
  id: string;
  input: string;
  expected: string;
  actual: string;
  pass: boolean;
  // 0..1; for most scorers this is 1 on pass and 0 on fail, but
  // numeric-tolerance reports a graded closeness so near-misses read distinctly.
  score: number;
  // Human-readable reason, e.g. "off by 1.20" or "pattern did not match".
  detail: string;
};

// A full run snapshot: every case result plus the aggregate pass rate.
export type RunResult = {
  // Snapshot of the wall clock taken when the run was triggered, so the engine
  // and render stay pure.
  at: number;
  scorer: ScorerId;
  tolerance: number;
  results: CaseResult[];
  passed: number;
  total: number;
  // 0..1 aggregate pass rate.
  passRate: number;
};

// One entry in the run-history trend.
export type HistoryEntry = {
  at: number;
  scorer: ScorerId;
  passed: number;
  total: number;
  passRate: number;
};

export const SCORERS: Scorer[] = [
  {
    id: 'exact',
    name: 'Exact match',
    blurb: 'actual equals expected, trimmed',
    usesTolerance: false,
  },
  {
    id: 'contains',
    name: 'Contains',
    blurb: 'actual includes expected as a substring',
    usesTolerance: false,
  },
  {
    id: 'case-insensitive',
    name: 'Case-insensitive',
    blurb: 'equals expected ignoring case, trimmed',
    usesTolerance: false,
  },
  {
    id: 'numeric-tolerance',
    name: 'Numeric within tolerance',
    blurb: 'parsed numbers differ by at most the tolerance',
    usesTolerance: true,
  },
  {
    id: 'regex',
    name: 'Regex match',
    blurb: 'expected is a pattern; actual must match it',
    usesTolerance: false,
  },
];

export function scorerById(id: ScorerId): Scorer {
  return SCORERS.find((s) => s.id === id) ?? SCORERS[0];
}
