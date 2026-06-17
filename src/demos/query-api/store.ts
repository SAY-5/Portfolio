// Framework-agnostic store for the REST console. It holds the request the user
// is composing, the saved collection, and the request history, persisting the
// last two to localStorage. Sending a request flattens the draft into a
// MockRequest, dispatches it through the mock router, times the call, and
// records the exchange in history. Nothing here touches a real network.

import { ROUTES, resetData, route } from './mockapi';
import type {
  HistoryEntry,
  KeyValue,
  MockRequest,
  Method,
  RequestDraft,
  SavedRequest,
} from './types';

const COLLECTION_KEY = 'query-api.collection.v1';
const HISTORY_KEY = 'query-api.history.v1';
const HISTORY_LIMIT = 25;

export type State = {
  draft: RequestDraft;
  collection: SavedRequest[];
  history: HistoryEntry[];
  // The most recent exchange, surfaced by the response viewer. Null before the
  // first send.
  lastResponseId: string | null;
  // A body parse problem caught before dispatch, shown as a validation note.
  bodyError: string | null;
};

// ---------- id helper ----------

let idCounter = 0;
function uid(prefix: string): string {
  idCounter += 1;
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `${prefix}-${idCounter}-${rand}`;
}

function row(key = '', value = ''): KeyValue {
  return { id: uid('kv'), key, value, enabled: true };
}

function emptyDraft(): RequestDraft {
  return {
    method: 'GET',
    path: '/users',
    query: [row()],
    headers: [row('accept', 'application/json')],
    body: '',
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
    // Storage may be unavailable (private mode); the console still works in
    // memory for the session.
  }
}

function loadState(): State {
  return {
    draft: emptyDraft(),
    collection: readJSON<SavedRequest[]>(COLLECTION_KEY, []),
    history: readJSON<HistoryEntry[]>(HISTORY_KEY, []),
    lastResponseId: null,
    bodyError: null,
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

// ---------- draft editing ----------

export function setMethod(method: Method): void {
  set({ draft: { ...state.draft, method } });
}

export function setPath(path: string): void {
  set({ draft: { ...state.draft, path } });
}

export function setBody(body: string): void {
  set({ draft: { ...state.draft, body } });
}

function updateRows(
  field: 'query' | 'headers',
  fn: (rows: KeyValue[]) => KeyValue[],
): void {
  set({ draft: { ...state.draft, [field]: fn(state.draft[field]) } });
}

export function addRow(field: 'query' | 'headers'): void {
  updateRows(field, (rows) => [...rows, row()]);
}

export function removeRow(field: 'query' | 'headers', id: string): void {
  updateRows(field, (rows) => {
    const next = rows.filter((r) => r.id !== id);
    return next.length > 0 ? next : [row()];
  });
}

export function editRow(
  field: 'query' | 'headers',
  id: string,
  patch: Partial<Pick<KeyValue, 'key' | 'value' | 'enabled'>>,
): void {
  updateRows(field, (rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
}

export function loadDraft(request: RequestDraft): void {
  // Clone with fresh row ids so editing a loaded request does not mutate the
  // saved copy through shared references.
  set({
    bodyError: null,
    draft: {
      method: request.method,
      path: request.path,
      body: request.body,
      query: request.query.map((r) => ({ ...r, id: uid('kv') })),
      headers: request.headers.map((r) => ({ ...r, id: uid('kv') })),
    },
  });
}

export function loadExample(index: number): void {
  const r = ROUTES[index];
  if (!r) return;
  const body =
    r.method === 'POST'
      ? JSON.stringify({ name: 'New Person', email: 'new@example.com', role: 'member' }, null, 2)
      : '';
  set({
    bodyError: null,
    draft: {
      method: r.method,
      path: r.path,
      body,
      query: [row()],
      headers: [row('accept', 'application/json')],
    },
  });
}

// ---------- dispatch ----------

function flatten(rows: KeyValue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (!r.enabled) continue;
    const key = r.key.trim();
    if (key.length === 0) continue;
    out[key] = r.value;
  }
  return out;
}

// Build the MockRequest, dispatch through the router, time it, and record the
// exchange. `now` is the caller-supplied clock so the store stays free of
// render-time impurity concerns; the UI snapshots Date.now into state and the
// store reads performance.now for the duration itself.
export function send(now: number): void {
  const draft = state.draft;

  let body: unknown;
  if (draft.method === 'POST' && draft.body.trim().length > 0) {
    try {
      body = JSON.parse(draft.body);
    } catch {
      set({ bodyError: 'Request body is not valid JSON' });
      return;
    }
  }

  const req: MockRequest = {
    method: draft.method,
    path: draft.path.trim() || '/',
    query: flatten(draft.query),
    headers: flatten(draft.headers),
    body,
  };

  const start = performance.now();
  const response = route(req);
  const durationMs = Math.max(0, performance.now() - start);

  const entry: HistoryEntry = {
    id: uid('hist'),
    method: req.method,
    path: req.path,
    status: response.status,
    durationMs,
    at: now,
    request: {
      method: draft.method,
      path: draft.path,
      body: draft.body,
      query: draft.query.map((r) => ({ ...r })),
      headers: draft.headers.map((r) => ({ ...r })),
    },
    response,
  };

  const history = [entry, ...state.history].slice(0, HISTORY_LIMIT);
  writeJSON(HISTORY_KEY, history);
  set({ history, lastResponseId: entry.id, bodyError: null });
}

export function lastResponse(s: State = state): HistoryEntry | null {
  if (!s.lastResponseId) return null;
  return s.history.find((h) => h.id === s.lastResponseId) ?? null;
}

// ---------- collection ----------

export function saveToCollection(name: string): void {
  const trimmed = name.trim();
  if (trimmed.length === 0) return;
  const saved: SavedRequest = {
    id: uid('saved'),
    name: trimmed,
    request: {
      ...state.draft,
      query: state.draft.query.map((r) => ({ ...r })),
      headers: state.draft.headers.map((r) => ({ ...r })),
    },
  };
  const collection = [saved, ...state.collection];
  writeJSON(COLLECTION_KEY, collection);
  set({ collection });
}

export function removeSaved(id: string): void {
  const collection = state.collection.filter((s) => s.id !== id);
  writeJSON(COLLECTION_KEY, collection);
  set({ collection });
}

// ---------- reset ----------

// Clear persisted collection and history, restore the mock dataset, and reset
// the runtime model to a fresh draft.
export function resetAll(): void {
  try {
    localStorage.removeItem(COLLECTION_KEY);
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore storage errors
  }
  resetData();
  state = {
    draft: emptyDraft(),
    collection: [],
    history: [],
    lastResponseId: null,
    bodyError: null,
  };
  emit();
}
