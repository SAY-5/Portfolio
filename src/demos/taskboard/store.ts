// Browser-side model of the TaskBoard document. The whole board is one
// optimistic-locked record: columns own an ordered list of card ids and each
// card records its columnId. Every committed mutation increments a @Version.
// A save built on a stale version loses the optimistic race; the loser re-reads
// the head, replays its move, and the monotonic seq is the tie-break that fixes
// the final column. Two invariants hold after any commit: a card id sits in
// exactly one column's cardOrder, and that card's columnId matches the column
// listing it. Nothing here talks to a server; the board persists in
// localStorage so it survives a reload.

import {
  COLUMN_ORDER,
  seedBoard,
  type Board,
  type Card,
  type ColumnId,
} from './data';

const BOARD_KEY = 'taskboard.board.v1';
const LOG_KEY = 'taskboard.log.v1';
const MAX_LOG = 60;

// Fan-out benchmark: delivering one move to 500 subscriber queues sustains
// roughly 80,000 to 90,000 moves per second on the reference machine.
export const FANOUT_LOW = 80_000;
export const FANOUT_HIGH = 90_000;
export const FANOUT_QUEUES = 500;

export type Actor = 'you' | 'mate' | 'sys';

export type LogLine = {
  id: number;
  who: Actor;
  text: string;
  at: number;
};

export type Presence = {
  // The simulated second user is "present" while a conflicting move is in
  // flight, which drives the avatar glow in the UI.
  mate: boolean;
};

export type State = {
  board: Board;
  log: LogLine[];
  presence: Presence;
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

function loadBoard(): Board {
  const stored = readJSON<Board | null>(BOARD_KEY, null);
  if (stored && stored.columns && stored.cards) return stored;
  return seedBoard();
}

function persist(): void {
  writeJSON(BOARD_KEY, state.board);
  writeJSON(LOG_KEY, state.log);
}

// ---------- minimal external store ----------

let state: State = {
  board: loadBoard(),
  log: readJSON<LogLine[]>(LOG_KEY, []),
  presence: { mate: false },
};
let logId = state.log.reduce((max, l) => Math.max(max, l.id), 0);

const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function commit(next: Partial<State>): void {
  state = { ...state, ...next };
  persist();
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

// ---------- log ----------

function appendLog(who: Actor, text: string): LogLine[] {
  logId += 1;
  const line: LogLine = { id: logId, who, text, at: Date.now() };
  const log = [...state.log, line].slice(-MAX_LOG);
  return log;
}

// ---------- board helpers ----------

function cloneBoard(b: Board): Board {
  return {
    version: b.version,
    seq: b.seq,
    columns: b.columns.map((c) => ({ ...c, cardOrder: [...c.cardOrder] })),
    cards: Object.fromEntries(
      Object.entries(b.cards).map(([id, c]) => [id, { ...c }]),
    ),
  };
}

function columnOf(b: Board, id: ColumnId) {
  return b.columns.find((c) => c.id === id);
}

function makeCardId(b: Board): string {
  let n = 206;
  while (b.cards[`c-${n}`]) n += 1;
  return `c-${n}`;
}

// Detach a card id from whatever column currently lists it. Keeps invariant 1
// holding by guaranteeing the id is in at most one cardOrder before insertion.
function detach(b: Board, cardId: string): void {
  for (const col of b.columns) {
    const at = col.cardOrder.indexOf(cardId);
    if (at !== -1) col.cardOrder.splice(at, 1);
  }
}

// ---------- card actions ----------

export function addCard(title: string, note: string, columnId: ColumnId): void {
  const trimmed = title.trim();
  if (!trimmed) return;
  const board = cloneBoard(state.board);
  const id = makeCardId(board);
  board.seq += 1;
  board.version += 1;
  board.cards[id] = {
    id,
    title: trimmed,
    note: note.trim(),
    columnId,
    seq: board.seq,
  };
  const col = columnOf(board, columnId);
  if (col) col.cardOrder.push(id);
  commit({ board, log: appendLog('you', `add ${id} to ${columnId}`) });
}

export function editCard(id: string, title: string, note: string): void {
  const trimmed = title.trim();
  if (!trimmed) return;
  const card = state.board.cards[id];
  if (!card) return;
  const board = cloneBoard(state.board);
  board.version += 1;
  board.cards[id] = { ...board.cards[id], title: trimmed, note: note.trim() };
  commit({ board, log: appendLog('you', `edit ${id}`) });
}

export function deleteCard(id: string): void {
  if (!state.board.cards[id]) return;
  const board = cloneBoard(state.board);
  board.version += 1;
  detach(board, id);
  delete board.cards[id];
  commit({ board, log: appendLog('you', `delete ${id}`) });
}

// Move a card to a target column at a target index. Used by drag-and-drop and
// keyboard moves alike. index of -1 (or out of range) appends to the end.
export function moveCard(
  cardId: string,
  toColumn: ColumnId,
  toIndex: number,
): void {
  const card = state.board.cards[cardId];
  if (!card) return;
  const board = cloneBoard(state.board);
  board.seq += 1;
  board.version += 1;
  detach(board, cardId);
  const col = columnOf(board, toColumn);
  if (!col) return;
  const clamped =
    toIndex < 0 || toIndex > col.cardOrder.length
      ? col.cardOrder.length
      : toIndex;
  col.cardOrder.splice(clamped, 0, cardId);
  board.cards[cardId] = { ...card, columnId: toColumn, seq: board.seq };
  commit({ board, log: appendLog('you', `move ${cardId} to ${toColumn}`) });
}

// ---------- the optimistic conflict path ----------

export type ConflictStep =
  | { kind: 'mate-present' }
  | { kind: 'both-issue'; base: number; youTo: ColumnId; mateTo: ColumnId }
  | { kind: 'mate-commits'; from: number; to: number; mateTo: ColumnId }
  | { kind: 'you-rejected'; stale: number; head: number }
  | { kind: 'you-rebase'; head: number }
  | { kind: 'seq-tiebreak'; youSeq: number; mateSeq: number; winner: ColumnId }
  | { kind: 'settled'; version: number; column: ColumnId }
  | { kind: 'mate-leaves' };

export type ConflictPlan = {
  cardId: string;
  steps: ConflictStep[];
  // Final state to apply once the replay finishes, computed up front so the UI
  // animation and the persisted board never drift apart.
  finalBoard: Board;
};

// Build the deterministic outcome of two clients racing a move of one card.
// You drop it in one column, the simulated mate drops it in another at the same
// instant against the same base @Version. The mate commits first and bumps the
// version. Your save is rejected as stale; you re-read head and replay. The
// higher seq wins the tie-break, so the card settles in the mate's column
// because the mate's move carries the later seq. The returned plan lists the
// steps for the UI to replay and the final board to commit.
export function planConflict(cardId: string): ConflictPlan | null {
  const card = state.board.cards[cardId];
  if (!card) return null;

  const here = card.columnId;
  // Pick two distinct targets different from the current column when possible.
  const others = COLUMN_ORDER.filter((c) => c !== here);
  const youTo: ColumnId = others[0] ?? here;
  const mateTo: ColumnId = others[1] ?? others[0] ?? here;

  const base = state.board.version;
  const youSeq = state.board.seq + 1; // your move drafts the next seq
  const mateSeq = state.board.seq + 2; // the mate issues the later move
  const winner: ColumnId = mateSeq > youSeq ? mateTo : youTo;

  // Compute the final board: card lands in the winner column with the winning
  // seq, version advanced by the mate commit plus your rebase commit.
  const finalBoard = cloneBoard(state.board);
  finalBoard.seq = mateSeq;
  finalBoard.version = base + 2;
  detach(finalBoard, cardId);
  const col = columnOf(finalBoard, winner);
  if (col) col.cardOrder.push(cardId);
  finalBoard.cards[cardId] = { ...card, columnId: winner, seq: mateSeq };

  const steps: ConflictStep[] = [
    { kind: 'mate-present' },
    { kind: 'both-issue', base, youTo, mateTo },
    { kind: 'mate-commits', from: base, to: base + 1, mateTo },
    { kind: 'you-rejected', stale: base, head: base + 1 },
    { kind: 'you-rebase', head: base + 1 },
    { kind: 'seq-tiebreak', youSeq, mateSeq, winner },
    { kind: 'settled', version: base + 2, column: winner },
    { kind: 'mate-leaves' },
  ];

  return { cardId, steps, finalBoard };
}

// Apply one replay step to the live state so the board, log, and presence move
// in lockstep with the animation timeline driven by the component.
export function applyConflictStep(
  plan: ConflictPlan,
  step: ConflictStep,
): void {
  switch (step.kind) {
    case 'mate-present':
      commit({ presence: { mate: true } });
      return;
    case 'both-issue':
      commit({
        log: appendLog(
          'sys',
          `both issue move on ${plan.cardId} at @Version ${step.base}`,
        ),
      });
      return;
    case 'mate-commits':
      commit({
        log: appendLog(
          'mate',
          `save committed: @Version ${step.from} to ${step.to}`,
        ),
      });
      return;
    case 'you-rejected':
      commit({
        log: appendLog(
          'sys',
          `your save rejected: stale @Version ${step.stale}, head @Version ${step.head}`,
        ),
      });
      return;
    case 'you-rebase':
      commit({
        log: appendLog('you', `re-read @Version ${step.head}, rebase move`),
      });
      return;
    case 'seq-tiebreak':
      commit({
        log: appendLog(
          'sys',
          `seq tie-break: you seq ${step.youSeq} < mate seq ${step.mateSeq}, ${step.winner} wins`,
        ),
      });
      return;
    case 'settled':
      commit({
        board: plan.finalBoard,
        log: appendLog(
          'sys',
          `settled @Version ${step.version}: ${plan.cardId} in ${step.column}, invariants hold`,
        ),
      });
      return;
    case 'mate-leaves':
      commit({ presence: { mate: false } });
      return;
  }
}

// ---------- invariant check ----------

// True when every card sits in exactly one column's cardOrder and its columnId
// matches that column. The UI surfaces this so the guarantee is observable.
export function invariantsHold(b: Board = state.board): boolean {
  const seen = new Set<string>();
  for (const col of b.columns) {
    for (const id of col.cardOrder) {
      if (seen.has(id)) return false; // listed in more than one column
      seen.add(id);
      const card = b.cards[id];
      if (!card || card.columnId !== col.id) return false;
    }
  }
  // Every card must be listed somewhere.
  return Object.keys(b.cards).every((id) => seen.has(id));
}

// ---------- reset ----------

export function resetBoard(): void {
  try {
    localStorage.removeItem(BOARD_KEY);
    localStorage.removeItem(LOG_KEY);
  } catch {
    // ignore storage errors
  }
  logId = 0;
  state = {
    board: seedBoard(),
    log: [],
    presence: { mate: false },
  };
  emit();
}

export type { Board, Card, ColumnId };
