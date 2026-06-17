// Small drag-and-drop helpers shared by pointer and keyboard moves. The board
// store owns the actual mutation (moveCard); this module only computes target
// positions so the component stays declarative.

import { COLUMN_ORDER, type Board, type ColumnId } from './data';

export type DropTarget = { column: ColumnId; index: number };

// Where a card currently sits, as a column and an index within that column.
export function locate(
  board: Board,
  cardId: string,
): DropTarget | null {
  for (const col of board.columns) {
    const index = col.cardOrder.indexOf(cardId);
    if (index !== -1) return { column: col.id, index };
  }
  return null;
}

// Resolve the drop index when dropping a dragged card before a given card. When
// dropping into the same column above its old slot the raw index is correct;
// when the old slot is above the target the array shrinks by one on detach, so
// the caller's moveCard handles clamping. We keep this simple and let moveCard
// clamp out-of-range indices to the end.
export function indexBefore(
  board: Board,
  column: ColumnId,
  beforeCardId: string | null,
): number {
  const col = board.columns.find((c) => c.id === column);
  if (!col) return 0;
  if (beforeCardId === null) return col.cardOrder.length;
  const at = col.cardOrder.indexOf(beforeCardId);
  return at === -1 ? col.cardOrder.length : at;
}

// Keyboard move: shift a grabbed card one step in a direction. Left/Right move
// across columns keeping a similar row; Up/Down reorder within the column.
export type Dir = 'left' | 'right' | 'up' | 'down';

export function step(
  board: Board,
  cardId: string,
  dir: Dir,
): DropTarget | null {
  const from = locate(board, cardId);
  if (!from) return null;
  const colPos = COLUMN_ORDER.indexOf(from.column);

  if (dir === 'left' || dir === 'right') {
    const nextPos = dir === 'left' ? colPos - 1 : colPos + 1;
    if (nextPos < 0 || nextPos >= COLUMN_ORDER.length) return null;
    const targetCol = COLUMN_ORDER[nextPos];
    const dest = board.columns.find((c) => c.id === targetCol);
    if (!dest) return null;
    // Drop at the same row if it exists, else at the end.
    const index = Math.min(from.index, dest.cardOrder.length);
    return { column: targetCol, index };
  }

  // up / down within the same column
  const col = board.columns.find((c) => c.id === from.column);
  if (!col) return null;
  const delta = dir === 'up' ? -1 : 1;
  const nextIndex = from.index + delta;
  if (nextIndex < 0 || nextIndex >= col.cardOrder.length) return null;
  return { column: from.column, index: nextIndex };
}
