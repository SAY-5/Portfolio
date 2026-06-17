// The accounting engine. Pure functions over accounts and entries, no eval, no
// I/O, no clock. Everything is integer cents. The single invariant enforced at
// the gate is that an entry is valid only when its debits equal its credits.

import {
  type Account,
  type AccountType,
  type EntryLine,
  type JournalEntry,
  ACCOUNT_TYPES,
  normalSide,
} from './types';

// ---------- validation ----------

export type ValidationResult =
  | { ok: true; totalDebit: number; totalCredit: number }
  | { ok: false; reason: string; totalDebit: number; totalCredit: number };

// An integer-cents guard: rejects NaN, infinities, negatives, and fractions.
function isCents(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

export function sumDebits(lines: EntryLine[]): number {
  return lines.reduce((s, l) => s + l.debit, 0);
}

export function sumCredits(lines: EntryLine[]): number {
  return lines.reduce((s, l) => s + l.credit, 0);
}

// An entry is valid only when: it has at least two lines, every amount is a
// non-negative integer, every line touches exactly one side, and total debits
// equal total credits. Unbalanced entries are rejected here and never posted.
export function validateEntry(entry: JournalEntry): ValidationResult {
  const lines = entry.lines;
  const totalDebit = sumDebits(lines);
  const totalCredit = sumCredits(lines);

  if (lines.length < 2) {
    return { ok: false, reason: 'An entry needs at least two lines.', totalDebit, totalCredit };
  }
  for (const l of lines) {
    if (!isCents(l.debit) || !isCents(l.credit)) {
      return { ok: false, reason: 'Amounts must be whole non-negative cents.', totalDebit, totalCredit };
    }
    if (l.debit > 0 && l.credit > 0) {
      return { ok: false, reason: 'A line is either a debit or a credit, not both.', totalDebit, totalCredit };
    }
    if (l.debit === 0 && l.credit === 0) {
      return { ok: false, reason: 'Every line needs a debit or a credit amount.', totalDebit, totalCredit };
    }
  }
  if (totalDebit !== totalCredit) {
    return { ok: false, reason: 'Debits and credits must be equal.', totalDebit, totalCredit };
  }
  return { ok: true, totalDebit, totalCredit };
}

export function isBalanced(lines: EntryLine[]): boolean {
  return sumDebits(lines) === sumCredits(lines);
}

// ---------- balances ----------

// Raw debit-minus-credit total for one account across all posted entries.
export type AccountTotals = { debit: number; credit: number };

export function accountTotals(
  code: string,
  entries: JournalEntry[],
): AccountTotals {
  let debit = 0;
  let credit = 0;
  for (const e of entries) {
    for (const l of e.lines) {
      if (l.accountCode !== code) continue;
      debit += l.debit;
      credit += l.credit;
    }
  }
  return { debit, credit };
}

// Signed balance in the account's normal side. A debit-normal account reports a
// positive balance when debits exceed credits; a credit-normal account the
// reverse. The number returned is in cents on the normal side.
export function accountBalance(
  account: Account,
  entries: JournalEntry[],
): number {
  const { debit, credit } = accountTotals(account.code, entries);
  return normalSide(account.type) === 'debit' ? debit - credit : credit - debit;
}

// ---------- trial balance ----------

export type TrialBalanceRow = {
  account: Account;
  // The account's net placed on its natural column. Exactly one is non-zero in
  // the common case; a contra balance can flip the column.
  debit: number;
  credit: number;
};

export type TrialBalance = {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
};

// Build a trial balance: every account's net, columned by sign. The grand
// totals of the debit and credit columns must be equal when the books balance.
export function trialBalance(
  accounts: Account[],
  entries: JournalEntry[],
): TrialBalance {
  const rows: TrialBalanceRow[] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const account of accounts) {
    const { debit, credit } = accountTotals(account.code, entries);
    const net = debit - credit; // positive => net debit, negative => net credit
    const row: TrialBalanceRow =
      net >= 0
        ? { account, debit: net, credit: 0 }
        : { account, debit: 0, credit: -net };
    totalDebit += row.debit;
    totalCredit += row.credit;
    rows.push(row);
  }
  return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

// ---------- type rollups ----------

export type TypeRollup = Record<AccountType, number>;

// Sum of normal-side balances grouped by account type.
export function rollupByType(
  accounts: Account[],
  entries: JournalEntry[],
): TypeRollup {
  const rollup = {
    asset: 0,
    liability: 0,
    equity: 0,
    revenue: 0,
    expense: 0,
  } as TypeRollup;
  for (const account of accounts) {
    rollup[account.type] += accountBalance(account, entries);
  }
  return rollup;
}

// ---------- statements ----------

export type IncomeSummary = {
  revenue: number;
  expenses: number;
  netIncome: number;
};

// Revenue minus expenses. Net income flows into equity on the balance sheet.
export function incomeSummary(
  accounts: Account[],
  entries: JournalEntry[],
): IncomeSummary {
  const r = rollupByType(accounts, entries);
  return {
    revenue: r.revenue,
    expenses: r.expense,
    netIncome: r.revenue - r.expense,
  };
}

export type BalanceSheet = {
  assets: number;
  liabilities: number;
  // Equity recorded directly in equity accounts.
  equityAccounts: number;
  // Retained earnings for the period (net income), not yet closed to equity.
  retainedEarnings: number;
  // Liabilities + equity + retained earnings, what assets must equal.
  totalEquity: number;
  liabilitiesPlusEquity: number;
  balanced: boolean;
};

// Assets = liabilities + equity, where equity absorbs the period's net income.
// Closing entries normally move net income into retained earnings; here it is
// surfaced as a line so the identity holds before any close is posted.
export function balanceSheet(
  accounts: Account[],
  entries: JournalEntry[],
): BalanceSheet {
  const r = rollupByType(accounts, entries);
  const retainedEarnings = r.revenue - r.expense;
  const totalEquity = r.equity + retainedEarnings;
  const liabilitiesPlusEquity = r.liability + totalEquity;
  return {
    assets: r.asset,
    liabilities: r.liability,
    equityAccounts: r.equity,
    retainedEarnings,
    totalEquity,
    liabilitiesPlusEquity,
    balanced: r.asset === liabilitiesPlusEquity,
  };
}

// ---------- formatting ----------

// Render integer cents as a fixed two-decimal string. Pure and deterministic;
// no locale, no Intl ambiguity in the stored model.
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, '0');
  const grouped = whole.toLocaleString('en-US');
  return `${sign}${grouped}.${frac}`;
}

// Parse a user-typed amount like "12.34" or "1200" into integer cents. Returns
// null on anything that is not a clean non-negative money value. No eval: this
// is a strict numeric parse, not expression evaluation.
export function parseCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

export { ACCOUNT_TYPES };
