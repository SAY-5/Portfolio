// Pure geometry and history helpers for the whiteboard. Nothing here touches
// React, the DOM, the clock, or storage: every function takes its inputs and
// returns new values, so the same call always yields the same result. This is
// what the store binds to and what unit tests exercise directly.

import type { Box, HandleId, Point, Shape } from './types';

// ---------- hit-testing ----------

// A line shape is hit-tested as a thin band around the segment from its top-left
// to bottom-right corner; the others use their bounding box. This tolerance is
// the half-width of that band in canvas units.
const LINE_HIT_TOLERANCE = 8;

function pointInBox(p: Point, b: Box): boolean {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

// Distance from point p to the segment a->b, used for line hit-testing.
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const px = p.x - a.x;
    const py = p.y - a.y;
    return Math.sqrt(px * px + py * py);
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  const ex = p.x - cx;
  const ey = p.y - cy;
  return Math.sqrt(ex * ex + ey * ey);
}

function hitsShape(p: Point, s: Shape): boolean {
  if (s.kind === 'line') {
    const a = { x: s.x, y: s.y };
    const b = { x: s.x + s.w, y: s.y + s.h };
    return distanceToSegment(p, a, b) <= LINE_HIT_TOLERANCE;
  }
  return pointInBox(p, { x: s.x, y: s.y, w: s.w, h: s.h });
}

// Return the topmost shape under the point, scanning highest z first so the
// visually frontmost shape wins. Returns null when the point hits nothing.
export function hitTest(shapes: Shape[], p: Point): Shape | null {
  const ordered = [...shapes].sort((a, b) => b.z - a.z);
  for (const s of ordered) {
    if (hitsShape(p, s)) return s;
  }
  return null;
}

// ---------- bounding box ----------

// Axis-aligned box that tightly contains every given shape. Returns null for an
// empty list. Lines may extend up or left of their origin, so this normalizes
// negative width and height into real min/max extents.
export function boundingBox(shapes: Shape[]): Box | null {
  if (shapes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    const x1 = Math.min(s.x, s.x + s.w);
    const y1 = Math.min(s.y, s.y + s.h);
    const x2 = Math.max(s.x, s.x + s.w);
    const y2 = Math.max(s.y, s.y + s.h);
    minX = Math.min(minX, x1);
    minY = Math.min(minY, y1);
    maxX = Math.max(maxX, x2);
    maxY = Math.max(maxY, y2);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ---------- transforms ----------

// Move a shape by a delta, returning a new shape. Lines move both endpoints
// because their geometry is encoded as origin plus w/h offset.
export function moveShape(s: Shape, dx: number, dy: number): Shape {
  return { ...s, x: s.x + dx, y: s.y + dy };
}

// Minimum width and height a non-line shape may be resized to, so a shape never
// collapses to an unselectable sliver.
const MIN_SIZE = 8;

// Resize a shape by dragging one of its eight handles by (dx, dy). The opposite
// edge stays anchored. Lines are resized by moving the dragged endpoint only.
export function resizeShape(
  s: Shape,
  handle: HandleId,
  dx: number,
  dy: number,
): Shape {
  if (s.kind === 'line') {
    // For a line, nw/n/w/sw drag the start point, the rest drag the end point.
    const dragStart = handle === 'nw' || handle === 'n' || handle === 'w' || handle === 'sw';
    if (dragStart) {
      return { ...s, x: s.x + dx, y: s.y + dy, w: s.w - dx, h: s.h - dy };
    }
    return { ...s, w: s.w + dx, h: s.h + dy };
  }

  let { x, y, w, h } = s;
  if (handle.includes('e')) w += dx;
  if (handle.includes('s')) h += dy;
  if (handle.includes('w')) {
    x += dx;
    w -= dx;
  }
  if (handle.includes('n')) {
    y += dy;
    h -= dy;
  }

  // Clamp to a minimum size while keeping the anchored edge fixed.
  if (w < MIN_SIZE) {
    if (handle.includes('w')) x -= MIN_SIZE - w;
    w = MIN_SIZE;
  }
  if (h < MIN_SIZE) {
    if (handle.includes('n')) y -= MIN_SIZE - h;
    h = MIN_SIZE;
  }
  return { ...s, x, y, w, h };
}

// ---------- z-order ----------

// Normalize z values to a dense 0..n-1 sequence in paint order, so repeated
// reorders never drift apart. Returns shapes in the same array order, with z
// reassigned by ascending current z (stable on ties by array index).
export function normalizeZ(shapes: Shape[]): Shape[] {
  const order = shapes
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.z - b.s.z) || (a.i - b.i));
  const rank = new Map<string, number>();
  order.forEach((entry, idx) => rank.set(entry.s.id, idx));
  return shapes.map((s) => ({ ...s, z: rank.get(s.id) ?? s.z }));
}

// Raise one shape one step up the stack by swapping z with the shape directly
// above it. A no-op when the shape is already frontmost or not found.
export function bringForward(shapes: Shape[], id: string): Shape[] {
  const norm = normalizeZ(shapes);
  const target = norm.find((s) => s.id === id);
  if (!target) return shapes;
  const above = norm
    .filter((s) => s.z > target.z)
    .sort((a, b) => a.z - b.z)[0];
  if (!above) return norm;
  return norm.map((s) => {
    if (s.id === target.id) return { ...s, z: above.z };
    if (s.id === above.id) return { ...s, z: target.z };
    return s;
  });
}

// Lower one shape one step down the stack by swapping z with the shape directly
// below it. A no-op when the shape is already backmost or not found.
export function sendBackward(shapes: Shape[], id: string): Shape[] {
  const norm = normalizeZ(shapes);
  const target = norm.find((s) => s.id === id);
  if (!target) return shapes;
  const below = norm
    .filter((s) => s.z < target.z)
    .sort((a, b) => b.z - a.z)[0];
  if (!below) return norm;
  return norm.map((s) => {
    if (s.id === target.id) return { ...s, z: below.z };
    if (s.id === below.id) return { ...s, z: target.z };
    return s;
  });
}

// Move a shape above every other shape.
export function bringToFront(shapes: Shape[], id: string): Shape[] {
  const norm = normalizeZ(shapes);
  const maxZ = norm.reduce((m, s) => Math.max(m, s.z), -1);
  return norm.map((s) => (s.id === id ? { ...s, z: maxZ + 1 } : s));
}

// Move a shape below every other shape.
export function sendToBack(shapes: Shape[], id: string): Shape[] {
  const norm = normalizeZ(shapes);
  const minZ = norm.reduce((m, s) => Math.min(m, s.z), norm.length);
  return norm.map((s) => (s.id === id ? { ...s, z: minZ - 1 } : s));
}

// The next z to assign to a freshly added shape so it lands on top.
export function nextZ(shapes: Shape[]): number {
  if (shapes.length === 0) return 0;
  return shapes.reduce((m, s) => Math.max(m, s.z), -1) + 1;
}

// ---------- undo/redo history ----------

// An immutable snapshot stack. Each entry is a deep-frozen copy of the shapes
// array taken at a commit point. past holds states before the present, future
// holds states undone but not yet discarded by a new edit.
export type History<T> = {
  past: T[];
  present: T;
  future: T[];
};

// Cap on retained undo steps so an editing session cannot grow without bound.
const HISTORY_LIMIT = 100;

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

// Commit a new present, pushing the old present onto the past and clearing the
// redo future. Drops the oldest past entry once the limit is exceeded.
export function pushHistory<T>(h: History<T>, present: T): History<T> {
  const past = [...h.past, h.present];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, present, future: [] };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

// Step back one snapshot, moving the present onto the future stack.
export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const previous = h.past[h.past.length - 1];
  const past = h.past.slice(0, -1);
  return { past, present: previous, future: [h.present, ...h.future] };
}

// Step forward one snapshot, moving the present back onto the past stack.
export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const next = h.future[0];
  const future = h.future.slice(1);
  return { past: [...h.past, h.present], present: next, future };
}
