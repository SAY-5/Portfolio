// Browser-side store for PromptForge. Templates and their saved versions live
// in localStorage, so authored work survives a reload. Nothing here talks to a
// network: create, edit, save a version, activate a version, and reset all run
// entirely on the local snapshot. A tiny external store backs useSyncExternalStore.

import type { Template, VarDef, Version } from './types';
import { detectVars, emptyVar } from './engine';

const STORE_KEY = 'promptforge.templates.v1';

export type State = {
  templates: Template[];
  selectedId: string | null;
};

// ---------- ids ----------

function makeId(prefix: string): string {
  const n = Math.floor(Math.random() * 1_000_000)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0');
  return `${prefix}-${n}`;
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

// ---------- seed ----------

// A neutral starter template so a first-time visitor lands on something real to
// edit, preview, and version. Plain copy with two declared variables.
function seedTemplates(): Template[] {
  const now = Date.now();
  const body =
    'Hello {{name}},\n\nYour order {{order_id}} is ready for {{action}}.\n\nThank you.';
  const vars: VarDef[] = [
    { name: 'name', type: 'text', default: 'Customer', options: [] },
    { name: 'order_id', type: 'text', default: '', options: [] },
    {
      name: 'action',
      type: 'enum',
      default: 'pickup',
      options: ['pickup', 'delivery', 'review'],
    },
  ];
  const version: Version = {
    id: makeId('v'),
    label: 'v1',
    body,
    vars,
    savedAt: now,
  };
  return [
    {
      id: makeId('tpl'),
      name: 'Order notice',
      body,
      vars,
      versions: [version],
      activeVersionId: version.id,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function loadState(): State {
  const templates = readJSON<Template[] | null>(STORE_KEY, null);
  if (templates && templates.length > 0) {
    return { templates, selectedId: templates[0].id };
  }
  const seeded = seedTemplates();
  writeJSON(STORE_KEY, seeded);
  return { templates: seeded, selectedId: seeded[0].id };
}

// ---------- minimal external store ----------

let state: State = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function persist(templates: Template[]): void {
  writeJSON(STORE_KEY, templates);
}

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

// ---------- derived ----------

export function selectedTemplate(s: State = state): Template | null {
  if (!s.selectedId) return null;
  return s.templates.find((t) => t.id === s.selectedId) ?? null;
}

// ---------- selection ----------

export function selectTemplate(id: string): void {
  if (!state.templates.some((t) => t.id === id)) return;
  set({ selectedId: id });
}

// ---------- template CRUD ----------

export function createTemplate(name: string): string {
  const trimmed = name.trim() || 'Untitled template';
  const now = Date.now();
  const tpl: Template = {
    id: makeId('tpl'),
    name: trimmed,
    body: '',
    vars: [],
    versions: [],
    activeVersionId: null,
    createdAt: now,
    updatedAt: now,
  };
  const templates = [...state.templates, tpl];
  persist(templates);
  set({ templates, selectedId: tpl.id });
  return tpl.id;
}

export function renameTemplate(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const templates = state.templates.map((t) =>
    t.id === id ? { ...t, name: trimmed, updatedAt: Date.now() } : t,
  );
  persist(templates);
  set({ templates });
}

export function deleteTemplate(id: string): void {
  const templates = state.templates.filter((t) => t.id !== id);
  persist(templates);
  const selectedId =
    state.selectedId === id ? (templates[0]?.id ?? null) : state.selectedId;
  set({ templates, selectedId });
}

// ---------- draft edits ----------

// Update the working body. Newly detected placeholders gain an empty variable
// definition; declared variables no longer referenced are kept, so a user can
// remove a placeholder without losing its configuration by accident.
export function setBody(id: string, body: string): void {
  const templates = state.templates.map((t) => {
    if (t.id !== id) return t;
    const referenced = detectVars(body);
    const existing = new Map(t.vars.map((v) => [v.name, v]));
    const vars: VarDef[] = [...t.vars];
    for (const name of referenced) {
      if (!existing.has(name)) vars.push(emptyVar(name));
    }
    return { ...t, body, vars, updatedAt: Date.now() };
  });
  persist(templates);
  set({ templates });
}

export function updateVar(
  id: string,
  name: string,
  patch: Partial<VarDef>,
): void {
  const templates = state.templates.map((t) => {
    if (t.id !== id) return t;
    const vars = t.vars.map((v) => (v.name === name ? { ...v, ...patch } : v));
    return { ...t, vars, updatedAt: Date.now() };
  });
  persist(templates);
  set({ templates });
}

export function removeVar(id: string, name: string): void {
  const templates = state.templates.map((t) => {
    if (t.id !== id) return t;
    return { ...t, vars: t.vars.filter((v) => v.name !== name), updatedAt: Date.now() };
  });
  persist(templates);
  set({ templates });
}

// ---------- versions ----------

// Snapshot the current draft as an immutable version and mark it active. The
// label auto-increments (v1, v2, ...) over the count of existing versions.
export function saveVersion(id: string): void {
  const templates = state.templates.map((t) => {
    if (t.id !== id) return t;
    const version: Version = {
      id: makeId('v'),
      label: `v${t.versions.length + 1}`,
      body: t.body,
      vars: t.vars.map((v) => ({ ...v, options: [...v.options] })),
      savedAt: Date.now(),
    };
    return {
      ...t,
      versions: [...t.versions, version],
      activeVersionId: version.id,
      updatedAt: Date.now(),
    };
  });
  persist(templates);
  set({ templates });
}

// Load a saved version's body and variables back into the working draft and
// mark it active. Prior versions are left intact.
export function activateVersion(id: string, versionId: string): void {
  const templates = state.templates.map((t) => {
    if (t.id !== id) return t;
    const version = t.versions.find((v) => v.id === versionId);
    if (!version) return t;
    return {
      ...t,
      body: version.body,
      vars: version.vars.map((v) => ({ ...v, options: [...v.options] })),
      activeVersionId: version.id,
      updatedAt: Date.now(),
    };
  });
  persist(templates);
  set({ templates });
}

// ---------- reset ----------

// Wipe persisted templates and reload the seed, returning the app to a known
// first-run state.
export function resetAll(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // ignore storage errors
  }
  const seeded = seedTemplates();
  writeJSON(STORE_KEY, seeded);
  state = { templates: seeded, selectedId: seeded[0].id };
  emit();
}
