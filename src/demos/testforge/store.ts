// Framework-agnostic store for the test-suite manager. Suites, cases, and run
// history persist in localStorage and survive a reload. All run results are
// recorded, never executed: a "simulated run" derives each case outcome from a
// deterministic seeded pattern (a small LCG keyed by suite, case index, and run
// sequence) so the same inputs always produce the same flaky flips and
// durations, with no Date.now and no Math.random. The UI binds through
// useSyncExternalStore in state.ts.

import type {
  CaseResult,
  CaseState,
  CaseStatus,
  Run,
  Suite,
  TestCase,
} from './types';

const SUITES_KEY = 'testforge.suites.v1';
const CASES_KEY = 'testforge.cases.v1';
const RUNS_KEY = 'testforge.runs.v1';
const SEQ_KEY = 'testforge.seq.v1';

export type State = {
  suites: Suite[];
  cases: TestCase[];
  runs: Run[];
  // Monotonic counters for stable ids and run sequence numbers.
  nextSeq: number;
  selectedSuiteId: string;
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

// ---------- deterministic id and seeded outcomes ----------

// Mix three small integers into a 32-bit seed without reading any clock.
function hashSeed(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// One draw from a deterministic generator in [0, 1).
function draw(seed: number): number {
  let x = (seed ^ 0x9e3779b9) >>> 0;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >> 17;
  x ^= x << 5;
  x >>>= 0;
  return x / 0xffffffff;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  // Deterministic per session order; ids only need to be unique, not random.
  return `${prefix}-${idCounter.toString(36)}`;
}

// ---------- seed data ----------

function seedState(): State {
  idCounter = 0;
  const checkout: TestCase[] = [
    {
      id: 'c-cart-add',
      name: 'adds item to cart',
      steps: 'open product, click add to cart',
      expected: 'cart count increments by one',
      state: 'active',
    },
    {
      id: 'c-cart-total',
      name: 'recomputes cart total',
      steps: 'add two items at known prices',
      expected: 'subtotal equals the sum of line totals',
      state: 'active',
    },
    {
      id: 'c-checkout-pay',
      name: 'completes payment',
      steps: 'submit a valid card on checkout',
      expected: 'order is recorded and cart clears',
      state: 'active',
    },
    {
      id: 'c-checkout-retry',
      name: 'retries on gateway timeout',
      steps: 'force a slow gateway, submit payment',
      expected: 'retry succeeds within the timeout budget',
      state: 'active',
    },
    {
      id: 'c-checkout-coupon',
      name: 'applies a coupon code',
      steps: 'enter a known coupon at checkout',
      expected: 'discount is reflected in the total',
      state: 'skipped',
    },
  ];
  const auth: TestCase[] = [
    {
      id: 'c-auth-login',
      name: 'logs in with valid credentials',
      steps: 'post a known email and password',
      expected: 'a session token is returned',
      state: 'active',
    },
    {
      id: 'c-auth-reject',
      name: 'rejects a bad password',
      steps: 'post a known email with a wrong password',
      expected: 'a 401 is returned and no session is set',
      state: 'active',
    },
    {
      id: 'c-auth-refresh',
      name: 'refreshes an expiring token',
      steps: 'present a token near expiry to refresh',
      expected: 'a new token with a later expiry is issued',
      state: 'active',
    },
  ];

  const suites: Suite[] = [
    {
      id: 's-checkout',
      name: 'Checkout flow',
      description: 'Cart math, payment, and gateway retry paths.',
      caseIds: checkout.map((c) => c.id),
    },
    {
      id: 's-auth',
      name: 'Auth service',
      description: 'Login, rejection, and token refresh.',
      caseIds: auth.map((c) => c.id),
    },
  ];

  const cases = [...checkout, ...auth];

  // Seed a few recorded runs per suite so insights have history immediately.
  let seq = 1;
  const runs: Run[] = [];
  for (const suite of suites) {
    const suiteCases = cases.filter((c) => suite.caseIds.includes(c.id));
    for (let i = 0; i < 5; i++) {
      runs.push(buildSeededRun(suite, suiteCases, seq));
      seq += 1;
    }
  }

  return {
    suites,
    cases,
    runs,
    nextSeq: seq,
    selectedSuiteId: suites[0].id,
  };
}

// Build one deterministic run for a suite: mostly-pass, with a couple of cases
// engineered to flip across run sequence numbers so flaky detection has signal.
function buildSeededRun(suite: Suite, suiteCases: TestCase[], seq: number): Run {
  const suiteHash = suite.id.split('').reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const results: CaseResult[] = suiteCases.map((tc, idx) => {
    if (tc.state === 'skipped') {
      return { caseId: tc.id, status: 'skip' as CaseStatus, durationMs: 0 };
    }
    const seed = hashSeed(suiteHash, idx, seq);
    const r = draw(seed);
    // The retry and refresh cases are the engineered flaky ones: they fail on
    // a deterministic subset of run sequences, pass otherwise.
    const flakyCase = tc.id === 'c-checkout-retry' || tc.id === 'c-auth-refresh';
    let status: CaseStatus;
    if (flakyCase) {
      status = (seq + idx) % 3 === 0 ? 'fail' : 'pass';
    } else {
      // Stable cases pass almost always; a rare deterministic dip keeps trends
      // from being a flat line.
      status = r < 0.06 ? 'fail' : 'pass';
    }
    // Durations are deterministic per case and run, with the retry case slow.
    const base = tc.id === 'c-checkout-retry' ? 180 : 20 + idx * 12;
    const jitter = Math.floor(draw(seed ^ 0x55) * 24);
    return { caseId: tc.id, status, durationMs: base + jitter };
  });
  return { id: nextId('run'), suiteId: suite.id, seq, results };
}

function loadState(): State {
  const suites = readJSON<Suite[] | null>(SUITES_KEY, null);
  const cases = readJSON<TestCase[] | null>(CASES_KEY, null);
  const runs = readJSON<Run[] | null>(RUNS_KEY, null);
  const seq = readJSON<number | null>(SEQ_KEY, null);
  if (suites && cases && runs && seq) {
    return {
      suites,
      cases,
      runs,
      nextSeq: seq,
      selectedSuiteId: suites[0]?.id ?? '',
    };
  }
  const seeded = seedState();
  persist(seeded);
  return seeded;
}

function persist(s: State): void {
  writeJSON(SUITES_KEY, s.suites);
  writeJSON(CASES_KEY, s.cases);
  writeJSON(RUNS_KEY, s.runs);
  writeJSON(SEQ_KEY, s.nextSeq);
}

// ---------- minimal external store ----------

let state: State = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  persist(state);
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

// ---------- selection ----------

export function selectSuite(suiteId: string): void {
  if (!state.suites.some((s) => s.id === suiteId)) return;
  set({ selectedSuiteId: suiteId });
}

// ---------- case actions ----------

export function addCase(
  suiteId: string,
  input: { name: string; steps: string; expected: string; state?: CaseState },
): void {
  const suite = state.suites.find((s) => s.id === suiteId);
  if (!suite) return;
  const name = input.name.trim();
  if (!name) return;
  const tc: TestCase = {
    id: nextId('case'),
    name,
    steps: input.steps.trim(),
    expected: input.expected.trim(),
    state: input.state ?? 'active',
  };
  const cases = [...state.cases, tc];
  const suites = state.suites.map((s) =>
    s.id === suiteId ? { ...s, caseIds: [...s.caseIds, tc.id] } : s,
  );
  set({ cases, suites });
}

export function updateCase(
  caseId: string,
  patch: Partial<Pick<TestCase, 'name' | 'steps' | 'expected' | 'state'>>,
): void {
  const cases = state.cases.map((c) =>
    c.id === caseId
      ? {
          ...c,
          ...patch,
          name: patch.name !== undefined ? patch.name.trim() || c.name : c.name,
        }
      : c,
  );
  set({ cases });
}

export function deleteCase(caseId: string): void {
  const cases = state.cases.filter((c) => c.id !== caseId);
  const suites = state.suites.map((s) => ({
    ...s,
    caseIds: s.caseIds.filter((id) => id !== caseId),
  }));
  // Drop the deleted case from recorded run results so history stays coherent.
  const runs = state.runs.map((run) => ({
    ...run,
    results: run.results.filter((r) => r.caseId !== caseId),
  }));
  set({ cases, suites, runs });
}

// ---------- recording a run ----------

// Record a run from explicit per-case statuses (the manual mark path).
export function recordRun(
  suiteId: string,
  marks: Record<string, CaseStatus>,
): Run | null {
  const suite = state.suites.find((s) => s.id === suiteId);
  if (!suite) return null;
  const suiteCases = state.cases.filter((c) => suite.caseIds.includes(c.id));
  const seq = state.nextSeq;
  const results: CaseResult[] = suiteCases.map((tc, idx) => {
    if (tc.state === 'skipped') {
      return { caseId: tc.id, status: 'skip', durationMs: 0 };
    }
    const status = marks[tc.id] ?? 'skip';
    const seed = hashSeed(7, idx, seq);
    const base = tc.id === 'c-checkout-retry' ? 180 : 20 + idx * 12;
    const durationMs = status === 'skip' ? 0 : base + Math.floor(draw(seed) * 24);
    return { caseId: tc.id, status, durationMs };
  });
  const run: Run = { id: nextId('run'), suiteId, seq, results };
  set({ runs: [...state.runs, run], nextSeq: seq + 1 });
  return run;
}

// Record a run from the deterministic seeded pattern (the simulate path).
export function simulateRun(suiteId: string): Run | null {
  const suite = state.suites.find((s) => s.id === suiteId);
  if (!suite) return null;
  const suiteCases = state.cases.filter((c) => suite.caseIds.includes(c.id));
  const seq = state.nextSeq;
  const run = buildSeededRun(suite, suiteCases, seq);
  set({ runs: [...state.runs, run], nextSeq: seq + 1 });
  return run;
}

// ---------- reset ----------

export function resetAll(): void {
  try {
    localStorage.removeItem(SUITES_KEY);
    localStorage.removeItem(CASES_KEY);
    localStorage.removeItem(RUNS_KEY);
    localStorage.removeItem(SEQ_KEY);
  } catch {
    // ignore storage errors
  }
  const seeded = seedState();
  persist(seeded);
  state = seeded;
  emit();
}
