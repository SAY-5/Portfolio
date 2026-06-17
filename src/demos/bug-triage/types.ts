// Core bug-triage domain model. Everything is a closed enum so the engine can
// score deterministically and the UI never has to guess at a free-text field.

export const COMPONENTS = [
  'api',
  'auth',
  'billing',
  'core',
  'data',
  'ui',
  'build',
  'docs',
] as const;
export type Component = (typeof COMPONENTS)[number];

// How reliably the bug reproduces. This is the dominant lever on severity:
// an always-reproducing crash outranks a rare cosmetic glitch.
export const REPRO = ['always', 'often', 'rare'] as const;
export type Reproducibility = (typeof REPRO)[number];

// User-facing blast radius, ordered from worst to mildest.
export const IMPACTS = ['data-loss', 'outage', 'broken', 'degraded', 'cosmetic'] as const;
export type UserImpact = (typeof IMPACTS)[number];

// Triage workflow states. A bug starts at 'new' and may only leave once the
// triage-completeness check passes (component + severity + assignee present).
export const STATUSES = ['new', 'triaged', 'in-progress', 'closed'] as const;
export type Status = (typeof STATUSES)[number];

// Computed severity band. Never set by hand: the engine derives it from
// impact x reproducibility x regression.
export const SEVERITIES = ['blocker', 'critical', 'major', 'minor'] as const;
export type Severity = (typeof SEVERITIES)[number];

export type Bug = {
  id: string;
  title: string;
  description: string;
  component: Component | null;
  reproducibility: Reproducibility;
  userImpact: UserImpact;
  regression: boolean;
  status: Status;
  assignee: string | null;
  // Marks this bug as a duplicate of another bug id once a triager merges it.
  duplicateOf: string | null;
  createdAt: number;
};

// A scored severity result with the contributing factors exposed, so the UI
// can show the user why a bug landed in a given band rather than a bare label.
export type SeverityResult = {
  severity: Severity;
  score: number;
  factors: {
    label: string;
    points: number;
  }[];
};

// A likely-duplicate candidate surfaced by token similarity.
export type DuplicateCandidate = {
  bug: Bug;
  similarity: number;
};

// Result of the triage-completeness gate for a single bug.
export type Completeness = {
  ready: boolean;
  missing: string[];
};
