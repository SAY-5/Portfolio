// Seed for the in-browser TaskBoard. In the real system one board is a single
// optimistic-locked document: columns own an ordered list of card ids and each
// card records the column it lives in. Here the seed is static so the board
// runs fully in the browser; the store keeps the same shape the document has on
// the server, so the two invariants below can be checked at runtime.
//
//   1. a card id appears in exactly one column's cardOrder
//   2. a card's columnId matches the column whose cardOrder lists it

export type ColumnId = 'todo' | 'doing' | 'done';

export type Card = {
  id: string;
  title: string;
  note: string;
  columnId: ColumnId;
  // Monotonic per-move sequence. The highest seq wins when two clients race a
  // move of the same card, which keeps the resolution deterministic.
  seq: number;
};

export type Column = {
  id: ColumnId;
  label: string;
  // Ordered card ids. Order within a column is the source of truth for layout.
  cardOrder: string[];
};

export type Board = {
  columns: Column[];
  cards: Record<string, Card>;
  // Optimistic concurrency token. Every committed change increments it; a save
  // built on a stale version loses the race and rebases.
  version: number;
  // Last seq handed out, so new moves keep climbing.
  seq: number;
};

export const COLUMN_LABELS: Record<ColumnId, string> = {
  todo: 'Todo',
  doing: 'Doing',
  done: 'Done',
};

export const COLUMN_ORDER: ColumnId[] = ['todo', 'doing', 'done'];

type Seed = { id: string; title: string; note: string; columnId: ColumnId };

const SEED_CARDS: Seed[] = [
  {
    id: 'c-201',
    title: 'Draft the board schema',
    note: 'columns own cardOrder, cards carry columnId',
    columnId: 'todo',
  },
  {
    id: 'c-202',
    title: 'Add the optimistic version token',
    note: 'reject saves built on a stale @Version',
    columnId: 'todo',
  },
  {
    id: 'c-203',
    title: 'Wire STOMP reconnect',
    note: 'resume the live feed after a dropped socket',
    columnId: 'doing',
  },
  {
    id: 'c-204',
    title: 'Rebase the losing move',
    note: 're-read, replay onto head, seq decides the column',
    columnId: 'doing',
  },
  {
    id: 'c-205',
    title: 'Ship the activity feed',
    note: 'append-only log of every committed move',
    columnId: 'done',
  },
];

// Build a fresh board from the seed. Returned by value so a reset always starts
// from a clean copy rather than a shared mutable reference.
export function seedBoard(): Board {
  const cards: Record<string, Card> = {};
  const columns: Column[] = COLUMN_ORDER.map((id) => ({
    id,
    label: COLUMN_LABELS[id],
    cardOrder: [],
  }));
  let seq = 0;
  for (const s of SEED_CARDS) {
    seq += 1;
    cards[s.id] = { ...s, seq };
    const col = columns.find((c) => c.id === s.columnId);
    if (col) col.cardOrder.push(s.id);
  }
  return { columns, cards, version: 1, seq };
}
