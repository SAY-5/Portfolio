// Deterministic scoring engine for the case harness. Every scorer is a pure
// function of (expected, actual, tolerance); the same inputs always yield the
// same result. The regex scorer compiles the pattern with the RegExp
// constructor inside a try/catch, so an invalid pattern fails the case rather
// than throwing, and nothing is ever passed to eval or the Function
// constructor.

import type {
  CaseResult,
  RunResult,
  ScorerId,
  Suite,
  TestCase,
} from './types';

function trim(s: string): string {
  return s.trim();
}

// Parse a number from a string, tolerating surrounding text like "$12.50" or
// "answer: 42". Returns null when no number is present.
function parseNumber(s: string): number | null {
  const match = s.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

// Build a RegExp safely. An invalid pattern returns null instead of throwing.
function safeRegExp(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

// Score one case. Returns a 0..1 score, a pass flag, and a short reason.
export function scoreCase(
  scorer: ScorerId,
  expected: string,
  actual: string,
  tolerance: number,
): { pass: boolean; score: number; detail: string } {
  switch (scorer) {
    case 'exact': {
      const pass = trim(actual) === trim(expected);
      return {
        pass,
        score: pass ? 1 : 0,
        detail: pass ? 'exact match' : 'differs from expected',
      };
    }
    case 'contains': {
      if (expected.length === 0) {
        return { pass: false, score: 0, detail: 'expected is empty' };
      }
      const pass = actual.includes(expected);
      return {
        pass,
        score: pass ? 1 : 0,
        detail: pass ? 'substring found' : 'substring not found',
      };
    }
    case 'case-insensitive': {
      const pass = trim(actual).toLowerCase() === trim(expected).toLowerCase();
      return {
        pass,
        score: pass ? 1 : 0,
        detail: pass ? 'match ignoring case' : 'differs ignoring case',
      };
    }
    case 'numeric-tolerance': {
      const want = parseNumber(expected);
      const got = parseNumber(actual);
      if (want === null || got === null) {
        return { pass: false, score: 0, detail: 'no number to compare' };
      }
      const tol = Math.max(0, tolerance);
      const delta = Math.abs(want - got);
      const pass = delta <= tol;
      // Graded closeness inside a window twice the tolerance, so near-misses
      // read as partial rather than zero. Falls back to a unit window when the
      // tolerance is zero.
      const window = tol > 0 ? tol * 2 : 1;
      const score = pass ? 1 : Math.max(0, 1 - delta / window);
      return {
        pass,
        score: Math.round(score * 1000) / 1000,
        detail: pass
          ? `within ${tol} (off by ${round(delta)})`
          : `off by ${round(delta)} (tolerance ${tol})`,
      };
    }
    case 'regex': {
      const re = safeRegExp(expected);
      if (re === null) {
        return { pass: false, score: 0, detail: 'invalid pattern' };
      }
      const pass = re.test(actual);
      return {
        pass,
        score: pass ? 1 : 0,
        detail: pass ? 'pattern matched' : 'pattern did not match',
      };
    }
    default:
      return { pass: false, score: 0, detail: 'unknown scorer' };
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function caseResult(
  scorer: ScorerId,
  c: TestCase,
  tolerance: number,
): CaseResult {
  const { pass, score, detail } = scoreCase(
    scorer,
    c.expected,
    c.actual,
    tolerance,
  );
  return {
    id: c.id,
    input: c.input,
    expected: c.expected,
    actual: c.actual,
    pass,
    score,
    detail,
  };
}

// Run the whole suite. `at` is the caller-supplied clock snapshot, kept as a
// parameter so the engine itself never reads Date.now() and stays pure.
export function runSuite(suite: Suite, at: number): RunResult {
  const results = suite.cases.map((c) =>
    caseResult(suite.scorer, c, suite.tolerance),
  );
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const passRate = total === 0 ? 0 : passed / total;
  return {
    at,
    scorer: suite.scorer,
    tolerance: suite.tolerance,
    results,
    passed,
    total,
    passRate,
  };
}
