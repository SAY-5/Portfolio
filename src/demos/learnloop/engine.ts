// The adaptive-practice engine. These are the pure functions the session store
// builds on: the Elo update applied on every answer, the question selector that
// targets the desirable-difficulty sweet spot, and the mastery model that
// buckets a rating. Keeping them pure makes the behaviour easy to reason about
// and matches the server-side engine the real service runs.

import type { Question, Skill } from './data';

// Standard Elo parameters. K is the maximum rating move per answer. TARGET is
// the desirable-difficulty sweet spot: a question the learner is expected to get
// right about 70 percent of the time. COOLDOWN is how many of the most recent
// items the selector skips so it does not repeat a question right away.
export const K = 32;
export const TARGET = 0.7;
export const COOLDOWN = 3;
export const START_RATING = 1300;

// The shared rating scale the rail and difficulty markers are drawn on.
export const SCALE_MIN = 1050;
export const SCALE_MAX = 1700;

// Expected probability that a learner of `learner` rating answers a question of
// `qDiff` difficulty correctly. This is the logistic Elo expectation; a 400
// point gap is about a 91 percent expectation, an equal rating is 50 percent.
export function expectedSuccess(learner: number, qDiff: number): number {
  return 1 / (1 + Math.pow(10, (qDiff - learner) / 400));
}

// The Elo update. `actual` is 1 for a correct answer and 0 for a wrong one. The
// rating moves by K times the surprise (actual minus expected), so beating a
// hard question gains more than beating an easy one, and missing an easy
// question costs more than missing a hard one.
export function ratingDelta(learner: number, qDiff: number, correct: boolean): number {
  const actual = correct ? 1 : 0;
  return K * (actual - expectedSuccess(learner, qDiff));
}

// Apply one answer and return the new, rounded rating.
export function applyAnswer(learner: number, qDiff: number, correct: boolean): number {
  return Math.round(learner + ratingDelta(learner, qDiff, correct));
}

export type Bucket = 'novice' | 'developing' | 'proficient' | 'mastered';

export const BUCKETS: { id: Bucket; label: string; min: number }[] = [
  { id: 'novice', label: 'Novice', min: -Infinity },
  { id: 'developing', label: 'Developing', min: 1250 },
  { id: 'proficient', label: 'Proficient', min: 1430 },
  { id: 'mastered', label: 'Mastered', min: 1580 },
];

// Mastery is bucketed from the rolling per-skill rating. The thresholds are the
// same ones the event-sourced log derives mastery from server-side.
export function bucketFor(rating: number): Bucket {
  let current: Bucket = 'novice';
  for (const b of BUCKETS) {
    if (rating >= b.min) current = b.id;
  }
  return current;
}

export function bucketLabel(bucket: Bucket): string {
  return BUCKETS.find((b) => b.id === bucket)?.label ?? bucket;
}

// Map a rating onto a 0..100 position on the shared scale, clamped so a marker
// never runs off the rail.
export function scalePct(rating: number): number {
  const raw = ((rating - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
  return Math.max(0, Math.min(100, raw));
}

export type Ranked = {
  q: Question;
  expected: number;
  onCooldown: boolean;
  // Distance from the 70 percent target; the selector minimises this among
  // eligible items.
  dist: number;
};

// Rank a pool of questions for a learner rating. Every item gets its expected
// success and its distance from the target, and is flagged if it is one of the
// recently-seen ids still in cooldown.
export function rank(pool: Question[], learner: number, recent: string[]): Ranked[] {
  return pool
    .map((q) => {
      const expected = expectedSuccess(learner, q.diff);
      return {
        q,
        expected,
        onCooldown: recent.includes(q.id),
        dist: Math.abs(expected - TARGET),
      };
    })
    .sort((a, b) => a.dist - b.dist);
}

// The selector: among items not in cooldown, choose the one whose expected
// success is closest to the 70 percent target. If every item is in cooldown
// (a small pool) fall back to the overall closest so practice never stalls.
export function selectNext(
  pool: Question[],
  learner: number,
  recent: string[],
): Question | undefined {
  if (pool.length === 0) return undefined;
  const ranked = rank(pool, learner, recent);
  const eligible = ranked.find((r) => !r.onCooldown);
  return (eligible ?? ranked[0]).q;
}

// Per-skill rating map. A fresh learner starts every skill at START_RATING.
export type Ratings = Record<Skill, number>;

export function freshRatings(skills: Skill[]): Ratings {
  const out = {} as Ratings;
  for (const s of skills) out[s] = START_RATING;
  return out;
}
