// Browser-side document store for the whiteboard. It holds the live document
// (shapes plus selection) and an undo/redo history, persists the document to
// localStorage on every change, and exposes a framework-agnostic subscribe /
// getSnapshot pair that the React binding feeds to useSyncExternalStore. All
// shape math is delegated to the pure engine; this module only owns mutation,
// persistence, and notification.

import {
  bringForward,
  bringToFront,
  canRedo,
  canUndo,
  initHistory,
  nextZ,
  pushHistory,
  redo,
  sendBackward,
  sendToBack,
  undo,
  type History,
} from './engine';
import type { CanvasDoc, Shape, ShapeKind } from './types';

const DOC_KEY = 'canvaslive.doc.v1';

// ---------- persistence ----------

function readDoc(): CanvasDoc {
  const empty: CanvasDoc = { shapes: [], selectedId: null };
  try {
    const raw = localStorage.getItem(DOC_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<CanvasDoc>;
    if (!parsed || !Array.isArray(parsed.shapes)) return empty;
    return {
      shapes: parsed.shapes as Shape[],
      selectedId: typeof parsed.selectedId === 'string' ? parsed.selectedId : null,
    };
  } catch {
    return empty;
  }
}

function writeDoc(doc: CanvasDoc): void {
  try {
    localStorage.setItem(DOC_KEY, JSON.stringify(doc));
  } catch {
    // storage may be unavailable (private mode); the editor still works in-memory.
  }
}

// ---------- store state ----------

type StoreState = {
  doc: CanvasDoc;
  history: History<Shape[]>;
};

let state: StoreState = {
  doc: readDoc(),
  history: initHistory(readDoc().shapes),
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getSnapshot(): StoreState {
  return state;
}

// Apply a new document and persist it. When commit is true the prior shapes are
// pushed onto the undo history; transient updates (mid-drag) pass commit false
// so a single gesture becomes one undo step on release.
function apply(doc: CanvasDoc, commit: boolean): void {
  const history = commit
    ? pushHistory(state.history, doc.shapes)
    : { ...state.history, present: doc.shapes };
  state = { doc, history };
  writeDoc(doc);
  emit();
}

// ---------- id generation ----------

let idCounter = 0;

// Stable-enough unique id without reading the clock inline in render. The store
// runs entirely from event handlers, so a monotonic counter plus a random
// suffix avoids collisions across reloads when combined with the suffix.
function makeId(): string {
  idCounter += 1;
  const suffix = Math.random().toString(36).slice(2, 8);
  return `s${idCounter}-${suffix}`;
}

// ---------- shape factory ----------

const DEFAULT_FILL = 'rgba(61, 240, 255, 0.18)';
const DEFAULT_STROKE = '#3df0ff';

function defaultGeometry(kind: ShapeKind): Pick<Shape, 'w' | 'h' | 'text'> {
  switch (kind) {
    case 'line':
      return { w: 140, h: 0, text: '' };
    case 'text':
      return { w: 160, h: 40, text: 'Text' };
    default:
      return { w: 120, h: 90, text: '' };
  }
}

// ---------- actions ----------

// Add a shape of the given kind near the canvas center and select it.
export function addShape(kind: ShapeKind, x = 220, y = 160): string {
  const geo = defaultGeometry(kind);
  const shape: Shape = {
    id: makeId(),
    kind,
    x,
    y,
    w: geo.w,
    h: geo.h,
    fill: kind === 'line' || kind === 'text' ? 'transparent' : DEFAULT_FILL,
    stroke: DEFAULT_STROKE,
    text: geo.text,
    z: nextZ(state.doc.shapes),
  };
  apply(
    { shapes: [...state.doc.shapes, shape], selectedId: shape.id },
    true,
  );
  return shape.id;
}

// Patch fields of one shape. commit controls whether this becomes an undo step.
export function updateShape(
  id: string,
  patch: Partial<Shape>,
  commit = true,
): void {
  const shapes = state.doc.shapes.map((s) =>
    s.id === id ? { ...s, ...patch, id: s.id } : s,
  );
  apply({ ...state.doc, shapes }, commit);
}

// Replace the entire shapes array (used by drag/resize/reorder helpers).
export function setShapes(shapes: Shape[], commit = true): void {
  apply({ ...state.doc, shapes }, commit);
}

export function deleteShape(id: string): void {
  const shapes = state.doc.shapes.filter((s) => s.id !== id);
  const selectedId = state.doc.selectedId === id ? null : state.doc.selectedId;
  apply({ shapes, selectedId }, true);
}

// Selection is presentation state, not an undoable edit, so it never commits.
export function select(id: string | null): void {
  apply({ ...state.doc, selectedId: id }, false);
}

// ---------- z-order actions ----------

export function reorderForward(id: string): void {
  apply({ ...state.doc, shapes: bringForward(state.doc.shapes, id) }, true);
}

export function reorderBackward(id: string): void {
  apply({ ...state.doc, shapes: sendBackward(state.doc.shapes, id) }, true);
}

export function reorderToFront(id: string): void {
  apply({ ...state.doc, shapes: bringToFront(state.doc.shapes, id) }, true);
}

export function reorderToBack(id: string): void {
  apply({ ...state.doc, shapes: sendToBack(state.doc.shapes, id) }, true);
}

// ---------- history actions ----------

export function undoAction(): void {
  if (!canUndo(state.history)) return;
  const history = undo(state.history);
  const present = history.present;
  const selectedId = present.some((s) => s.id === state.doc.selectedId)
    ? state.doc.selectedId
    : null;
  const doc: CanvasDoc = { shapes: present, selectedId };
  state = { doc, history };
  writeDoc(doc);
  emit();
}

export function redoAction(): void {
  if (!canRedo(state.history)) return;
  const history = redo(state.history);
  const present = history.present;
  const selectedId = present.some((s) => s.id === state.doc.selectedId)
    ? state.doc.selectedId
    : null;
  const doc: CanvasDoc = { shapes: present, selectedId };
  state = { doc, history };
  writeDoc(doc);
  emit();
}

export function canUndoNow(): boolean {
  return canUndo(state.history);
}

export function canRedoNow(): boolean {
  return canRedo(state.history);
}

// Clear all shapes as a single undoable step.
export function clearAll(): void {
  apply({ shapes: [], selectedId: null }, true);
}

// Wipe persisted document and reset the runtime model and history.
export function resetAll(): void {
  try {
    localStorage.removeItem(DOC_KEY);
  } catch {
    // ignore storage errors
  }
  const doc: CanvasDoc = { shapes: [], selectedId: null };
  state = { doc, history: initHistory([]) };
  emit();
}
