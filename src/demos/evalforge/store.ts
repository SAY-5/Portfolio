// Browser-side state for the case harness. It keeps the suite (cases, chosen
// scorer, tolerance), the last run, and a short run history in localStorage so
// they survive a reload. A framework-agnostic external store drives the UI
// through useSyncExternalStore. Nothing here talks to a server: scoring is the
// pure engine over user-entered expected and actual values.

import { runSuite } from './engine';
import type {
  HistoryEntry,
  RunResult,
  ScorerId,
  Suite,
  TestCase,
} from './types';

const SUITE_KEY = 'evalforge.suite.v1';
const RUN_KEY = 'evalforge.run.v1';
const HISTORY_KEY = 'evalforge.history.v1';

// How many runs to retain for the trend.
export const HISTORY_LIMIT = 8;

export type State = {
  suite: Suite;
  lastRun: RunResult | null;
  history: HistoryEntry[];
};

// ---------- seed ----------

// A starter suite of eight cases spanning the scorer behaviours, with candidate
// outputs prefilled so a first run shows a mix of passes and failures.
function seedSuite(): Suite {
  const cases: TestCase[] = [
    {
      id: 'greet',
      input: 'Normalize the greeting',
      expected: 'hello world',
      actual: 'hello world',
    },
    {
      id: 'trim',
      input: 'Trim surrounding whitespace',
      expected: 'ready',
      actual: '  ready  ',
    },
    {
      id: 'case',
      input: 'Status keyword, any case',
      expected: 'OK',
      actual: 'ok',
    },
    {
      id: 'substr',
      input: 'Response mentions the order id',
      expected: '#4821',
      actual: 'Order #4821 ships tomorrow.',
    },
    {
      id: 'count',
      input: 'Count items in cart',
      expected: '3',
      actual: '4',
    },
    {
      id: 'price',
      input: 'Format the subtotal',
      expected: '12.50',
      actual: '$12.49',
    },
    {
      id: 'sku',
      input: 'SKU shape KB-87',
      expected: '^[A-Z]{2}-\\d{2}$',
      actual: 'KB-87',
    },
    {
      id: 'fruit',
      input: 'Exact label match',
      expected: 'apple',
      actual: 'apples',
    },
  ];
  return { cases, scorer: 'exact', tolerance: 0.5 };
}

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

function loadSuite(): Suite {
  const seed = seedSuite();
  const stored = readJSON<Partial<Suite> | null>(SUITE_KEY, null);
  if (!stored || !Array.isArray(stored.cases)) return seed;
  return {
    cases: stored.cases.map(normalizeCase),
    scorer: stored.scorer ?? seed.scorer,
    tolerance:
      typeof stored.tolerance === 'number' ? stored.tolerance : seed.tolerance,
  };
}

function normalizeCase(c: Partial<TestCase>, i: number): TestCase {
  return {
    id: typeof c.id === 'string' && c.id ? c.id : `case-${i + 1}`,
    input: typeof c.input === 'string' ? c.input : '',
    expected: typeof c.expected === 'string' ? c.expected : '',
    actual: typeof c.actual === 'string' ? c.actual : '',
  };
}

function loadState(): State {
  return {
    suite: loadSuite(),
    lastRun: readJSON<RunResult | null>(RUN_KEY, null),
    history: readJSON<HistoryEntry[]>(HISTORY_KEY, []),
  };
}

// ---------- minimal external store ----------

let state: State = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function setSuite(suite: Suite): void {
  writeJSON(SUITE_KEY, suite);
  state = { ...state, suite };
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

// ---------- id helper (deterministic, no clock) ----------

let idCounter = 0;
function makeCaseId(): string {
  idCounter += 1;
  const existing = new Set(state.suite.cases.map((c) => c.id));
  let id = `case-${state.suite.cases.length + idCounter}`;
  while (existing.has(id)) {
    idCounter += 1;
    id = `case-${state.suite.cases.length + idCounter}`;
  }
  return id;
}

// ---------- case actions ----------

export function addCase(): string {
  const id = makeCaseId();
  const next: TestCase = { id, input: '', expected: '', actual: '' };
  setSuite({ ...state.suite, cases: [...state.suite.cases, next] });
  return id;
}

export function updateCase(id: string, patch: Partial<Omit<TestCase, 'id'>>): void {
  const cases = state.suite.cases.map((c) =>
    c.id === id ? { ...c, ...patch } : c,
  );
  setSuite({ ...state.suite, cases });
}

export function deleteCase(id: string): void {
  const cases = state.suite.cases.filter((c) => c.id !== id);
  setSuite({ ...state.suite, cases });
}

// ---------- scorer + tolerance ----------

export function setScorer(scorer: ScorerId): void {
  setSuite({ ...state.suite, scorer });
}

export function setTolerance(tolerance: number): void {
  const safe = Number.isFinite(tolerance) ? Math.max(0, tolerance) : 0;
  setSuite({ ...state.suite, tolerance: safe });
}

// ---------- run ----------

// Run the suite. `at` is the caller-supplied clock snapshot so the store and
// engine never read the clock during render.
export function run(at: number): RunResult {
  const result = runSuite(state.suite, at);
  const entry: HistoryEntry = {
    at,
    scorer: result.scorer,
    passed: result.passed,
    total: result.total,
    passRate: result.passRate,
  };
  const history = [entry, ...state.history].slice(0, HISTORY_LIMIT);
  writeJSON(RUN_KEY, result);
  writeJSON(HISTORY_KEY, history);
  state = { ...state, lastRun: result, history };
  emit();
  return result;
}

// ---------- reset ----------

// Clear all persisted state and reseed the suite.
export function resetAll(): void {
  try {
    localStorage.removeItem(SUITE_KEY);
    localStorage.removeItem(RUN_KEY);
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore storage errors
  }
  idCounter = 0;
  state = { suite: seedSuite(), lastRun: null, history: [] };
  emit();
}
