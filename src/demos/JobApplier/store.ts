// Browser-side model for JobApplier. It keeps your applications and a settable
// "today" in localStorage, and exposes plain actions to add, edit, delete, and
// move applications through stages. Nothing here talks to a server and nothing
// reads the live clock: the dashboard reckons against the stored "today", which
// the user sets, so the funnel and follow-ups list are fully deterministic.

import {
  ADVANCE_PATH,
  STAGE_LABEL,
  type Application,
  type ApplicationDraft,
  type Persisted,
  type Stage,
} from './types';
import { nextStageOf } from './engine';

const KEY = 'jobapplier.v1';

// ---------- seed ----------

// A starting pipeline of ten applications spread across every stage, so the
// board, funnel, follow-ups, and response rate all have something to show on
// first load. Dates sit around the seed "today" of 2026-03-16 so a handful of
// follow-ups read as due and others as upcoming.
const SEED_TODAY = '2026-03-16';

function seedState(): Persisted {
  const applications: Application[] = [
    {
      id: 'a1',
      company: 'Northwind Labs',
      role: 'Backend Engineer',
      stage: 'wishlist',
      appliedDate: null,
      nextActionDate: '2026-03-14',
      salary: 165000,
      notes: 'Referral from Dana. Tailor resume to their payments stack.',
    },
    {
      id: 'a2',
      company: 'Vela Systems',
      role: 'Platform Engineer',
      stage: 'wishlist',
      appliedDate: null,
      nextActionDate: '2026-03-20',
      salary: null,
      notes: 'Watch for the reposted req before applying.',
    },
    {
      id: 'a3',
      company: 'Halcyon Data',
      role: 'Senior Software Engineer',
      stage: 'applied',
      appliedDate: '2026-03-02',
      nextActionDate: '2026-03-15',
      salary: 180000,
      notes: 'Applied via referral portal. Nudge recruiter if no reply.',
    },
    {
      id: 'a4',
      company: 'Brightwave',
      role: 'Full Stack Engineer',
      stage: 'applied',
      appliedDate: '2026-03-09',
      nextActionDate: '2026-03-23',
      salary: 155000,
      notes: 'Cold application. Found role on their careers page.',
    },
    {
      id: 'a5',
      company: 'Quanta Robotics',
      role: 'Embedded Engineer',
      stage: 'screen',
      appliedDate: '2026-02-24',
      nextActionDate: '2026-03-16',
      salary: 170000,
      notes: 'Recruiter screen done. Send availability for the tech screen.',
    },
    {
      id: 'a6',
      company: 'Lumen Health',
      role: 'Data Engineer',
      stage: 'screen',
      appliedDate: '2026-02-27',
      nextActionDate: '2026-03-18',
      salary: 160000,
      notes: 'Phone screen scheduled. Review their data platform docs.',
    },
    {
      id: 'a7',
      company: 'Orbit Finance',
      role: 'Staff Engineer',
      stage: 'interview',
      appliedDate: '2026-02-12',
      nextActionDate: '2026-03-17',
      salary: 215000,
      notes: 'Onsite loop next week. Prep system-design on order matching.',
    },
    {
      id: 'a8',
      company: 'Cedar Analytics',
      role: 'ML Engineer',
      stage: 'interview',
      appliedDate: '2026-02-18',
      nextActionDate: '2026-03-13',
      salary: 195000,
      notes: 'Two rounds done. Waiting on the take-home review.',
    },
    {
      id: 'a9',
      company: 'Meridian Cloud',
      role: 'Site Reliability Engineer',
      stage: 'offer',
      appliedDate: '2026-01-28',
      nextActionDate: '2026-03-19',
      salary: 205000,
      notes: 'Verbal offer received. Negotiating base and sign-on.',
    },
    {
      id: 'a10',
      company: 'Pinnacle Apps',
      role: 'Frontend Engineer',
      stage: 'rejected',
      appliedDate: '2026-02-05',
      nextActionDate: null,
      salary: 150000,
      notes: 'Passed after the tech screen. Keep for the network.',
    },
  ];
  return { applications, today: SEED_TODAY };
}

// ---------- persistence ----------

function readPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    if (!parsed || !Array.isArray(parsed.applications) || typeof parsed.today !== 'string') {
      return seedState();
    }
    return { applications: parsed.applications, today: parsed.today };
  } catch {
    return seedState();
  }
}

function writePersisted(value: Persisted): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // storage may be unavailable (private mode); the app still works in-memory.
  }
}

// ---------- minimal external store ----------

let state: Persisted = readPersisted();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

// Commit the next state, persist it, and notify subscribers.
function commit(next: Persisted): void {
  state = next;
  writePersisted(state);
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): Persisted {
  return state;
}

// ---------- id ----------

let idCounter = 0;
function makeId(): string {
  idCounter += 1;
  // A short, monotonically increasing id. Random suffix avoids collisions if
  // two ids are minted within the same tick after a reload reseeds the counter.
  const rand = Math.floor(Math.random() * 36 ** 3)
    .toString(36)
    .padStart(3, '0');
  return `app-${idCounter.toString(36)}${rand}`;
}

// ---------- actions ----------

// Add a new application. New entries start on the wishlist with no applied date
// unless the draft supplies one.
export function addApplication(draft: ApplicationDraft): string {
  const id = makeId();
  const app: Application = {
    id,
    company: draft.company.trim() || 'Untitled company',
    role: draft.role.trim() || 'Untitled role',
    stage: 'wishlist',
    appliedDate: draft.appliedDate,
    nextActionDate: draft.nextActionDate,
    salary: draft.salary,
    notes: draft.notes,
  };
  commit({ ...state, applications: [app, ...state.applications] });
  return id;
}

// Patch the editable fields of an application, leaving stage and id untouched.
export function updateApplication(id: string, patch: Partial<ApplicationDraft>): void {
  const applications = state.applications.map((a) =>
    a.id === id
      ? {
          ...a,
          ...patch,
          company: patch.company !== undefined ? patch.company.trim() || a.company : a.company,
          role: patch.role !== undefined ? patch.role.trim() || a.role : a.role,
        }
      : a,
  );
  commit({ ...state, applications });
}

export function deleteApplication(id: string): void {
  commit({ ...state, applications: state.applications.filter((a) => a.id !== id) });
}

// Set an application's stage directly. Moving onto or past "applied" stamps an
// appliedDate from the current "today" if one is not already recorded, so the
// response-rate baseline stays honest.
export function setStage(id: string, stage: Stage): void {
  const appliedIndex = ADVANCE_PATH.indexOf('applied');
  const applications = state.applications.map((a) => {
    if (a.id !== id) return a;
    const targetIndex = (ADVANCE_PATH as readonly string[]).indexOf(stage);
    const reachedApplied = targetIndex >= appliedIndex && targetIndex !== -1;
    const appliedDate = reachedApplied && !a.appliedDate ? state.today : a.appliedDate;
    return { ...a, stage, appliedDate };
  });
  commit({ ...state, applications });
}

// Advance an application one step along the forward path, if it can.
export function advanceApplication(id: string): void {
  const app = state.applications.find((a) => a.id === id);
  if (!app) return;
  const next = nextStageOf(app.stage);
  if (next) setStage(id, next);
}

export function rejectApplication(id: string): void {
  setStage(id, 'rejected');
}

// Set the day a follow-up is due (or clear it with null).
export function setNextAction(id: string, day: string | null): void {
  updateApplication(id, { nextActionDate: day });
}

// Set the "today" the dashboard reckons against.
export function setToday(day: string): void {
  commit({ ...state, today: day });
}

// Wipe persisted state and restore the seed pipeline.
export function resetAll(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore storage errors
  }
  commit(seedState());
}

export { STAGE_LABEL };
