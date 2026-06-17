// Pure, deterministic triage engine. No eval, no randomness, no clock reads.
// Every function is a total mapping from its inputs, so the same bug always
// scores the same way and the UI can explain each result.

import type {
  Bug,
  Completeness,
  DuplicateCandidate,
  Reproducibility,
  Severity,
  SeverityResult,
  UserImpact,
} from './types';

// ---------- severity ----------

// Weighted points for how badly a bug hurts the user. data-loss dominates.
const IMPACT_POINTS: Record<UserImpact, number> = {
  'data-loss': 50,
  outage: 40,
  broken: 26,
  degraded: 14,
  cosmetic: 6,
};

// Multiplier for how reliably the bug reproduces. An always-on failure keeps
// its full impact; a rare one is discounted because most users never hit it.
const REPRO_FACTOR: Record<Reproducibility, number> = {
  always: 1,
  often: 0.7,
  rare: 0.4,
};

// A regression (something that used to work) adds a fixed urgency premium on
// top of the scaled impact, because shipping a regression erodes trust fast.
const REGRESSION_BONUS = 18;

// Band thresholds applied to the final score. Stated here so the UI can show
// the cutoffs alongside the computed number.
export const SEVERITY_CUTOFFS: { severity: Severity; min: number }[] = [
  { severity: 'blocker', min: 50 },
  { severity: 'critical', min: 34 },
  { severity: 'major', min: 18 },
  { severity: 'minor', min: 0 },
];

// score = round(impactPoints * reproFactor) + (regression ? REGRESSION_BONUS : 0)
// then the score is bucketed by SEVERITY_CUTOFFS into one of four bands.
export function computeSeverity(
  impact: UserImpact,
  repro: Reproducibility,
  regression: boolean,
): SeverityResult {
  const base = IMPACT_POINTS[impact];
  const factor = REPRO_FACTOR[repro];
  const scaled = Math.round(base * factor);
  const regressionPoints = regression ? REGRESSION_BONUS : 0;
  const score = scaled + regressionPoints;

  const factors = [
    { label: `impact: ${impact}`, points: base },
    { label: `reproducibility: ${repro} (x${factor})`, points: scaled - base },
    { label: 'regression premium', points: regressionPoints },
  ];

  const band =
    SEVERITY_CUTOFFS.find((c) => score >= c.min) ?? SEVERITY_CUTOFFS[SEVERITY_CUTOFFS.length - 1];

  return { severity: band.severity, score, factors };
}

export function severityOf(bug: Bug): SeverityResult {
  return computeSeverity(bug.userImpact, bug.reproducibility, bug.regression);
}

// ---------- priority ordering ----------

// Higher severity first, then regressions, then more reliable repro, then the
// older bug (FIFO) so nothing starves. Returns a comparator stable for sort.
const SEVERITY_RANK: Record<Severity, number> = {
  blocker: 3,
  critical: 2,
  major: 1,
  minor: 0,
};

const REPRO_RANK: Record<Reproducibility, number> = {
  always: 2,
  often: 1,
  rare: 0,
};

export function priorityCompare(a: Bug, b: Bug): number {
  const sa = SEVERITY_RANK[severityOf(a).severity];
  const sb = SEVERITY_RANK[severityOf(b).severity];
  if (sa !== sb) return sb - sa;
  if (a.regression !== b.regression) return a.regression ? -1 : 1;
  const ra = REPRO_RANK[a.reproducibility];
  const rb = REPRO_RANK[b.reproducibility];
  if (ra !== rb) return rb - ra;
  return a.createdAt - b.createdAt;
}

// ---------- duplicate detection ----------

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'on',
  'in',
  'to',
  'of',
  'for',
  'with',
  'when',
  'after',
  'and',
  'or',
  'it',
  'as',
  'at',
  'by',
  'be',
]);

// Lowercase, strip punctuation, split on whitespace, drop short and stop words.
export function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Similarity over the title tokens, with a component match nudging the score
// up: two bugs in the same component sharing words are likelier dupes than the
// same words spread across unrelated components.
export function bugSimilarity(a: Bug, b: Bug): number {
  const titleSim = jaccard(tokenize(a.title), tokenize(b.title));
  const sameComponent = a.component !== null && a.component === b.component ? 0.15 : 0;
  return Math.min(1, titleSim + sameComponent);
}

export const DUPLICATE_THRESHOLD = 0.34;

// Rank every other open (non-duplicate) bug by similarity to the target and
// return those over the threshold, best first. The target itself and existing
// duplicates are excluded so suggestions are always actionable.
export function findDuplicates(
  target: Bug,
  all: Bug[],
  threshold = DUPLICATE_THRESHOLD,
): DuplicateCandidate[] {
  return all
    .filter((b) => b.id !== target.id && b.duplicateOf === null)
    .map((b) => ({ bug: b, similarity: bugSimilarity(target, b) }))
    .filter((c) => c.similarity >= threshold)
    .sort((x, y) => y.similarity - x.similarity);
}

// Group bugs into clusters of likely duplicates for the dashboard view. Each
// cluster has two or more members that all exceed the pairwise threshold with
// the cluster seed. Greedy single-link clustering, deterministic by input order.
export function duplicateClusters(all: Bug[], threshold = DUPLICATE_THRESHOLD): Bug[][] {
  const open = all.filter((b) => b.duplicateOf === null);
  const seen = new Set<string>();
  const clusters: Bug[][] = [];
  for (const seed of open) {
    if (seen.has(seed.id)) continue;
    const members = [seed];
    seen.add(seed.id);
    for (const other of open) {
      if (seen.has(other.id)) continue;
      if (bugSimilarity(seed, other) >= threshold) {
        members.push(other);
        seen.add(other.id);
      }
    }
    if (members.length > 1) clusters.push(members);
  }
  return clusters;
}

// ---------- triage completeness ----------

// A bug may only leave the 'new' column once it has a component, a derivable
// severity (always true given a valid impact/repro, but listed for clarity),
// and an assignee. Returns the missing pieces so the UI can prompt for them.
export function completeness(bug: Bug): Completeness {
  const missing: string[] = [];
  if (bug.component === null) missing.push('component');
  if (bug.assignee === null) missing.push('assignee');
  // severity is always computable, but we surface it so the rule reads in full.
  if (!bug.userImpact || !bug.reproducibility) missing.push('severity');
  return { ready: missing.length === 0, missing };
}
