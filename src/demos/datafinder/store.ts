// Framework-agnostic store for the DataFinder explorer. It owns the live query
// (text, facets, range, rating, sort, page), the set of saved views, and the
// id of the record open in the detail panel. The live query and saved views
// persist to localStorage so a reload restores the workspace; nothing here
// talks to a server. The engine stays pure, so this layer is just state plus
// thin actions, and the React binding in state.ts subscribes to it.

import { priceBounds, runQuery } from './engine';
import type { Query, Result, SavedView, SortMode } from './types';

const QUERY_KEY = 'datafinder.query.v1';
const VIEWS_KEY = 'datafinder.views.v1';

export type State = {
  query: Query;
  views: SavedView[];
  // id of the record open in the detail panel, or null when none is open.
  openId: string | null;
};

// ---------- defaults ----------

// The empty query: no text, no facets, the full price band, no rating floor,
// relevance sort, first page. Bounds come from the catalog so nothing is
// hard-coded.
export function defaultQuery(): Query {
  const { min, max } = priceBounds();
  return {
    text: '',
    categories: [],
    tags: [],
    minPrice: min,
    maxPrice: max,
    minRating: 0,
    sort: 'relevance',
    page: 0,
  };
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

// Merge a persisted query over the defaults so a stored shape from an older
// build can never leave a field undefined.
function loadQuery(): Query {
  const base = defaultQuery();
  const stored = readJSON<Partial<Query> | null>(QUERY_KEY, null);
  if (!stored) return base;
  return {
    text: typeof stored.text === 'string' ? stored.text : base.text,
    categories: Array.isArray(stored.categories) ? stored.categories : base.categories,
    tags: Array.isArray(stored.tags) ? stored.tags : base.tags,
    minPrice: typeof stored.minPrice === 'number' ? stored.minPrice : base.minPrice,
    maxPrice: typeof stored.maxPrice === 'number' ? stored.maxPrice : base.maxPrice,
    minRating: typeof stored.minRating === 'number' ? stored.minRating : base.minRating,
    sort: (stored.sort as SortMode) ?? base.sort,
    page: typeof stored.page === 'number' ? stored.page : base.page,
  };
}

function loadViews(): SavedView[] {
  const stored = readJSON<SavedView[]>(VIEWS_KEY, []);
  return Array.isArray(stored) ? stored : [];
}

function loadState(): State {
  return {
    query: loadQuery(),
    views: loadViews(),
    openId: null,
  };
}

// ---------- minimal external store ----------

let state: State = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function setState(next: Partial<State>): void {
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

// Persist and replace the query in one move, resetting to the first page on any
// change that narrows the result set so the user never lands on an empty page.
function setQuery(next: Query, resetPage = true): void {
  const query = resetPage ? { ...next, page: 0 } : next;
  writeJSON(QUERY_KEY, query);
  setState({ query });
}

// ---------- query actions ----------

export function setText(text: string): void {
  setQuery({ ...state.query, text });
}

export function toggleCategory(category: string): void {
  const has = state.query.categories.includes(category);
  const categories = has
    ? state.query.categories.filter((c) => c !== category)
    : [...state.query.categories, category];
  setQuery({ ...state.query, categories });
}

export function toggleTag(tag: string): void {
  const has = state.query.tags.includes(tag);
  const tags = has
    ? state.query.tags.filter((t) => t !== tag)
    : [...state.query.tags, tag];
  setQuery({ ...state.query, tags });
}

export function setMinPrice(value: number): void {
  const minPrice = Math.min(value, state.query.maxPrice);
  setQuery({ ...state.query, minPrice });
}

export function setMaxPrice(value: number): void {
  const maxPrice = Math.max(value, state.query.minPrice);
  setQuery({ ...state.query, maxPrice });
}

export function setMinRating(value: number): void {
  setQuery({ ...state.query, minRating: value });
}

export function setSort(sort: SortMode): void {
  setQuery({ ...state.query, sort });
}

// Paging does not reset the page, it sets it; the engine clamps out-of-range
// pages so a stale page can never break the view.
export function setPage(page: number): void {
  setQuery({ ...state.query, page }, false);
}

export function clearFilters(): void {
  setQuery(defaultQuery());
}

// ---------- detail panel ----------

export function openRecord(id: string): void {
  setState({ openId: id });
}

export function closeRecord(): void {
  setState({ openId: null });
}

// ---------- saved views ----------

function makeViewId(): string {
  const n = Math.floor(Math.random() * 1_000_000)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0');
  return `view-${n}`;
}

// Save the current query under a name. The clock is read once here, at the
// action, so render never reads it and stays pure. A blank name is ignored.
export function saveView(name: string, now: number): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const view: SavedView = {
    id: makeViewId(),
    name: trimmed,
    query: { ...state.query },
    savedAt: now,
  };
  const views = [view, ...state.views];
  writeJSON(VIEWS_KEY, views);
  setState({ views });
}

export function loadView(id: string): void {
  const view = state.views.find((v) => v.id === id);
  if (!view) return;
  setQuery({ ...view.query }, false);
}

export function deleteView(id: string): void {
  const views = state.views.filter((v) => v.id !== id);
  writeJSON(VIEWS_KEY, views);
  setState({ views });
}

// Clear the live query and every saved view, wiping both localStorage keys.
// Used by the reset control so the user can return to a clean slate.
export function resetAll(): void {
  try {
    localStorage.removeItem(QUERY_KEY);
    localStorage.removeItem(VIEWS_KEY);
  } catch {
    // ignore storage errors; in-memory reset still happens below.
  }
  state = { query: defaultQuery(), views: [], openId: null };
  emit();
}

// ---------- derived ----------

// The current result, recomputed from the live query. Kept as a function rather
// than stored so it can never drift from the query it describes.
export function currentResult(): Result {
  return runQuery(state.query);
}
