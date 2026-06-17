// Domain types for the in-browser inventory tracker. An Item is a stock
// keeping unit with an on-hand quantity, a reorder point, and a unit cost. A
// Transaction is an immutable ledger entry that moves stock: receive adds,
// issue removes, adjust sets a correction. Every transaction carries a
// monotonic sequence number so the ledger has a deterministic order
// independent of wall-clock time.

export type Category =
  | 'Components'
  | 'Peripherals'
  | 'Cables'
  | 'Storage'
  | 'Accessories';

export const CATEGORIES: Category[] = [
  'Components',
  'Peripherals',
  'Cables',
  'Storage',
  'Accessories',
];

export type Item = {
  sku: string;
  name: string;
  category: Category;
  qty: number;
  reorderPoint: number;
  unitCost: number; // cost per unit in whole currency units
};

export type TxnKind = 'receive' | 'issue' | 'adjust';

export type Transaction = {
  id: string;
  seq: number; // monotonic order, assigned by the store
  sku: string;
  kind: TxnKind;
  qty: number; // units received/issued, or the target level for an adjust
  reason: string;
  at: number; // snapshot of the clock at creation, for display only
};

// The currency these whole-number costs are denominated in.
export const CURRENCY = 'USD';

// Result of applying a transaction against a current quantity. The engine never
// throws on a business rejection: it returns ok=false with a human reason so
// the UI can surface it without a try/catch around every call.
export type ApplyResult =
  | { ok: true; qty: number }
  | { ok: false; reason: string };

// A single low-stock alert row.
export type LowStockRow = {
  sku: string;
  name: string;
  category: Category;
  qty: number;
  reorderPoint: number;
};

// Per-category rollup used by the dashboard.
export type CategoryTotal = {
  category: Category;
  items: number;
  units: number;
  value: number;
};
