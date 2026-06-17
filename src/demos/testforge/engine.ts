// Pure analysis over recorded suites, cases, and runs. Every function here is a
// referentially transparent reduction over its inputs: no eval, no wall clock,
// no randomness, no I/O. The store owns mutation and persistence; this module
// only reads. Keeping it pure makes the insights deterministic and testable.

import type {
  CaseResult,
  CaseStatus,
  FlakyCase,
  Run,
  RunSummary,
  SlowCase,
  Suite,
  SuiteHealth,
  TestCase,
  TrendPoint,
} from './types';

// How many recent runs flaky detection and slow-case ranking look back over.
export const RECENT_WINDOW = 8;

// ---------- per-run aggregation ----------

export function summarize(run: Run): RunSummary {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let durationMs = 0;
  for (const r of run.results) {
    durationMs += r.durationMs;
    if (r.status === 'pass') passed += 1;
    else if (r.status === 'fail') failed += 1;
    else skipped += 1;
  }
  const executed = passed + failed;
  return {
    total: run.results.length,
    passed,
    failed,
    skipped,
    passRate: executed === 0 ? 0 : passed / executed,
    durationMs,
  };
}

// ---------- run history for a suite, oldest first ----------

export function suiteRuns(runs: Run[], suiteId: string): Run[] {
  return runs
    .filter((r) => r.suiteId === suiteId)
    .slice()
    .sort((a, b) => a.seq - b.seq);
}

export function recentRuns(runs: Run[], suiteId: string, window = RECENT_WINDOW): Run[] {
  const ordered = suiteRuns(runs, suiteId);
  return ordered.slice(Math.max(0, ordered.length - window));
}

// ---------- pass-rate trend ----------

export function passRateTrend(runs: Run[], suiteId: string): TrendPoint[] {
  return suiteRuns(runs, suiteId).map((run) => {
    const s = summarize(run);
    return {
      runId: run.id,
      seq: run.seq,
      passRate: s.passRate,
      passed: s.passed,
      failed: s.failed,
      skipped: s.skipped,
    };
  });
}

// ---------- flaky detection ----------

// A case is flaky when, across the recent window, it has at least one pass and
// at least one fail. Skips are recorded in the history but do not, on their own,
// make a case flaky. History is oldest-first so the UI can show the flip order.
export function flakyCases(
  runs: Run[],
  cases: TestCase[],
  suiteId: string,
  window = RECENT_WINDOW,
): FlakyCase[] {
  const recent = recentRuns(runs, suiteId, window);
  const nameById = new Map(cases.map((c) => [c.id, c.name]));
  const history = new Map<string, CaseStatus[]>();

  for (const run of recent) {
    for (const res of run.results) {
      const list = history.get(res.caseId) ?? [];
      list.push(res.status);
      history.set(res.caseId, list);
    }
  }

  const flaky: FlakyCase[] = [];
  for (const [caseId, statuses] of history) {
    const passes = statuses.filter((s) => s === 'pass').length;
    const fails = statuses.filter((s) => s === 'fail').length;
    if (passes > 0 && fails > 0) {
      flaky.push({
        caseId,
        name: nameById.get(caseId) ?? caseId,
        passes,
        fails,
        history: statuses,
      });
    }
  }
  // Most volatile first: more flips (min of passes/fails) ranks higher.
  flaky.sort((a, b) => Math.min(b.passes, b.fails) - Math.min(a.passes, a.fails));
  return flaky;
}

export function isFlaky(
  runs: Run[],
  cases: TestCase[],
  suiteId: string,
  caseId: string,
  window = RECENT_WINDOW,
): boolean {
  return flakyCases(runs, cases, suiteId, window).some((f) => f.caseId === caseId);
}

// ---------- slowest-case ranking ----------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

export function slowestCases(
  runs: Run[],
  cases: TestCase[],
  suiteId: string,
  window = RECENT_WINDOW,
): SlowCase[] {
  const recent = recentRuns(runs, suiteId, window);
  const nameById = new Map(cases.map((c) => [c.id, c.name]));
  const durations = new Map<string, number[]>();

  for (const run of recent) {
    for (const res of run.results) {
      // Skipped cases do no work, so they do not count toward slowness.
      if (res.status === 'skip') continue;
      const list = durations.get(res.caseId) ?? [];
      list.push(res.durationMs);
      durations.set(res.caseId, list);
    }
  }

  const ranked: SlowCase[] = [];
  for (const [caseId, ds] of durations) {
    if (ds.length === 0) continue;
    ranked.push({
      caseId,
      name: nameById.get(caseId) ?? caseId,
      medianMs: median(ds),
      maxMs: Math.max(...ds),
      samples: ds.length,
    });
  }
  ranked.sort((a, b) => b.medianMs - a.medianMs);
  return ranked;
}

// ---------- suite health ----------

export function suiteHealth(
  runs: Run[],
  suites: Suite[],
  cases: TestCase[],
  suiteId: string,
): SuiteHealth {
  const suite = suites.find((s) => s.id === suiteId);
  const caseIds = suite ? suite.caseIds : [];
  const suiteCases = cases.filter((c) => caseIds.includes(c.id));
  const ordered = suiteRuns(runs, suiteId);

  const rates = ordered.map((r) => summarize(r).passRate);
  const lastPassRate = rates.length ? rates[rates.length - 1] : null;
  const meanPassRate = rates.length
    ? rates.reduce((sum, v) => sum + v, 0) / rates.length
    : null;

  return {
    suiteId,
    runs: ordered.length,
    caseCount: suiteCases.length,
    activeCount: suiteCases.filter((c) => c.state === 'active').length,
    lastPassRate,
    meanPassRate,
    flakyCount: flakyCases(runs, cases, suiteId).length,
  };
}

// ---------- helper used by both the store and the UI ----------

// Last recorded status of a case within a suite, or null when never run.
export function lastStatus(
  runs: Run[],
  suiteId: string,
  caseId: string,
): CaseStatus | null {
  const ordered = suiteRuns(runs, suiteId);
  for (let i = ordered.length - 1; i >= 0; i--) {
    const hit = ordered[i].results.find((r: CaseResult) => r.caseId === caseId);
    if (hit) return hit.status;
  }
  return null;
}
