// Data model for the recommendation quiz. A quiz is an ordered list of
// questions; every option carries weights toward one or more outcomes. The
// scoring engine accumulates those weights, normalizes them, and ranks the
// outcome catalog. Everything here is plain data so the engine can stay pure
// and deterministic.

// A single outcome a quiz can recommend.
export type Outcome = {
  id: string;
  name: string;
  description: string;
  tags: string[];
};

// One selectable answer. `weights` maps an outcome id to the points this option
// contributes toward that outcome. An option may push toward several outcomes.
export type Option = {
  id: string;
  label: string;
  weights: Record<string, number>;
};

// One question with its ordered options.
export type Question = {
  id: string;
  prompt: string;
  help?: string;
  options: Option[];
};

// A complete quiz definition: ordered questions plus the outcome catalog they
// score against.
export type Quiz = {
  id: string;
  title: string;
  intro: string;
  questions: Question[];
  outcomes: Outcome[];
};

// answers[questionId] = chosen optionId. Absent key means unanswered.
export type Answers = Record<string, string>;

// One outcome's standing after scoring: raw accumulated points plus the
// normalized 0..1 match used for the percentage shown in the UI.
export type OutcomeScore = {
  outcome: Outcome;
  raw: number;
  match: number; // 0..1, raw normalized against the top scorer
};

// Which answer pushed how many points toward the winning outcome, used to
// explain a recommendation.
export type Contribution = {
  questionId: string;
  prompt: string;
  optionLabel: string;
  points: number;
};

// The full result of scoring a set of answers against a quiz.
export type QuizResult = {
  primary: OutcomeScore;
  runnersUp: OutcomeScore[];
  ranking: OutcomeScore[];
  contributions: Contribution[]; // answers that drove the primary, high to low
  answeredCount: number;
  totalQuestions: number;
};

// A completed result saved to history.
export type SavedResult = {
  id: string;
  savedAt: number;
  quizId: string;
  quizTitle: string;
  primaryId: string;
  primaryName: string;
  match: number; // 0..1 for the primary
  answers: Answers;
};
