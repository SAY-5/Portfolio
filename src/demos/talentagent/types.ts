// Domain model for the TalentAgent applicant-tracking and scoring app. The
// whole thing runs in the browser: a role carries a weighted rubric whose
// criteria weights sum to 100, and each candidate carries an explicit human
// entered score from 0 to 5 against every criterion. Ranking and the funnel
// are pure functions of that data, so the result a reviewer sees is always the
// arithmetic of the rubric they defined, never an opaque guess.

// The hiring stages a candidate moves through, ordered from first contact to a
// terminal outcome. "rejected" is terminal and sits outside the linear path.
export const STAGES = [
  'applied',
  'screen',
  'interview',
  'offer',
  'rejected',
] as const;

export type Stage = (typeof STAGES)[number];

// The advancing path, in order. "rejected" is deliberately excluded: it is a
// terminal side exit reachable from any active stage, not a step you progress
// into by advancing.
export const ADVANCE_PATH = [
  'applied',
  'screen',
  'interview',
  'offer',
] as const;

export type AdvanceStage = (typeof ADVANCE_PATH)[number];

// One rubric line on a role. weight is a whole number of points; the weights of
// all criteria on a role are validated to sum to exactly 100.
export type Criterion = {
  id: string;
  label: string;
  weight: number; // 0..100, integer; all criteria on a role sum to 100
};

export type Role = {
  id: string;
  title: string;
  criteria: Criterion[];
  // Minimum normalized percent a candidate must reach before they can be
  // advanced out of their current stage. Set by the user.
  advanceThreshold: number; // 0..100
};

// A candidate scored against a single role's rubric. scores maps a criterion id
// to a 0..5 rating entered by a reviewer. Missing entries read as 0.
export type Candidate = {
  id: string;
  roleId: string;
  name: string;
  headline: string;
  stage: Stage;
  scores: Record<string, number>; // criterionId -> 0..5
};

export type Persisted = {
  roles: Role[];
  candidates: Candidate[];
};

// The maximum rating any single criterion can receive. Scores are entered on a
// 0..5 scale so a perfect candidate earns the criterion's full weight.
export const MAX_RATING = 5;
