// Browser-side store for TalentAgent. Roles and candidates live in
// localStorage; everything else is derived on the fly by the engine. The store
// is framework agnostic: it exposes subscribe/getState plus a set of pure-ish
// action functions that mutate persisted state and notify subscribers. A React
// binding in state.ts wires it to useSyncExternalStore.

import {
  ADVANCE_PATH,
  type Candidate,
  type Criterion,
  type Persisted,
  type Role,
  type Stage,
} from './types';
import { canAdvance, canReject, nextStageOf, rubricValid } from './engine';

const KEY = 'talentagent.state.v1';

// ---------- seed ----------

// One fully defined role with a rubric that sums to 100, plus six candidates
// spread across the funnel with explicit per-criterion ratings. This gives a
// reviewer something to rank and advance immediately on first load.
function seed(): Persisted {
  const criteria: Criterion[] = [
    { id: 'cr-craft', label: 'Engineering craft', weight: 30 },
    { id: 'cr-systems', label: 'Systems design', weight: 25 },
    { id: 'cr-comm', label: 'Communication', weight: 20 },
    { id: 'cr-ownership', label: 'Ownership', weight: 15 },
    { id: 'cr-domain', label: 'Domain knowledge', weight: 10 },
  ];
  const role: Role = {
    id: 'role-be',
    title: 'Senior Backend Engineer',
    criteria,
    advanceThreshold: 60,
  };

  const c = (
    id: string,
    name: string,
    headline: string,
    stage: Stage,
    ratings: [number, number, number, number, number],
  ): Candidate => ({
    id,
    roleId: role.id,
    name,
    headline,
    stage,
    scores: {
      'cr-craft': ratings[0],
      'cr-systems': ratings[1],
      'cr-comm': ratings[2],
      'cr-ownership': ratings[3],
      'cr-domain': ratings[4],
    },
  });

  const candidates: Candidate[] = [
    c('ca-1', 'Amara Okafor', 'Payments platform, 8 yrs', 'interview', [5, 5, 4, 4, 4]),
    c('ca-2', 'Bjorn Vance', 'Distributed systems, 6 yrs', 'screen', [4, 5, 3, 4, 3]),
    c('ca-3', 'Carmen Diaz', 'API services, 5 yrs', 'offer', [5, 4, 5, 5, 4]),
    c('ca-4', 'Devin Park', 'Full-stack, 4 yrs', 'applied', [3, 2, 4, 3, 2]),
    c('ca-5', 'Elena Roth', 'Backend, 7 yrs', 'screen', [2, 2, 3, 2, 3]),
    c('ca-6', 'Faisal Noor', 'Infra, 3 yrs', 'applied', [3, 3, 2, 2, 2]),
  ];

  return { roles: [role], candidates };
}

// ---------- persistence ----------

function readState(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const s = seed();
      writeState(s);
      return s;
    }
    const parsed = JSON.parse(raw) as Persisted;
    if (!parsed.roles || !parsed.candidates) return seed();
    return parsed;
  } catch {
    return seed();
  }
}

function writeState(value: Persisted): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // storage may be unavailable (private mode); app keeps working in-memory.
  }
}

// ---------- external store ----------

let state: Persisted = readState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function commit(next: Persisted): void {
  state = next;
  writeState(state);
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): Persisted {
  return state;
}

// ---------- id helper ----------

let counter = 0;
function makeId(prefix: string): string {
  counter += 1;
  const rand = Math.floor(Math.random() * 1_000_000).toString(36);
  return `${prefix}-${rand}${counter}`;
}

// ---------- role actions ----------

export function addRole(title: string, criteria: Criterion[]): string | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  if (!rubricValid(criteria)) return null;
  const role: Role = {
    id: makeId('role'),
    title: trimmed,
    criteria,
    advanceThreshold: 60,
  };
  commit({ ...state, roles: [...state.roles, role] });
  return role.id;
}

// Replace a role's title, rubric, and threshold in one update. The rubric is
// validated; an invalid rubric is rejected so persisted roles always sum to 100.
export function updateRole(
  roleId: string,
  patch: { title?: string; criteria?: Criterion[]; advanceThreshold?: number },
): boolean {
  const role = state.roles.find((r) => r.id === roleId);
  if (!role) return false;
  const nextCriteria = patch.criteria ?? role.criteria;
  if (patch.criteria && !rubricValid(patch.criteria)) return false;
  const nextRole: Role = {
    ...role,
    title: patch.title?.trim() ? patch.title.trim() : role.title,
    criteria: nextCriteria,
    advanceThreshold:
      patch.advanceThreshold === undefined
        ? role.advanceThreshold
        : Math.max(0, Math.min(100, Math.round(patch.advanceThreshold))),
  };
  commit({
    ...state,
    roles: state.roles.map((r) => (r.id === roleId ? nextRole : r)),
  });
  return true;
}

export function setThreshold(roleId: string, value: number): boolean {
  return updateRole(roleId, { advanceThreshold: value });
}

// ---------- candidate actions ----------

export function addCandidate(
  roleId: string,
  name: string,
  headline: string,
): string | null {
  const role = state.roles.find((r) => r.id === roleId);
  if (!role) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const scores: Record<string, number> = {};
  for (const cr of role.criteria) scores[cr.id] = 0;
  const candidate: Candidate = {
    id: makeId('ca'),
    roleId,
    name: trimmed,
    headline: headline.trim(),
    stage: 'applied',
    scores,
  };
  commit({ ...state, candidates: [...state.candidates, candidate] });
  return candidate.id;
}

export function setScore(
  candidateId: string,
  criterionId: string,
  rating: number,
): void {
  const clamped = Math.max(0, Math.min(5, Math.round(rating)));
  const candidates = state.candidates.map((c) =>
    c.id === candidateId
      ? { ...c, scores: { ...c.scores, [criterionId]: clamped } }
      : c,
  );
  commit({ ...state, candidates });
}

// Advance a candidate one stage if the engine guard allows it. Returns the
// guard result so the UI can explain a refusal.
export function advanceCandidate(candidateId: string) {
  const candidate = state.candidates.find((c) => c.id === candidateId);
  if (!candidate) return { ok: false, reason: 'Unknown candidate.' };
  const role = state.roles.find((r) => r.id === candidate.roleId);
  if (!role) return { ok: false, reason: 'Unknown role.' };
  const guard = canAdvance(role, candidate);
  if (!guard.ok) return guard;
  const target = nextStageOf(candidate.stage);
  if (!target) return { ok: false, reason: 'No next stage.' };
  const candidates = state.candidates.map((c) =>
    c.id === candidateId ? { ...c, stage: target } : c,
  );
  commit({ ...state, candidates });
  return guard;
}

export function rejectCandidate(candidateId: string) {
  const candidate = state.candidates.find((c) => c.id === candidateId);
  if (!candidate) return { ok: false, reason: 'Unknown candidate.' };
  const guard = canReject(candidate);
  if (!guard.ok) return guard;
  const candidates = state.candidates.map((c) =>
    c.id === candidateId ? { ...c, stage: 'rejected' as Stage } : c,
  );
  commit({ ...state, candidates });
  return guard;
}

// ---------- reset ----------

// Clear persisted state and reseed, so the demo can be returned to a known
// starting point.
export function resetAll(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore storage errors
  }
  commit(seed());
}

export { ADVANCE_PATH };
