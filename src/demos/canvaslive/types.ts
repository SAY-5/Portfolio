// Shape model for the CanvasLive whiteboard editor. Every shape is a plain
// data record with a stable id, a kind, a position and size box, and styling.
// The z field gives a global stacking order: higher z paints on top.

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'text';

export type Shape = {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
  // Only meaningful for text shapes; ignored for the others.
  text: string;
  z: number;
};

// The full editable document: an ordered set of shapes plus the id of the
// currently selected shape (or null when nothing is selected).
export type CanvasDoc = {
  shapes: Shape[];
  selectedId: string | null;
};

// A point in canvas coordinates, used for hit-testing and drag math.
export type Point = { x: number; y: number };

// An axis-aligned bounding box, used for selection bounds and resize handles.
export type Box = { x: number; y: number; w: number; h: number };

// The eight handles around a selection box plus the body for move drags.
export type HandleId =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w';

export const HANDLE_IDS: HandleId[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
];
