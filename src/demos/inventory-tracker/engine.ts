// Pure inventory math. No eval, no I/O, no clock reads: every function takes
// its inputs explicitly and returns a value, so the same inputs always produce
// the same output. applyTxn is the one safety-critical rule: an issue can never
// drive on-hand quantity below zero, and a receive/adjust can never go negative
// either. Rejections come back as a typed result, not an exception.

import type {
  ApplyResult,
  CategoryTotal,
  Category,
  Item,
  LowStockRow,
  Transaction,
  TxnKind,
} from './types';

// Compute the resulting quantity of applying a transaction to a starting
// quantity. The transaction is rejected (ok=false) when it would break an
// invariant, with a clear reason for the UI.
export function applyTxn(
  currentQty: number,
  kind: TxnKind,
  qty: number,
): ApplyResult {
  if (!Number.isFinite(qty) || !Number.isInteger(qty)) {
    return { ok: false, reason: 'Quantity must be a whole number.' };
  }

  if (kind === 'adjust') {
    // Adjust sets the on-hand level directly to a counted value.
    if (qty < 0) {
      return { ok: false, reason: 'Adjusted level cannot be negative.' };
    }
    return { ok: true, qty };
  }

  if (qty <= 0) {
    return { ok: false, reason: 'Quantity must be greater than zero.' };
  }

  if (kind === 'receive') {
    return { ok: true, qty: currentQty + qty };
  }

  // kind === 'issue'
  if (qty > currentQty) {
    return {
      ok: false,
      reason: `Cannot issue ${qty}: only ${currentQty} on hand.`,
    };
  }
  return { ok: true, qty: currentQty - qty };
}

// Items at or below their reorder point, in stable sku order.
export function lowStock(items: Item[]): LowStockRow[] {
  return items
    .filter((i) => i.qty <= i.reorderPoint)
    .map((i) => ({
      sku: i.sku,
      name: i.name,
      category: i.category,
      qty: i.qty,
      reorderPoint: i.reorderPoint,
    }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
}

// Whether a single item is at or below its reorder point.
export function isLow(item: Item): boolean {
  return item.qty <= item.reorderPoint;
}

// Total value of one item line (qty * unit cost).
export function itemValue(item: Item): number {
  return item.qty * item.unitCost;
}

// Total value of all on-hand stock.
export function totalValue(items: Item[]): number {
  return items.reduce((sum, i) => sum + itemValue(i), 0);
}

// Total on-hand units across every item.
export function totalUnits(items: Item[]): number {
  return items.reduce((sum, i) => sum + i.qty, 0);
}

// Per-category rollups, sorted by descending value so the biggest buckets lead.
export function categoryTotals(items: Item[]): CategoryTotal[] {
  const byCat = new Map<Category, CategoryTotal>();
  for (const i of items) {
    const row =
      byCat.get(i.category) ??
      ({ category: i.category, items: 0, units: 0, value: 0 } as CategoryTotal);
    row.items += 1;
    row.units += i.qty;
    row.value += itemValue(i);
    byCat.set(i.category, row);
  }
  return [...byCat.values()].sort(
    (a, b) => b.value - a.value || a.category.localeCompare(b.category),
  );
}

// Movement history for one item, newest first by sequence number.
export function movementHistory(
  transactions: Transaction[],
  sku: string,
): Transaction[] {
  return transactions
    .filter((t) => t.sku === sku)
    .sort((a, b) => b.seq - a.seq);
}

// Full movement history across all items, newest first.
export function allMovements(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) => b.seq - a.seq);
}
