// Framework-agnostic store for the inventory tracker. Items and the
// transaction ledger persist in localStorage so they survive a reload. All
// mutations go through the pure engine, so the no-negative-stock guard is
// enforced in one place. Stock moves return an ApplyResult; callers surface the
// rejection reason without a try/catch. A monotonic seq drives ledger order so
// the model is deterministic regardless of the wall clock.

import { applyTxn } from './engine';
import type {
  ApplyResult,
  Category,
  Item,
  Transaction,
  TxnKind,
} from './types';

const ITEMS_KEY = 'inventory-tracker.items.v1';
const TXNS_KEY = 'inventory-tracker.txns.v1';
const SEQ_KEY = 'inventory-tracker.seq.v1';

// Seed: ~10 items across categories, several already at or below reorder point
// so the low-stock view and dashboard alerts have something to show on a fresh
// load.
function seedItems(): Item[] {
  return [
    { sku: 'CPU-9700', name: 'Desktop CPU 8-core', category: 'Components', qty: 12, reorderPoint: 6, unitCost: 280 },
    { sku: 'RAM-32K', name: 'DDR5 32GB Kit', category: 'Components', qty: 4, reorderPoint: 8, unitCost: 110 },
    { sku: 'GPU-4060', name: 'Graphics Card 8GB', category: 'Components', qty: 3, reorderPoint: 4, unitCost: 320 },
    { sku: 'KB-87', name: 'Tenkeyless Keyboard', category: 'Peripherals', qty: 18, reorderPoint: 10, unitCost: 64 },
    { sku: 'MS-12', name: 'Wireless Mouse', category: 'Peripherals', qty: 6, reorderPoint: 12, unitCost: 28 },
    { sku: 'MON-27', name: '27in QHD Monitor', category: 'Peripherals', qty: 9, reorderPoint: 5, unitCost: 190 },
    { sku: 'USB-C2', name: 'USB-C Cable 2m', category: 'Cables', qty: 40, reorderPoint: 25, unitCost: 6 },
    { sku: 'HDMI-2', name: 'HDMI 2.1 Cable', category: 'Cables', qty: 14, reorderPoint: 20, unitCost: 9 },
    { sku: 'SSD-1T', name: 'NVMe SSD 1TB', category: 'Storage', qty: 22, reorderPoint: 10, unitCost: 78 },
    { sku: 'HDD-4T', name: 'HDD 4TB', category: 'Storage', qty: 2, reorderPoint: 5, unitCost: 92 },
    { sku: 'PAD-XL', name: 'Desk Mat XL', category: 'Accessories', qty: 16, reorderPoint: 8, unitCost: 15 },
    { sku: 'HUB-7P', name: '7-Port USB Hub', category: 'Accessories', qty: 5, reorderPoint: 6, unitCost: 34 },
  ];
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
    // storage may be unavailable (private mode); the app still runs in-memory.
  }
}

export type State = {
  items: Item[];
  transactions: Transaction[];
  seq: number;
  // The last stock-move rejection, surfaced in the UI until the next action.
  lastError: string | null;
};

function loadState(): State {
  const items = readJSON<Item[]>(ITEMS_KEY, []);
  if (items.length === 0) {
    const seeded = seedItems();
    writeJSON(ITEMS_KEY, seeded);
    return { items: seeded, transactions: [], seq: 0, lastError: null };
  }
  return {
    items,
    transactions: readJSON<Transaction[]>(TXNS_KEY, []),
    seq: readJSON<number>(SEQ_KEY, 0),
    lastError: null,
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

export function findItem(sku: string, s: State = state): Item | undefined {
  return s.items.find((i) => i.sku === sku);
}

function persistItems(items: Item[]): void {
  writeJSON(ITEMS_KEY, items);
}

function persistTxns(transactions: Transaction[], seq: number): void {
  writeJSON(TXNS_KEY, transactions);
  writeJSON(SEQ_KEY, seq);
}

// A deterministic id from the sequence number; no clock or randomness needed.
function txnId(seq: number): string {
  return `T-${seq.toString().padStart(5, '0')}`;
}

// ---------- item actions ----------

// Add a brand-new item. Returns a result so the UI can show why a duplicate or
// invalid sku was rejected.
export function addItem(input: {
  sku: string;
  name: string;
  category: Category;
  qty: number;
  reorderPoint: number;
  unitCost: number;
  now: number;
}): ApplyResult {
  const sku = input.sku.trim().toUpperCase();
  const name = input.name.trim();
  if (!sku) return { ok: false, reason: 'SKU is required.' };
  if (!name) return { ok: false, reason: 'Name is required.' };
  if (findItem(sku)) return { ok: false, reason: `SKU ${sku} already exists.` };
  if (
    !Number.isInteger(input.qty) ||
    input.qty < 0 ||
    !Number.isInteger(input.reorderPoint) ||
    input.reorderPoint < 0
  ) {
    return { ok: false, reason: 'Quantities must be whole numbers >= 0.' };
  }
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0) {
    return { ok: false, reason: 'Unit cost must be >= 0.' };
  }

  const item: Item = {
    sku,
    name,
    category: input.category,
    qty: input.qty,
    reorderPoint: input.reorderPoint,
    unitCost: input.unitCost,
  };
  const items = [...state.items, item];
  persistItems(items);

  // Record the opening balance as a receive so the ledger is complete.
  let transactions = state.transactions;
  let seq = state.seq;
  if (input.qty > 0) {
    seq += 1;
    const txn: Transaction = {
      id: txnId(seq),
      seq,
      sku,
      kind: 'receive',
      qty: input.qty,
      reason: 'Opening balance',
      at: input.now,
    };
    transactions = [...transactions, txn];
    persistTxns(transactions, seq);
  }

  set({ items, transactions, seq, lastError: null });
  return { ok: true, qty: item.qty };
}

// Move stock for an existing item. The engine decides the new quantity and
// enforces the no-negative-stock guard; a rejection is stored in lastError and
// returned, and nothing is written.
export function moveStock(input: {
  sku: string;
  kind: TxnKind;
  qty: number;
  reason: string;
  now: number;
}): ApplyResult {
  const item = findItem(input.sku);
  if (!item) return { ok: false, reason: `Unknown SKU ${input.sku}.` };

  const result = applyTxn(item.qty, input.kind, input.qty);
  if (!result.ok) {
    set({ lastError: result.reason });
    return result;
  }

  const reason = input.reason.trim() || defaultReason(input.kind);
  const seq = state.seq + 1;
  const txn: Transaction = {
    id: txnId(seq),
    seq,
    sku: input.sku,
    kind: input.kind,
    qty: input.qty,
    reason,
    at: input.now,
  };
  const items = state.items.map((i) =>
    i.sku === input.sku ? { ...i, qty: result.qty } : i,
  );
  const transactions = [...state.transactions, txn];
  persistItems(items);
  persistTxns(transactions, seq);
  set({ items, transactions, seq, lastError: null });
  return result;
}

function defaultReason(kind: TxnKind): string {
  if (kind === 'receive') return 'Stock received';
  if (kind === 'issue') return 'Stock issued';
  return 'Stock adjusted';
}

export function clearError(): void {
  if (state.lastError !== null) set({ lastError: null });
}

// Wipe persisted state and reseed from scratch.
export function resetAll(): void {
  try {
    localStorage.removeItem(ITEMS_KEY);
    localStorage.removeItem(TXNS_KEY);
    localStorage.removeItem(SEQ_KEY);
  } catch {
    // ignore storage errors
  }
  const seeded = seedItems();
  writeJSON(ITEMS_KEY, seeded);
  state = { items: seeded, transactions: [], seq: 0, lastError: null };
  emit();
}
