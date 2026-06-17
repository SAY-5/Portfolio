// Browser-side store for SkillMatch. Roles and people live in localStorage so
// they survive a reload. A tiny external store exposes a consistent snapshot to
// React via useSyncExternalStore, mirroring the shopflow pattern. New ids come
// from a monotonic counter, so creation stays deterministic within a session
// without reaching for randomness.

import { clampLevel } from './engine';
import {
  type Person,
  type PersonSkill,
  type RequiredSkill,
  type Role,
} from './types';

const ROLES_KEY = 'skillmatch.roles.v1';
const PEOPLE_KEY = 'skillmatch.people.v1';

export type State = {
  roles: Role[];
  people: Person[];
};

// ---------- seed ----------

// Required skills share ids with the people below, so matches are meaningful
// out of the box. Weights are relative within a role.
function seedRoles(): Role[] {
  return [
    {
      id: 'role-backend',
      name: 'Backend Engineer',
      required: [
        { skillId: 'python', level: 4, weight: 3 },
        { skillId: 'sql', level: 4, weight: 2 },
        { skillId: 'api-design', level: 3, weight: 2 },
        { skillId: 'docker', level: 3, weight: 1 },
      ],
    },
    {
      id: 'role-ml',
      name: 'ML Engineer',
      required: [
        { skillId: 'python', level: 4, weight: 3 },
        { skillId: 'ml-modeling', level: 4, weight: 3 },
        { skillId: 'data-pipelines', level: 3, weight: 2 },
        { skillId: 'sql', level: 2, weight: 1 },
      ],
    },
    {
      id: 'role-frontend',
      name: 'Frontend Engineer',
      required: [
        { skillId: 'react', level: 4, weight: 3 },
        { skillId: 'typescript', level: 4, weight: 2 },
        { skillId: 'css', level: 3, weight: 2 },
        { skillId: 'api-design', level: 2, weight: 1 },
      ],
    },
  ];
}

function seedPeople(): Person[] {
  return [
    {
      id: 'person-ada',
      name: 'Ada',
      skills: [
        { skillId: 'python', level: 5 },
        { skillId: 'sql', level: 4 },
        { skillId: 'api-design', level: 4 },
        { skillId: 'docker', level: 2 },
      ],
    },
    {
      id: 'person-lin',
      name: 'Lin',
      skills: [
        { skillId: 'python', level: 4 },
        { skillId: 'ml-modeling', level: 3 },
        { skillId: 'data-pipelines', level: 4 },
        { skillId: 'sql', level: 3 },
      ],
    },
    {
      id: 'person-mateo',
      name: 'Mateo',
      skills: [
        { skillId: 'react', level: 5 },
        { skillId: 'typescript', level: 4 },
        { skillId: 'css', level: 4 },
        { skillId: 'api-design', level: 2 },
      ],
    },
    {
      id: 'person-noor',
      name: 'Noor',
      skills: [
        { skillId: 'python', level: 3 },
        { skillId: 'react', level: 3 },
        { skillId: 'typescript', level: 3 },
        { skillId: 'sql', level: 2 },
      ],
    },
  ];
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

function loadState(): State {
  return {
    roles: readJSON<Role[]>(ROLES_KEY, seedRoles()),
    people: readJSON<Person[]>(PEOPLE_KEY, seedPeople()),
  };
}

// ---------- minimal external store ----------

let state: State = loadState();
const listeners = new Set<() => void>();
let counter = 0;

function emit(): void {
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

// Monotonic id helper. Deterministic within a session: the suffix only ever
// increments, so no two created entities collide.
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter.toString(36)}`;
}

function persistRoles(roles: Role[]): void {
  writeJSON(ROLES_KEY, roles);
  state = { ...state, roles };
  emit();
}

function persistPeople(people: Person[]): void {
  writeJSON(PEOPLE_KEY, people);
  state = { ...state, people };
  emit();
}

// ---------- role actions ----------

export function addRole(name: string): string {
  const id = nextId('role');
  const trimmed = name.trim() || 'New role';
  persistRoles([...state.roles, { id, name: trimmed, required: [] }]);
  return id;
}

export function renameRole(id: string, name: string): void {
  persistRoles(
    state.roles.map((r) => (r.id === id ? { ...r, name } : r)),
  );
}

export function deleteRole(id: string): void {
  persistRoles(state.roles.filter((r) => r.id !== id));
}

export function addRoleSkill(roleId: string, req: RequiredSkill): void {
  const skillId = req.skillId.trim().toLowerCase();
  if (!skillId) return;
  persistRoles(
    state.roles.map((r) => {
      if (r.id !== roleId) return r;
      if (r.required.some((x) => x.skillId === skillId)) return r;
      return {
        ...r,
        required: [
          ...r.required,
          {
            skillId,
            level: clampLevel(req.level),
            weight: Math.max(1, Math.round(req.weight) || 1),
          },
        ],
      };
    }),
  );
}

export function updateRoleSkill(
  roleId: string,
  skillId: string,
  patch: Partial<Pick<RequiredSkill, 'level' | 'weight'>>,
): void {
  persistRoles(
    state.roles.map((r) => {
      if (r.id !== roleId) return r;
      return {
        ...r,
        required: r.required.map((x) =>
          x.skillId === skillId
            ? {
                ...x,
                level:
                  patch.level !== undefined ? clampLevel(patch.level) : x.level,
                weight:
                  patch.weight !== undefined
                    ? Math.max(1, Math.round(patch.weight) || 1)
                    : x.weight,
              }
            : x,
        ),
      };
    }),
  );
}

export function removeRoleSkill(roleId: string, skillId: string): void {
  persistRoles(
    state.roles.map((r) =>
      r.id === roleId
        ? { ...r, required: r.required.filter((x) => x.skillId !== skillId) }
        : r,
    ),
  );
}

// ---------- person actions ----------

export function addPerson(name: string): string {
  const id = nextId('person');
  const trimmed = name.trim() || 'New person';
  persistPeople([...state.people, { id, name: trimmed, skills: [] }]);
  return id;
}

export function renamePerson(id: string, name: string): void {
  persistPeople(
    state.people.map((p) => (p.id === id ? { ...p, name } : p)),
  );
}

export function deletePerson(id: string): void {
  persistPeople(state.people.filter((p) => p.id !== id));
}

export function addPersonSkill(personId: string, skill: PersonSkill): void {
  const skillId = skill.skillId.trim().toLowerCase();
  if (!skillId) return;
  persistPeople(
    state.people.map((p) => {
      if (p.id !== personId) return p;
      if (p.skills.some((x) => x.skillId === skillId)) return p;
      return {
        ...p,
        skills: [...p.skills, { skillId, level: clampLevel(skill.level) }],
      };
    }),
  );
}

export function updatePersonSkill(
  personId: string,
  skillId: string,
  level: number,
): void {
  persistPeople(
    state.people.map((p) =>
      p.id === personId
        ? {
            ...p,
            skills: p.skills.map((x) =>
              x.skillId === skillId ? { ...x, level: clampLevel(level) } : x,
            ),
          }
        : p,
    ),
  );
}

export function removePersonSkill(personId: string, skillId: string): void {
  persistPeople(
    state.people.map((p) =>
      p.id === personId
        ? { ...p, skills: p.skills.filter((x) => x.skillId !== skillId) }
        : p,
    ),
  );
}

// ---------- reset ----------

// Wipe persisted roles and people and restore the seed.
export function resetAll(): void {
  try {
    localStorage.removeItem(ROLES_KEY);
    localStorage.removeItem(PEOPLE_KEY);
  } catch {
    // ignore storage errors
  }
  counter = 0;
  state = { roles: seedRoles(), people: seedPeople() };
  emit();
}

// Every distinct skill id mentioned by any role or person, sorted for stable
// rendering. Used to offer existing competencies when editing.
export function allSkillIds(s: State = state): string[] {
  const set = new Set<string>();
  for (const r of s.roles) for (const x of r.required) set.add(x.skillId);
  for (const p of s.people) for (const x of p.skills) set.add(x.skillId);
  return [...set].sort();
}
