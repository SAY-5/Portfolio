// Browser-side state for the trace viewer. The seed traces are read-only sample
// data; what persists in localStorage is the user's selection and filter: which
// trace is open, which span is focused, the service filter, and whether the
// critical-path highlight is on. A tiny external store drives React through
// useSyncExternalStore so every component sees one consistent snapshot.

import { traces } from './data';
import type { Trace } from './types';

const SELECTION_KEY = 'tracesift.selection.v1';

export type Selection = {
  traceId: string;
  spanId: string | null;
  serviceFilter: string | null;
  highlightCritical: boolean;
};

export type State = Selection & {
  traces: Trace[];
};

function defaultSelection(): Selection {
  return {
    traceId: traces[0]?.id ?? '',
    spanId: null,
    serviceFilter: null,
    highlightCritical: false,
  };
}

// ---------- persistence ----------

function loadSelection(): Selection {
  const base = defaultSelection();
  try {
    const raw = localStorage.getItem(SELECTION_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Selection>;
    // Validate the persisted trace id against the current seed set; fall back if
    // the stored selection no longer matches the sample data.
    const traceId =
      typeof parsed.traceId === 'string' && traces.some((t) => t.id === parsed.traceId)
        ? parsed.traceId
        : base.traceId;
    const current = traces.find((t) => t.id === traceId);
    const spanId =
      typeof parsed.spanId === 'string' && current?.spans.some((s) => s.id === parsed.spanId)
        ? parsed.spanId
        : null;
    return {
      traceId,
      spanId,
      serviceFilter: typeof parsed.serviceFilter === 'string' ? parsed.serviceFilter : null,
      highlightCritical: parsed.highlightCritical === true,
    };
  } catch {
    return base;
  }
}

function saveSelection(s: State): void {
  try {
    const sel: Selection = {
      traceId: s.traceId,
      spanId: s.spanId,
      serviceFilter: s.serviceFilter,
      highlightCritical: s.highlightCritical,
    };
    localStorage.setItem(SELECTION_KEY, JSON.stringify(sel));
  } catch {
    // storage may be unavailable (private mode); the app still works in-memory.
  }
}

// ---------- minimal external store ----------

let state: State = { traces, ...loadSelection() };
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  saveSelection(state);
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

// ---------- actions ----------

export function selectTrace(traceId: string): void {
  if (!state.traces.some((t) => t.id === traceId)) return;
  // Changing trace clears the span focus and service filter, which are scoped to
  // a single trace.
  set({ traceId, spanId: null, serviceFilter: null });
}

export function selectSpan(spanId: string | null): void {
  set({ spanId });
}

export function setServiceFilter(service: string | null): void {
  set({ serviceFilter: service });
}

export function toggleCritical(): void {
  set({ highlightCritical: !state.highlightCritical });
}

export function setHighlightCritical(on: boolean): void {
  set({ highlightCritical: on });
}

// Clear the focused span and service filter without changing the open trace.
export function resetSelection(): void {
  set({ spanId: null, serviceFilter: null, highlightCritical: false });
}

export function currentTrace(s: State = state): Trace | undefined {
  return s.traces.find((t) => t.id === s.traceId);
}
