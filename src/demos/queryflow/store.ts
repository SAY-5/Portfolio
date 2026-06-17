// Framework-agnostic store for the QueryFlow builder. It holds the query the
// user is editing plus the list of named queries saved to localStorage. The
// store exposes a subscribe/getSnapshot pair so a React binding can drive
// re-renders through useSyncExternalStore. No server, no network: everything
// lives in the browser tab and (for saved queries) localStorage.

import type {
  AggregateSpec,
  Combine,
  Condition,
  OrderBy,
  Query,
  SavedQuery,
} from './types';
import { ordersTable } from './data';

const SAVED_KEY = 'queryflow.saved.v1';

// The starting query: a couple of columns, no filters. Editing always replaces
// the whole query object so snapshots stay immutable for useSyncExternalStore.
export function defaultQuery(): Query {
  return {
    table: ordersTable.name,
    columns: ['id', 'customer', 'region', 'total', 'status'],
    combine: 'AND',
    conditions: [],
    groupBy: [],
    aggregates: [],
    orderBy: null,
    limit: 50,
  };
}

export type State = {
  query: Query;
  saved: SavedQuery[];
};

// ---------- persistence ----------

function readSaved(): SavedQuery[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedQuery[]) : [];
  } catch {
    return [];
  }
}

function writeSaved(saved: SavedQuery[]): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  } catch {
    // storage may be unavailable (private mode); saving is best-effort.
  }
}

// ---------- store core ----------

let state: State = {
  query: defaultQuery(),
  saved: readSaved(),
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  emit();
}

function patchQuery(patch: Partial<Query>): void {
  set({ query: { ...state.query, ...patch } });
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

// ---------- id helper (no clock; a monotonic counter) ----------

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq.toString(36)}`;
}

// ---------- query editing actions ----------

export function setColumns(columns: string[]): void {
  patchQuery({ columns });
}

export function toggleColumn(name: string): void {
  const has = state.query.columns.includes(name);
  const columns = has
    ? state.query.columns.filter((c) => c !== name)
    : [...state.query.columns, name];
  patchQuery({ columns });
}

export function setCombine(combine: Combine): void {
  patchQuery({ combine });
}

export function addCondition(field: string, op: Condition['op'], value = ''): void {
  const condition: Condition = { id: nextId('c'), field, op, value };
  patchQuery({ conditions: [...state.query.conditions, condition] });
}

export function updateCondition(id: string, patch: Partial<Condition>): void {
  patchQuery({
    conditions: state.query.conditions.map((c) =>
      c.id === id ? { ...c, ...patch } : c,
    ),
  });
}

export function removeCondition(id: string): void {
  patchQuery({ conditions: state.query.conditions.filter((c) => c.id !== id) });
}

export function toggleGroupBy(field: string): void {
  const has = state.query.groupBy.includes(field);
  const groupBy = has
    ? state.query.groupBy.filter((g) => g !== field)
    : [...state.query.groupBy, field];
  patchQuery({ groupBy });
}

export function addAggregate(fn: AggregateSpec['fn'], field: string): void {
  const agg: AggregateSpec = { id: nextId('a'), fn, field };
  patchQuery({ aggregates: [...state.query.aggregates, agg] });
}

export function removeAggregate(id: string): void {
  patchQuery({ aggregates: state.query.aggregates.filter((a) => a.id !== id) });
}

export function setOrderBy(orderBy: OrderBy | null): void {
  patchQuery({ orderBy });
}

export function setLimit(limit: number | null): void {
  patchQuery({ limit });
}

export function resetQuery(): void {
  set({ query: defaultQuery() });
}

// ---------- saved queries ----------

export function saveQuery(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  // Replace a same-named entry so re-saving updates in place.
  const without = state.saved.filter((s) => s.name !== trimmed);
  const entry: SavedQuery = {
    id: nextId('q'),
    name: trimmed,
    query: structuredClone(state.query),
    savedAt: 0,
  };
  const saved = [entry, ...without];
  writeSaved(saved);
  set({ saved });
}

export function stampSavedAt(id: string, savedAt: number): void {
  const saved = state.saved.map((s) => (s.id === id ? { ...s, savedAt } : s));
  writeSaved(saved);
  set({ saved });
}

export function loadSaved(id: string): void {
  const entry = state.saved.find((s) => s.id === id);
  if (!entry) return;
  set({ query: structuredClone(entry.query) });
}

export function deleteSaved(id: string): void {
  const saved = state.saved.filter((s) => s.id !== id);
  writeSaved(saved);
  set({ saved });
}

// Clear all persisted saved queries and reset the editor.
export function clearSaved(): void {
  try {
    localStorage.removeItem(SAVED_KEY);
  } catch {
    // ignore storage errors
  }
  set({ saved: [], query: defaultQuery() });
}
