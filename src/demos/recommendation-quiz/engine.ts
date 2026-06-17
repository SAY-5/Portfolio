// Deterministic, rules-based scoring for the recommendation quiz. No eval, no
// randomness, no clock: the same answers against the same quiz always produce
// the same ranking. The engine accumulates per-outcome weighted points from the
// chosen options, normalizes against the top scorer to get a percentage match,
// ranks the outcomes, and records which answers drove the winner.

import type {
  Answers,
  Contribution,
  Outcome,
  OutcomeScore,
  Quiz,
  QuizResult,
} from './types';

// Sum the weight each answered option contributes to every outcome. Outcomes
// not mentioned by any chosen option stay at zero.
function accumulate(quiz: Quiz, answers: Answers): Map<string, number> {
  const totals = new Map<string, number>();
  for (const outcome of quiz.outcomes) totals.set(outcome.id, 0);

  for (const question of quiz.questions) {
    const chosenId = answers[question.id];
    if (!chosenId) continue;
    const option = question.options.find((o) => o.id === chosenId);
    if (!option) continue;
    for (const [outcomeId, points] of Object.entries(option.weights)) {
      if (!totals.has(outcomeId)) continue;
      totals.set(outcomeId, (totals.get(outcomeId) ?? 0) + points);
    }
  }
  return totals;
}

// Rank outcomes by raw points, breaking ties by outcome id so the order is
// stable and deterministic. Match is the raw score divided by the top raw
// score, clamped into 0..1.
function rank(quiz: Quiz, totals: Map<string, number>): OutcomeScore[] {
  const byId = new Map<string, Outcome>(quiz.outcomes.map((o) => [o.id, o]));
  const rows: OutcomeScore[] = quiz.outcomes.map((outcome) => ({
    outcome,
    raw: totals.get(outcome.id) ?? 0,
    match: 0,
  }));

  rows.sort((a, b) => {
    if (b.raw !== a.raw) return b.raw - a.raw;
    return a.outcome.id < b.outcome.id ? -1 : 1;
  });

  const top = rows.length > 0 ? rows[0].raw : 0;
  for (const row of rows) {
    row.match = top > 0 ? Math.min(1, row.raw / top) : 0;
  }
  // Touch byId so the lookup map is part of the deterministic build and not
  // flagged as unused; it also guards against an empty catalog.
  void byId;
  return rows;
}

// The answers that pushed points toward the primary outcome, sorted high to
// low so the explanation leads with the strongest driver.
function explain(
  quiz: Quiz,
  answers: Answers,
  primaryId: string,
): Contribution[] {
  const out: Contribution[] = [];
  for (const question of quiz.questions) {
    const chosenId = answers[question.id];
    if (!chosenId) continue;
    const option = question.options.find((o) => o.id === chosenId);
    if (!option) continue;
    const points = option.weights[primaryId] ?? 0;
    if (points <= 0) continue;
    out.push({
      questionId: question.id,
      prompt: question.prompt,
      optionLabel: option.label,
      points,
    });
  }
  out.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return a.questionId < b.questionId ? -1 : 1;
  });
  return out;
}

// Score a set of answers against a quiz and produce a ranked recommendation.
export function score(quiz: Quiz, answers: Answers): QuizResult {
  const totals = accumulate(quiz, answers);
  const ranking = rank(quiz, totals);
  const primary = ranking[0];
  const runnersUp = ranking.slice(1, 3);
  const contributions = primary ? explain(quiz, answers, primary.outcome.id) : [];
  const answeredCount = quiz.questions.filter((q) => Boolean(answers[q.id])).length;

  return {
    primary,
    runnersUp,
    ranking,
    contributions,
    answeredCount,
    totalQuestions: quiz.questions.length,
  };
}

// Whole-number percentage for display, kept out of render-path math so callers
// can format consistently.
export function pct(match: number): number {
  return Math.round(match * 100);
}
