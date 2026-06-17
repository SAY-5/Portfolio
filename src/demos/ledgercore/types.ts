// Domain types for the double-entry ledger. Amounts are always integer minor
// units (cents) so arithmetic stays exact: no floats, no rounding drift.

// The five classical account types. Each has a fixed normal side: the side on
// which an increase is recorded. Assets and expenses are debit-normal;
// liabilities, equity, and revenue are credit-normal.
export type AccountType =
  | 'asset'
  | 'liability'
  | 'equity'
  | 'revenue'
  | 'expense';

export type NormalSide = 'debit' | 'credit';

export type Account = {
  // Stable short code, e.g. "1000". Used as the line reference and as the key
  // in balance maps. Unique within the chart.
  code: string;
  name: string;
  type: AccountType;
};

// A single posting line: a non-negative cents amount on exactly one side.
// A line carries either a debit or a credit, never both and never neither.
export type EntryLine = {
  accountCode: string;
  // Both are non-negative integers; exactly one is > 0 for a meaningful line.
  debit: number;
  credit: number;
};

// A journal entry groups lines that must balance (sum debits == sum credits).
export type JournalEntry = {
  id: string;
  // ISO date string (YYYY-MM-DD); kept as a string so it is deterministic and
  // never derived from the wall clock at render time.
  date: string;
  memo: string;
  lines: EntryLine[];
};

// The normal side for each account type. This is the accounting convention and
// is fixed, not configurable.
export const NORMAL_SIDE: Record<AccountType, NormalSide> = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  revenue: 'credit',
};

export const ACCOUNT_TYPES: AccountType[] = [
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
];

export function normalSide(type: AccountType): NormalSide {
  return NORMAL_SIDE[type];
}
