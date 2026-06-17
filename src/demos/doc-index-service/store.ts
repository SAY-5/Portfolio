// Framework-agnostic store for the search engine. It owns the corpus, the
// current query, and the search history, persists corpus and history to
// localStorage, and rebuilds the inverted index whenever the corpus changes.
// Nothing here talks to a server and there is no eval; the index is computed
// from the corpus by the pure engine.
import { corpus as seedCorpus } from './data';
import { buildIndex, indexStats } from './engine';
import type { Doc, InvertedIndex, IndexStats } from './types';

const CORPUS_KEY = 'docindex.corpus.v1';
const HISTORY_KEY = 'docindex.history.v1';
const HISTORY_LIMIT = 12;

export type State = {
  corpus: Doc[];
  index: InvertedIndex;
  stats: IndexStats;
  query: string;
  history: string[];
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
    // storage may be unavailable (private mode); the app still works in-memory.
  }
}

function loadCorpus(): Doc[] {
  const stored = readJSON<Doc[]>(CORPUS_KEY, seedCorpus);
  if (!Array.isArray(stored) || stored.length === 0) return seedCorpus;
  return stored;
}

function loadState(): State {
  const corpus = loadCorpus();
  const index = buildIndex(corpus);
  return {
    corpus,
    index,
    stats: indexStats(index),
    query: '',
    history: readJSON<string[]>(HISTORY_KEY, []),
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

// Rebuild the index and stats from the current corpus, persist, and publish.
function reindex(corpus: Doc[]): void {
  const index = buildIndex(corpus);
  writeJSON(CORPUS_KEY, corpus);
  set({ corpus, index, stats: indexStats(index) });
}

// ---------- actions ----------

export function setQuery(query: string): void {
  set({ query });
}

// Record a non-empty query at the head of the history, de-duplicated.
export function recordQuery(query: string): void {
  const q = query.trim();
  if (q.length === 0) return;
  const next = [q, ...state.history.filter((h) => h !== q)].slice(
    0,
    HISTORY_LIMIT,
  );
  writeJSON(HISTORY_KEY, next);
  set({ history: next });
}

let docSeq = 0;

// Add a document and re-index. Returns the new id so callers can reference it.
export function addDocument(title: string, body: string): string | null {
  const t = title.trim();
  const b = body.trim();
  if (t.length === 0 || b.length === 0) return null;
  docSeq += 1;
  const id = `u${String(docSeq).padStart(2, '0')}-${state.corpus.length + 1}`;
  const doc: Doc = { id, title: t, body: b };
  reindex([...state.corpus, doc]);
  return id;
}

export function removeDocument(id: string): void {
  const corpus = state.corpus.filter((d) => d.id !== id);
  if (corpus.length === state.corpus.length) return;
  reindex(corpus);
}

// Clear history and restore the seed corpus, wiping persisted state.
export function resetAll(): void {
  try {
    localStorage.removeItem(CORPUS_KEY);
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore unavailable storage
  }
  const index = buildIndex(seedCorpus);
  docSeq = 0;
  set({
    corpus: seedCorpus,
    index,
    stats: indexStats(index),
    query: '',
    history: [],
  });
}
