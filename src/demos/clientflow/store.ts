// Browser-side store for the rules engine. It keeps a working draft of rules
// plus a list of retained, immutable versions, all persisted to localStorage so
// the rule set survives a reload. Activating a version is atomic: it swaps a
// single active pointer, never edits a retained snapshot. A dry-run reads a
// retained version without touching what is live. Nothing here runs user rule
// content as code; it only stores and serves plain data for the interpreter.

import { validateRuleSet, type ValidationError } from './engine';
import type { Action, ConditionNode, Rule, Version } from './types';

const RULES_KEY = 'clientflow.rules.v1';
const VERSIONS_KEY = 'clientflow.versions.v1';
const ACTIVE_KEY = 'clientflow.active.v1';
const SEQ_KEY = 'clientflow.seq.v1';

export type State = {
  // The editable working set the builder mutates.
  draft: Rule[];
  // Retained, immutable snapshots. The active one is what evaluation uses.
  versions: Version[];
  activeId: number | null;
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
    // storage may be unavailable (private mode); the app still works in memory.
  }
}

// A small seed so the app shows something useful on first load.
function seedDraft(): Rule[] {
  return [
    {
      id: 'r1',
      name: 'High value review',
      enabled: true,
      when: {
        kind: 'group',
        op: 'AND',
        children: [
          { kind: 'cmp', field: 'amount', op: '>=', value: 500 },
          { kind: 'cmp', field: 'verified', op: '==', value: false },
        ],
      },
      then: { kind: 'flag', name: 'manual-review' },
    },
    {
      id: 'r2',
      name: 'Enterprise discount',
      enabled: true,
      when: { kind: 'cmp', field: 'tier', op: '==', value: 'enterprise' },
      then: { kind: 'set', key: 'discount', value: 0.15 },
    },
  ];
}

function loadState(): State {
  const versions = readJSON<Version[]>(VERSIONS_KEY, []);
  const storedActive = readJSON<number | null>(ACTIVE_KEY, null);
  const activeId =
    storedActive !== null && versions.some((v) => v.id === storedActive)
      ? storedActive
      : versions.length > 0
        ? versions[versions.length - 1].id
        : null;
  return {
    draft: readJSON<Rule[]>(RULES_KEY, seedDraft()),
    versions,
    activeId,
  };
}

// ---------- minimal external store ----------

let state: State = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
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

// ---------- ids ----------

function nextRuleId(): string {
  const seq = readJSON<number>(SEQ_KEY, 100) + 1;
  writeJSON(SEQ_KEY, seq);
  return `r${seq}`;
}

function nextVersionId(): number {
  const used = state.versions.map((v) => v.id);
  return (used.length ? Math.max(...used) : 0) + 1;
}

// ---------- draft actions ----------

export function addRule(name: string, when: ConditionNode, then: Action): Rule {
  const rule: Rule = { id: nextRuleId(), name, when, then, enabled: true };
  const draft = [...state.draft, rule];
  writeJSON(RULES_KEY, draft);
  set({ draft });
  return rule;
}

export function updateRule(id: string, patch: Partial<Omit<Rule, 'id'>>): void {
  const draft = state.draft.map((r) => (r.id === id ? { ...r, ...patch } : r));
  writeJSON(RULES_KEY, draft);
  set({ draft });
}

export function deleteRule(id: string): void {
  const draft = state.draft.filter((r) => r.id !== id);
  writeJSON(RULES_KEY, draft);
  set({ draft });
}

export function toggleRule(id: string): void {
  const draft = state.draft.map((r) =>
    r.id === id ? { ...r, enabled: !r.enabled } : r,
  );
  writeJSON(RULES_KEY, draft);
  set({ draft });
}

// ---------- versioning ----------

// Snapshot the current draft into a new retained version and activate it
// atomically. Validation runs first; an invalid draft is rejected and nothing
// is written, so the active pointer never lands on a broken set.
export type PublishResult =
  | { ok: true; version: Version }
  | { ok: false; errors: ValidationError[] };

export function publishDraft(note = ''): PublishResult {
  const errors = validateRuleSet(state.draft);
  if (errors.length > 0) return { ok: false, errors };
  const version: Version = {
    id: nextVersionId(),
    createdAt: Date.now(),
    // Deep clone so later draft edits cannot mutate the retained snapshot.
    rules: JSON.parse(JSON.stringify(state.draft)) as Rule[],
    note,
  };
  const versions = [...state.versions, version];
  writeJSON(VERSIONS_KEY, versions);
  writeJSON(ACTIVE_KEY, version.id);
  set({ versions, activeId: version.id });
  return { ok: true, version };
}

// Atomic activate: move the single active pointer to a retained version. Prior
// versions stay retained and retrievable.
export function activateVersion(id: number): void {
  if (!state.versions.some((v) => v.id === id)) return;
  writeJSON(ACTIVE_KEY, id);
  set({ activeId: id });
}

// Load a retained version's rules back into the draft for further editing.
export function loadVersionIntoDraft(id: number): void {
  const version = state.versions.find((v) => v.id === id);
  if (!version) return;
  const draft = JSON.parse(JSON.stringify(version.rules)) as Rule[];
  writeJSON(RULES_KEY, draft);
  set({ draft });
}

// ---------- derived ----------

export function activeVersion(s: State = state): Version | null {
  if (s.activeId === null) return null;
  return s.versions.find((v) => v.id === s.activeId) ?? null;
}

export function versionById(id: number, s: State = state): Version | null {
  return s.versions.find((v) => v.id === id) ?? null;
}

// ---------- reset ----------

export function resetAll(): void {
  try {
    localStorage.removeItem(RULES_KEY);
    localStorage.removeItem(VERSIONS_KEY);
    localStorage.removeItem(ACTIVE_KEY);
    localStorage.removeItem(SEQ_KEY);
  } catch {
    // ignore storage errors
  }
  state = { draft: seedDraft(), versions: [], activeId: null };
  emit();
}
