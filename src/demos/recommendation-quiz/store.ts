// Browser-side model for the recommendation quiz. It holds the seeded quiz
// definition, the in-progress answers, and a saved results history, persisting
// answers and history to localStorage. A framework-agnostic external store
// exposes subscribe/getState so the React layer can bind with
// useSyncExternalStore. No clock or randomness lives in scoring; the only
// impure values (saved-at time, ids) are produced inside explicit save actions.

import { score } from './engine';
import type { Answers, Quiz, QuizResult, SavedResult } from './types';

const ANSWERS_KEY = 'recommendation-quiz.answers.v1';
const HISTORY_KEY = 'recommendation-quiz.history.v1';

// A real product-finder quiz: six questions steer the answer toward one of four
// laptop archetypes. Weights are hand-tuned so each archetype has a clear lead
// path while sharing some overlap, which keeps the ranking interesting.
export const quiz: Quiz = {
  id: 'laptop-finder',
  title: 'Find your laptop archetype',
  intro:
    'Six questions about how you work. Each answer adds weighted points toward a set of laptop archetypes; the engine ranks them and explains the match.',
  outcomes: [
    {
      id: 'ultraportable',
      name: 'The Ultraportable',
      description:
        'A thin, light, long-battery machine tuned for travel and all-day carry over raw power.',
      tags: ['light', 'battery', 'travel'],
    },
    {
      id: 'creator',
      name: 'The Creator Rig',
      description:
        'A color-accurate, high-memory workstation for photo, video, and design work.',
      tags: ['display', 'memory', 'gpu'],
    },
    {
      id: 'developer',
      name: 'The Developer Workhorse',
      description:
        'Lots of cores and RAM with a comfortable keyboard for long compile-and-test days.',
      tags: ['cpu', 'memory', 'keyboard'],
    },
    {
      id: 'budget',
      name: 'The Everyday Value',
      description:
        'A dependable, affordable pick for browsing, docs, and streaming without overspending.',
      tags: ['price', 'simple', 'durable'],
    },
  ],
  questions: [
    {
      id: 'use',
      prompt: 'What will you spend the most time doing?',
      help: 'Pick the task that dominates your week.',
      options: [
        { id: 'use-write', label: 'Writing, email, and the web', weights: { budget: 3, ultraportable: 2 } },
        { id: 'use-code', label: 'Writing and running code', weights: { developer: 3, creator: 1 } },
        { id: 'use-media', label: 'Editing photos or video', weights: { creator: 3, developer: 1 } },
        { id: 'use-travel', label: 'Working from cafes and planes', weights: { ultraportable: 3, budget: 1 } },
      ],
    },
    {
      id: 'portability',
      prompt: 'How much does weight matter?',
      options: [
        { id: 'port-min', label: 'I rarely move it', weights: { creator: 2, developer: 2 } },
        { id: 'port-some', label: 'Around the house or office', weights: { developer: 1, budget: 1 } },
        { id: 'port-max', label: 'It lives in my bag', weights: { ultraportable: 3, budget: 1 } },
      ],
    },
    {
      id: 'budget',
      prompt: 'What is your spend comfort zone?',
      options: [
        { id: 'bud-low', label: 'Keep it affordable', weights: { budget: 3, ultraportable: 1 } },
        { id: 'bud-mid', label: 'Mid-range is fine', weights: { developer: 2, ultraportable: 1 } },
        { id: 'bud-high', label: 'Pay for the best', weights: { creator: 3, developer: 1 } },
      ],
    },
    {
      id: 'display',
      prompt: 'How important is the screen?',
      options: [
        { id: 'disp-basic', label: 'Just needs to be readable', weights: { budget: 2, developer: 1 } },
        { id: 'disp-sharp', label: 'Sharp and comfortable', weights: { ultraportable: 2, developer: 1 } },
        { id: 'disp-color', label: 'Color-accurate and large', weights: { creator: 3 } },
      ],
    },
    {
      id: 'power',
      prompt: 'How heavy are your workloads?',
      options: [
        { id: 'pow-light', label: 'A few tabs at a time', weights: { budget: 2, ultraportable: 2 } },
        { id: 'pow-mid', label: 'Several apps at once', weights: { developer: 2, ultraportable: 1 } },
        { id: 'pow-heavy', label: 'Builds, renders, VMs', weights: { developer: 3, creator: 2 } },
      ],
    },
    {
      id: 'battery',
      prompt: 'What battery life do you need?',
      options: [
        { id: 'bat-plug', label: 'Usually near an outlet', weights: { creator: 2, developer: 1 } },
        { id: 'bat-day', label: 'Most of a work day', weights: { developer: 1, budget: 1 } },
        { id: 'bat-allday', label: 'All day, no charger', weights: { ultraportable: 3, budget: 1 } },
      ],
    },
  ],
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
    // storage may be unavailable (private mode); the app still works in-memory.
  }
}

// ---------- state ----------

export type Phase = 'taking' | 'result';

export type State = {
  answers: Answers;
  step: number; // current question index while taking the quiz
  phase: Phase;
  history: SavedResult[];
  // An author-editable copy of each outcome's description, keyed by outcome id.
  // The builder-lite panel writes here; scoring never reads it.
  descriptions: Record<string, string>;
};

function loadState(): State {
  return {
    answers: readJSON<Answers>(ANSWERS_KEY, {}),
    step: 0,
    phase: 'taking',
    history: readJSON<SavedResult[]>(HISTORY_KEY, []),
    descriptions: {},
  };
}

let state: State = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

// ---------- derived ----------

export function currentResult(s: State = state): QuizResult {
  return score(quiz, s.answers);
}

export function answeredCount(s: State = state): number {
  return quiz.questions.filter((q) => Boolean(s.answers[q.id])).length;
}

export function isComplete(s: State = state): boolean {
  return answeredCount(s) === quiz.questions.length;
}

export function outcomeDescription(outcomeId: string, s: State = state): string {
  const edited = s.descriptions[outcomeId];
  if (typeof edited === 'string') return edited;
  const base = quiz.outcomes.find((o) => o.id === outcomeId);
  return base ? base.description : '';
}

// ---------- actions ----------

export function answer(questionId: string, optionId: string): void {
  const answers = { ...state.answers, [questionId]: optionId };
  writeJSON(ANSWERS_KEY, answers);
  set({ answers });
}

export function goTo(step: number): void {
  const clamped = Math.max(0, Math.min(quiz.questions.length - 1, step));
  set({ step: clamped });
}

export function next(): void {
  goTo(state.step + 1);
}

export function back(): void {
  goTo(state.step - 1);
}

export function finish(): void {
  if (!isComplete()) return;
  set({ phase: 'result' });
}

// Return from the result view to the questions without discarding answers.
export function resume(): void {
  set({ phase: 'taking' });
}

export function restart(): void {
  writeJSON(ANSWERS_KEY, {});
  set({ answers: {}, step: 0, phase: 'taking' });
}

// Clear in-progress answers but keep history and the current phase.
export function clearAnswers(): void {
  writeJSON(ANSWERS_KEY, {});
  set({ answers: {}, step: 0 });
}

// Persist the completed result into history. `now` is injected by the caller so
// the store never reads the clock itself, keeping the action testable and the
// render path pure.
export function saveResult(now: number): void {
  if (!isComplete()) return;
  const result = currentResult();
  if (!result.primary) return;
  const entry: SavedResult = {
    id: `r-${now.toString(36)}`,
    savedAt: now,
    quizId: quiz.id,
    quizTitle: quiz.title,
    primaryId: result.primary.outcome.id,
    primaryName: result.primary.outcome.name,
    match: result.primary.match,
    answers: { ...state.answers },
  };
  const history = [entry, ...state.history].slice(0, 20);
  writeJSON(HISTORY_KEY, history);
  set({ history });
}

export function setDescription(outcomeId: string, text: string): void {
  const descriptions = { ...state.descriptions, [outcomeId]: text };
  set({ descriptions });
}

// Wipe persisted answers and history and reset the runtime model.
export function resetAll(): void {
  try {
    localStorage.removeItem(ANSWERS_KEY);
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore storage errors
  }
  state = {
    answers: {},
    step: 0,
    phase: 'taking',
    history: [],
    descriptions: {},
  };
  emit();
}
