// Aggregation helpers for the GradeView dashboard. In the real system these are
// SQL queries over the attempts table (window functions for running mastery,
// percentile_cont for the bands, a lag()-based delta for the change point). Here
// they run over the in-browser CLASS dataset, but the shapes match the queries:
// a per-learner series, class percentile bands per week, a struggle ranking, a
// week-range cross-filter, and a single-week change-point flag.

import {
  CLASS,
  LEARNERS,
  QUESTIONS,
  SKILLS,
  WEEKS,
  questionsForSkill,
  type Cell,
  type Question,
  type SkillKey,
} from './data';

// An inclusive [start, end] week range. Views cross-filter against it.
export type WeekRange = [number, number];

export function clampRange(range: WeekRange): WeekRange {
  const a = Math.max(0, Math.min(WEEKS - 1, Math.round(range[0])));
  const b = Math.max(0, Math.min(WEEKS - 1, Math.round(range[1])));
  return a <= b ? [a, b] : [b, a];
}

// ---------- per-learner mastery over time ----------

// One learner's mastery series for a skill, week by week. This is the curve the
// small-multiples panel draws per learner.
export function learnerSeries(learnerId: number, skill: SkillKey): number[] {
  const rec = CLASS[learnerId];
  if (!rec) return [];
  return rec.bySkill[skill].map((c) => c.mastery);
}

// Mean mastery for one learner over a week range, used to rank and bin learners.
export function learnerMeanInRange(learnerId: number, skill: SkillKey, range: WeekRange): number {
  const [a, b] = clampRange(range);
  const cells = CLASS[learnerId]?.bySkill[skill];
  if (!cells) return 0;
  let sum = 0;
  for (let w = a; w <= b; w++) sum += cells[w].mastery;
  return sum / (b - a + 1);
}

// ---------- class percentile bands ----------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

// One week's percentile cut of the class for a skill. p10/p25/p50/p75/p90 are
// the bands the trend chart shades; p50 is the class median line.
export type Band = {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
};

export function classBands(skill: SkillKey): Band[] {
  const out: Band[] = [];
  for (let w = 0; w < WEEKS; w++) {
    const week: number[] = [];
    for (let i = 0; i < LEARNERS; i++) week.push(CLASS[i].bySkill[skill][w].mastery);
    week.sort((a, b) => a - b);
    out.push({
      p10: percentile(week, 0.1),
      p25: percentile(week, 0.25),
      p50: percentile(week, 0.5),
      p75: percentile(week, 0.75),
      p90: percentile(week, 0.9),
    });
  }
  return out;
}

// The class median series, pulled from the bands, for convenience.
export function medianSeries(skill: SkillKey): number[] {
  return classBands(skill).map((b) => b.p50);
}

// ---------- change-point flag ----------

// The single week where the class median dropped the most from the prior week.
// In SQL this is an ORDER BY on lag()-based deltas; here it is one pass over the
// median series. delta is the size of the drop in mastery (0..1).
export type ChangePoint = { week: number; delta: number };

export function changePoint(skill: SkillKey): ChangePoint {
  const med = medianSeries(skill);
  let week = 1;
  let delta = 0;
  for (let w = 1; w < med.length; w++) {
    const d = med[w - 1] - med[w];
    if (d > delta) {
      delta = d;
      week = w;
    }
  }
  return { week, delta };
}

// A drop only counts as a flagged regression once it clears this size, so a
// skill that climbs steadily keeps the change-point note quiet.
export const CHANGE_THRESHOLD = 0.06;

export function hasRegression(skill: SkillKey): boolean {
  return changePoint(skill).delta >= CHANGE_THRESHOLD;
}

// ---------- per-skill struggle ranking ----------

// Where the class struggles most, ranked. struggleIndex is 1 minus the class
// mean mastery over the range, so a higher value means a harder skill.
export type StruggleRow = {
  skill: SkillKey;
  label: string;
  meanMastery: number;
  struggleIndex: number;
  regression: boolean;
};

export function struggleRanking(range: WeekRange): StruggleRow[] {
  const [a, b] = clampRange(range);
  const rows: StruggleRow[] = SKILLS.map((s) => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < LEARNERS; i++) {
      for (let w = a; w <= b; w++) {
        sum += CLASS[i].bySkill[s.key][w].mastery;
        n += 1;
      }
    }
    const meanMastery = n ? sum / n : 0;
    return {
      skill: s.key,
      label: s.label,
      meanMastery,
      struggleIndex: 1 - meanMastery,
      regression: hasRegression(s.key),
    };
  });
  return rows.sort((x, y) => y.struggleIndex - x.struggleIndex);
}

// ---------- cohort distribution over a week range (cross-filter) ----------

// Bin learners by their mean mastery across the selected week range. This is the
// cross-filter: move the range and the histogram redraws from the real cells in
// that window, so folding the regression week in pulls the lower bins up.
export type Cohort = {
  counts: number[];
  max: number;
  bins: number;
  median: number;
};

export function cohortDistribution(skill: SkillKey, range: WeekRange, bins = 10): Cohort {
  const means: number[] = [];
  for (let i = 0; i < LEARNERS; i++) means.push(learnerMeanInRange(i, skill, range));
  const counts = new Array(bins).fill(0);
  for (const m of means) {
    const bin = Math.min(bins - 1, Math.max(0, Math.floor(m * bins)));
    counts[bin] += 1;
  }
  const max = Math.max(...counts, 1);
  const sorted = [...means].sort((a, b) => a - b);
  return { counts, max, bins, median: percentile(sorted, 0.5) };
}

// ---------- worst questions in a skill ----------

// The questions in a skill ordered by failure rate, worst first. The drill-down
// lists these so a teacher sees exactly which items are sinking the skill.
export function worstQuestions(skill: SkillKey): Question[] {
  return questionsForSkill(skill);
}

export function allQuestions(): Question[] {
  return QUESTIONS;
}

// ---------- range summary ----------

// Total attempts the class logged in a skill over a week range, so the UI can
// report the size of the slice it is aggregating.
export function attemptsInRange(skill: SkillKey, range: WeekRange): number {
  const [a, b] = clampRange(range);
  let total = 0;
  for (let i = 0; i < LEARNERS; i++) {
    const cells: Cell[] = CLASS[i].bySkill[skill];
    for (let w = a; w <= b; w++) total += cells[w].attempts;
  }
  return total;
}
