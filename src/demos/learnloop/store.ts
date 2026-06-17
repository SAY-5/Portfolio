// Browser-side session for LearnLoop. It holds the learner's per-skill Elo
// ratings, an event-sourced log of every answer, and the recently-seen ids the
// selector uses for cooldown. Everything persists to localStorage so a session
// survives a reload, and nothing here talks to a server: grading is done
// locally against the question bank. The store is a tiny framework-agnostic
// external store, read through useSyncExternalStore in state.ts.

import { SKILLS, bank, findQuestion, type Skill } from './data';
import {
  COOLDOWN,
  applyAnswer,
  bucketFor,
  expectedSuccess,
  freshRatings,
  selectNext,
  type Bucket,
  type Ratings,
} from './engine';

const STATE_KEY = 'learnloop.session.v1';

const skillIds = SKILLS.map((s) => s.id);

// One recorded answer. The log is append-only and the ratings are a fold over
// it, which is how the real service derives mastery from its event store.
export type LogEntry = {
  n: number;
  questionId: string;
  skill: Skill;
  prompt: string;
  correct: boolean;
  before: number; // skill rating before this answer
  after: number; // skill rating after this answer
  expected: number; // expected success the selector saw, 0..1
  at: number; // wall-clock timestamp
};

export type Session = {
  ratings: Ratings;
  recent: string[]; // most-recent-first question ids, capped at COOLDOWN
  log: LogEntry[]; // most-recent-first
  answered: number;
};

// ---------- persistence ----------

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage may be unavailable (private mode); the session still runs in-memory.
  }
}

function freshSession(): Session {
  return {
    ratings: freshRatings(skillIds),
    recent: [],
    log: [],
    answered: 0,
  };
}

function loadSession(): Session {
  const saved = readJSON<Partial<Session> | null>(STATE_KEY, null);
  if (!saved) return freshSession();
  // Merge over a fresh session so a missing or out-of-date skill still has a
  // starting rating and the shape is always complete.
  const base = freshSession();
  return {
    ratings: { ...base.ratings, ...(saved.ratings ?? {}) },
    recent: saved.recent ?? [],
    log: saved.log ?? [],
    answered: saved.answered ?? 0,
  };
}

// ---------- minimal external store ----------

let session: Session = loadSession();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function persist(): void {
  writeJSON(STATE_KEY, session);
}

function set(next: Session): void {
  session = next;
  persist();
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): Session {
  return session;
}

// ---------- selection ----------

// The next question for a skill: closest to the 70 percent target among items
// not in cooldown, given the learner's current rating for that skill.
export function nextQuestion(skill: Skill, s: Session = session) {
  const pool = bank.filter((q) => q.skill === skill);
  return selectNext(pool, s.ratings[skill], s.recent);
}

// ---------- actions ----------

// Record an answer to a question. Grades locally against the bank, applies the
// Elo update to that skill's rating, appends to the event log, and refreshes the
// cooldown window. Returns the resulting log entry for the UI, or null if the id
// is unknown.
export function submitAnswer(questionId: string, choice: number): LogEntry | null {
  const q = findQuestion(questionId);
  if (!q) return null;

  const before = session.ratings[q.skill];
  const correct = choice === q.answer;
  const expected = expectedSuccess(before, q.diff);
  const after = applyAnswer(before, q.diff, correct);
  const n = session.answered + 1;

  const entry: LogEntry = {
    n,
    questionId: q.id,
    skill: q.skill,
    prompt: q.prompt,
    correct,
    before,
    after,
    expected,
    at: Date.now(),
  };

  set({
    ratings: { ...session.ratings, [q.skill]: after },
    recent: [q.id, ...session.recent].slice(0, COOLDOWN),
    log: [entry, ...session.log],
    answered: n,
  });

  return entry;
}

// Clear the persisted session and start fresh: every skill back to the starting
// rating, an empty log, and no cooldown.
export function resetSession(): void {
  try {
    localStorage.removeItem(STATE_KEY);
  } catch {
    // ignore storage errors
  }
  set(freshSession());
}

// ---------- derived ----------

export type SkillSummary = {
  skill: Skill;
  rating: number;
  bucket: Bucket;
  answered: number;
  correct: number;
};

export function skillSummaries(s: Session = session): SkillSummary[] {
  return SKILLS.map(({ id }) => {
    const entries = s.log.filter((e) => e.skill === id);
    return {
      skill: id,
      rating: s.ratings[id],
      bucket: bucketFor(s.ratings[id]),
      answered: entries.length,
      correct: entries.filter((e) => e.correct).length,
    };
  });
}
