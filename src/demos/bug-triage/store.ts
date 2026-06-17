// Browser-side bug-triage store. Bugs live in localStorage and survive reload.
// The store is framework-agnostic: it exposes subscribe/getSnapshot so a React
// component can bind through useSyncExternalStore. All clock reads happen in
// action handlers (createBug), never in render, to keep components pure.

import type { Bug, Component, Status } from './types';
import { completeness } from './engine';

const BUGS_KEY = 'bugtriage.bugs.v1';

const HOUR = 3_600_000;

// Seed set: twelve varied reports spanning components, impacts, repro levels,
// regressions, and a couple of intentional near-duplicates (the two crash-on-
// empty-token-refresh reports, and the two slow-dashboard reports) so the
// duplicate detector has something real to surface. createdAt values are
// expressed as offsets from a base captured when the seed is first written.
type Seed = Omit<Bug, 'id' | 'createdAt'> & { ageHours: number };

const SEEDS: Seed[] = [
  {
    title: 'Token refresh crashes on empty session cookie',
    description:
      'When the session cookie is absent the refresh endpoint dereferences a null token and the whole request thread dies.',
    component: 'auth',
    reproducibility: 'always',
    userImpact: 'outage',
    regression: true,
    status: 'new',
    assignee: null,
    duplicateOf: null,
    ageHours: 2,
  },
  {
    title: 'Crash on token refresh when cookie is missing',
    description:
      'Refreshing the auth token with no cookie present throws a null pointer and logs the user out across every tab.',
    component: 'auth',
    reproducibility: 'always',
    userImpact: 'broken',
    regression: true,
    status: 'new',
    assignee: null,
    duplicateOf: null,
    ageHours: 5,
  },
  {
    title: 'Checkout double-charges card on retry',
    description:
      'If the payment confirmation times out the client retries and the gateway captures the amount twice.',
    component: 'billing',
    reproducibility: 'often',
    userImpact: 'data-loss',
    regression: false,
    status: 'new',
    assignee: null,
    duplicateOf: null,
    ageHours: 9,
  },
  {
    title: 'Dashboard loads slowly with many widgets',
    description:
      'A dashboard with more than thirty widgets takes over eight seconds to paint because every widget fetches independently.',
    component: 'ui',
    reproducibility: 'often',
    userImpact: 'degraded',
    regression: false,
    status: 'new',
    assignee: null,
    duplicateOf: null,
    ageHours: 14,
  },
  {
    title: 'Slow dashboard render when widget count is high',
    description:
      'Loading a busy dashboard is painfully slow; the main thread blocks while dozens of widgets resolve their data.',
    component: 'ui',
    reproducibility: 'often',
    userImpact: 'degraded',
    regression: false,
    status: 'new',
    assignee: null,
    duplicateOf: null,
    ageHours: 20,
  },
  {
    title: 'Export to CSV drops the last row',
    description:
      'Exporting a report omits the final row because the writer flushes before the last record is appended.',
    component: 'data',
    reproducibility: 'always',
    userImpact: 'broken',
    regression: false,
    status: 'triaged',
    assignee: 'priya',
    duplicateOf: null,
    ageHours: 26,
  },
  {
    title: 'API returns 500 on pagination past last page',
    description:
      'Requesting a page beyond the result set returns a 500 instead of an empty page.',
    component: 'api',
    reproducibility: 'always',
    userImpact: 'broken',
    regression: false,
    status: 'new',
    assignee: null,
    duplicateOf: null,
    ageHours: 31,
  },
  {
    title: 'Build fails intermittently on cold cache',
    description:
      'A clean CI build sometimes fails resolving a transitive dependency until the cache warms up.',
    component: 'build',
    reproducibility: 'rare',
    userImpact: 'degraded',
    regression: false,
    status: 'new',
    assignee: null,
    duplicateOf: null,
    ageHours: 40,
  },
  {
    title: 'Tooltip text overflows on narrow screens',
    description: 'On phones the tooltip text spills outside its container and clips at the edge.',
    component: 'ui',
    reproducibility: 'always',
    userImpact: 'cosmetic',
    regression: false,
    status: 'new',
    assignee: null,
    duplicateOf: null,
    ageHours: 52,
  },
  {
    title: 'Search index misses recently created records',
    description:
      'Newly created records do not appear in search for up to a minute because the index refresh lags writes.',
    component: 'core',
    reproducibility: 'often',
    userImpact: 'degraded',
    regression: false,
    status: 'in-progress',
    assignee: 'mateo',
    duplicateOf: null,
    ageHours: 64,
  },
  {
    title: 'Webhook signature check rejects valid payloads',
    description:
      'Valid webhook payloads are rejected because the signature is computed over the parsed body rather than the raw bytes.',
    component: 'api',
    reproducibility: 'always',
    userImpact: 'broken',
    regression: true,
    status: 'new',
    assignee: null,
    duplicateOf: null,
    ageHours: 78,
  },
  {
    title: 'Docs link to removed configuration flag',
    description: 'The setup guide references a flag that was deleted two releases ago.',
    component: 'docs',
    reproducibility: 'always',
    userImpact: 'cosmetic',
    regression: false,
    status: 'closed',
    assignee: 'priya',
    duplicateOf: null,
    ageHours: 96,
  },
];

// ---------- persistence ----------

function readBugs(): Bug[] | null {
  try {
    const raw = localStorage.getItem(BUGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Bug[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeBugs(bugs: Bug[]): void {
  try {
    localStorage.setItem(BUGS_KEY, JSON.stringify(bugs));
  } catch {
    // storage may be unavailable (private mode); the app still works in memory.
  }
}

let counter = 0;
function makeId(): string {
  counter += 1;
  return `BUG-${String(counter).padStart(4, '0')}`;
}

// Build the seed list against a base timestamp captured once, here in module
// init (not in render), so createdAt is a real epoch the UI can format.
function buildSeed(): Bug[] {
  const base = Date.now();
  // Keep the id counter ahead of the seed count for fresh creates.
  return SEEDS.map((s) => {
    const { ageHours, ...rest } = s;
    return { ...rest, id: makeId(), createdAt: base - ageHours * HOUR };
  });
}

function loadBugs(): Bug[] {
  const stored = readBugs();
  if (stored && stored.length > 0) {
    // Advance the id counter past any persisted ids so creates stay unique.
    for (const b of stored) {
      const n = Number(b.id.replace(/\D/g, ''));
      if (Number.isFinite(n) && n > counter) counter = n;
    }
    return stored;
  }
  const seeded = buildSeed();
  writeBugs(seeded);
  return seeded;
}

// ---------- store ----------

let bugs: Bug[] = loadBugs();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function commit(next: Bug[]): void {
  bugs = next;
  writeBugs(bugs);
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSnapshot(): Bug[] {
  return bugs;
}

// ---------- actions ----------

export type NewBugInput = Pick<
  Bug,
  'title' | 'description' | 'component' | 'reproducibility' | 'userImpact' | 'regression'
> & { assignee?: string | null };

// Create a bug. The clock is read here, in the action, never during render.
export function createBug(input: NewBugInput): Bug {
  const bug: Bug = {
    id: makeId(),
    title: input.title.trim(),
    description: input.description.trim(),
    component: input.component,
    reproducibility: input.reproducibility,
    userImpact: input.userImpact,
    regression: input.regression,
    status: 'new',
    assignee: input.assignee ?? null,
    duplicateOf: null,
    createdAt: Date.now(),
  };
  commit([bug, ...bugs]);
  return bug;
}

function update(id: string, patch: Partial<Bug>): void {
  commit(bugs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
}

export function setComponent(id: string, component: Component | null): void {
  update(id, { component });
}

export function setAssignee(id: string, assignee: string | null): void {
  update(id, { assignee: assignee && assignee.trim() ? assignee.trim() : null });
}

// Move a bug to a new status. Leaving 'new' is gated on triage completeness:
// a bug missing component or assignee stays put and the caller is told why.
export function setStatus(id: string, status: Status): { ok: boolean; missing: string[] } {
  const bug = bugs.find((b) => b.id === id);
  if (!bug) return { ok: false, missing: [] };
  if (bug.status === 'new' && status !== 'new') {
    const c = completeness({ ...bug, status });
    if (!c.ready) return { ok: false, missing: c.missing };
  }
  update(id, { status });
  return { ok: true, missing: [] };
}

// Mark a bug as a duplicate of another and close it. Clearing passes null.
export function markDuplicate(id: string, ofId: string | null): void {
  if (ofId === null) {
    update(id, { duplicateOf: null });
    return;
  }
  if (ofId === id) return;
  update(id, { duplicateOf: ofId, status: 'closed' });
}

// Wipe persisted state and reseed, for the dashboard reset control.
export function resetAll(): void {
  try {
    localStorage.removeItem(BUGS_KEY);
  } catch {
    // ignore storage errors
  }
  counter = 0;
  commit(buildSeed());
}
