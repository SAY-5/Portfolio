// Pure scoring and pipeline engine for TalentAgent. Every function here is a
// deterministic transform of plain data: there is no eval, no dynamic code, no
// clock, and no I/O. A candidate's standing is the weighted sum of the explicit
// 0..5 ratings a reviewer entered, normalized against the rubric the role
// defines. The stage-transition rules are encoded as an explicit guard so the
// same arithmetic that ranks a candidate also decides whether they may advance.

import {
  ADVANCE_PATH,
  MAX_RATING,
  STAGES,
  type AdvanceStage,
  type Candidate,
  type Criterion,
  type Role,
  type Stage,
} from './types';

// ---------- rubric validation ----------

export const WEIGHT_TOTAL = 100;

export function weightSum(criteria: Criterion[]): number {
  return criteria.reduce((acc, c) => acc + c.weight, 0);
}

export function rubricValid(criteria: Criterion[]): boolean {
  if (criteria.length === 0) return false;
  if (criteria.some((c) => c.weight < 0 || !Number.isInteger(c.weight))) {
    return false;
  }
  return weightSum(criteria) === WEIGHT_TOTAL;
}

// ---------- scoring ----------

export type CriterionBreakdown = {
  id: string;
  label: string;
  weight: number;
  rating: number; // 0..5 as entered
  // Points this criterion contributes: weight * rating / MAX_RATING.
  points: number;
};

export type ScoredCandidate = {
  candidate: Candidate;
  breakdown: CriterionBreakdown[];
  // Sum of contributed points across criteria, on the same 0..100 scale as the
  // rubric weights, so the raw total is already a percent when the rubric is
  // valid (weights sum to 100).
  total: number;
  // Normalized percent against the achievable maximum for this rubric. Equal to
  // total when weights sum to 100, but stays meaningful for in-progress rubrics.
  percent: number;
};

function clampRating(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > MAX_RATING) return MAX_RATING;
  return value;
}

// Score one candidate against a role's rubric. The contribution of a criterion
// is its weight scaled by how much of the 0..5 rating was earned.
export function scoreCandidate(role: Role, candidate: Candidate): ScoredCandidate {
  const breakdown: CriterionBreakdown[] = role.criteria.map((c) => {
    const rating = clampRating(candidate.scores[c.id]);
    const points = (c.weight * rating) / MAX_RATING;
    return { id: c.id, label: c.label, weight: c.weight, rating, points };
  });
  const total = breakdown.reduce((acc, b) => acc + b.points, 0);
  const maxPoints = weightSum(role.criteria);
  const percent = maxPoints > 0 ? (total / maxPoints) * 100 : 0;
  return { candidate, breakdown, total, percent };
}

// Rank every candidate that belongs to a role, highest percent first. Ties
// break on name so the order is stable and reproducible.
export function rankCandidates(
  role: Role,
  candidates: Candidate[],
): ScoredCandidate[] {
  return candidates
    .filter((c) => c.roleId === role.id)
    .map((c) => scoreCandidate(role, c))
    .sort((a, b) => {
      if (b.percent !== a.percent) return b.percent - a.percent;
      return a.candidate.name.localeCompare(b.candidate.name);
    });
}

// ---------- funnel ----------

export type FunnelCounts = Record<Stage, number>;

export function funnelCounts(
  role: Role,
  candidates: Candidate[],
): FunnelCounts {
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as FunnelCounts;
  for (const c of candidates) {
    if (c.roleId === role.id) counts[c.stage] += 1;
  }
  return counts;
}

// ---------- stage transition guard ----------

export type GuardResult = { ok: boolean; reason: string };

function nextStage(stage: Stage): AdvanceStage | null {
  const idx = ADVANCE_PATH.indexOf(stage as AdvanceStage);
  if (idx === -1) return null; // not on the advancing path (rejected)
  if (idx === ADVANCE_PATH.length - 1) return null; // already at offer
  return ADVANCE_PATH[idx + 1];
}

export function nextStageOf(stage: Stage): Stage | null {
  return nextStage(stage);
}

// Decide whether a candidate may advance one step. A rejected candidate is
// terminal and can never be advanced (so they can never be offered). A
// candidate already at offer has nowhere to advance. Otherwise advancing
// requires clearing the role's minimum score threshold.
export function canAdvance(
  role: Role,
  candidate: Candidate,
): GuardResult {
  if (candidate.stage === 'rejected') {
    return {
      ok: false,
      reason: 'Rejected candidates are terminal and cannot be advanced.',
    };
  }
  const target = nextStage(candidate.stage);
  if (target === null) {
    return { ok: false, reason: 'Already at the final stage (offer).' };
  }
  const { percent } = scoreCandidate(role, candidate);
  if (percent < role.advanceThreshold) {
    return {
      ok: false,
      reason: `Score ${Math.round(percent)}% is below the ${role.advanceThreshold}% advance threshold.`,
    };
  }
  return {
    ok: true,
    reason: `Clears the ${role.advanceThreshold}% threshold; advances to ${target}.`,
  };
}

// A candidate can be rejected from any non-terminal stage.
export function canReject(candidate: Candidate): GuardResult {
  if (candidate.stage === 'rejected') {
    return { ok: false, reason: 'Already rejected.' };
  }
  return { ok: true, reason: 'Moves the candidate to the rejected stage.' };
}
