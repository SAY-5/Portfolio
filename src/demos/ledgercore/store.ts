// Browser-side model of the ledger. The chart of accounts and posted journal
// entries live in localStorage. A framework-agnostic store exposes a consistent
// snapshot through subscribe/getState; the React binding in state.ts wires it
// to useSyncExternalStore. All money is integer cents. The only gate on posting
// is the engine's balanced check: unbalanced drafts are rejected, never stored.

import {
  type Account,
  type EntryLine,
  type JournalEntry,
} from './types';
import { validateEntry, type ValidationResult } from './engine';

const ACCOUNTS_KEY = 'ledgercore.accounts.v1';
const ENTRIES_KEY = 'ledgercore.entries.v1';
const SEQ_KEY = 'ledgercore.seq.v1';

// A small but complete seed chart so the app shows real balances on first load.
const SEED_ACCOUNTS: Account[] = [
  { code: '1000', name: 'Cash', type: 'asset' },
  { code: '1100', name: 'Accounts Receivable', type: 'asset' },
  { code: '1500', name: 'Equipment', type: 'asset' },
  { code: '2000', name: 'Accounts Payable', type: 'liability' },
  { code: '3000', name: 'Owner Capital', type: 'equity' },
  { code: '4000', name: 'Service Revenue', type: 'revenue' },
  { code: '5000', name: 'Rent Expense', type: 'expense' },
  { code: '5100', name: 'Wages Expense', type: 'expense' },
];

// A few balanced opening entries. Each one has equal debits and credits, so the
// trial balance and the accounting identity hold on first load.
const SEED_ENTRIES: JournalEntry[] = [
  {
    id: 'JE-1001',
    date: '2026-01-02',
    memo: 'Owner funds the business',
    lines: [
      { accountCode: '1000', debit: 5_000_00, credit: 0 },
      { accountCode: '3000', debit: 0, credit: 5_000_00 },
    ],
  },
  {
    id: 'JE-1002',
    date: '2026-01-05',
    memo: 'Buy equipment on account',
    lines: [
      { accountCode: '1500', debit: 1_200_00, credit: 0 },
      { accountCode: '2000', debit: 0, credit: 1_200_00 },
    ],
  },
  {
    id: 'JE-1003',
    date: '2026-01-12',
    memo: 'Invoice client for services',
    lines: [
      { accountCode: '1100', debit: 2_400_00, credit: 0 },
      { accountCode: '4000', debit: 0, credit: 2_400_00 },
    ],
  },
  {
    id: 'JE-1004',
    date: '2026-01-31',
    memo: 'Pay monthly rent',
    lines: [
      { accountCode: '5000', debit: 900_00, credit: 0 },
      { accountCode: '1000', debit: 0, credit: 900_00 },
    ],
  },
];

const SEED_SEQ = 1005;

export type State = {
  accounts: Account[];
  entries: JournalEntry[];
  // Monotonic counter behind assigned entry ids. Persisted so ids stay unique
  // across reloads without depending on the clock.
  seq: number;
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

function loadState(): State {
  const accounts = readJSON<Account[]>(ACCOUNTS_KEY, SEED_ACCOUNTS);
  const entries = readJSON<JournalEntry[]>(ENTRIES_KEY, SEED_ENTRIES);
  const seq = readJSON<number>(SEQ_KEY, SEED_SEQ);
  return { accounts, entries, seq };
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

// ---------- account actions ----------

export type AddAccountResult = { ok: true } | { ok: false; reason: string };

export function addAccount(account: Account): AddAccountResult {
  const code = account.code.trim();
  const name = account.name.trim();
  if (code === '') return { ok: false, reason: 'A code is required.' };
  if (name === '') return { ok: false, reason: 'A name is required.' };
  if (state.accounts.some((a) => a.code === code)) {
    return { ok: false, reason: `Code ${code} is already in use.` };
  }
  const next = [...state.accounts, { code, name, type: account.type }];
  // Keep the chart in stable code order so the grouped view is deterministic.
  next.sort((a, b) => a.code.localeCompare(b.code));
  writeJSON(ACCOUNTS_KEY, next);
  set({ accounts: next });
  return { ok: true };
}

// ---------- entry actions ----------

export type PostResult =
  | { ok: true; entry: JournalEntry }
  | { ok: false; reason: string };

// Post a draft entry. The lines are validated through the engine first; an
// unbalanced or malformed draft is rejected and nothing is written. On success
// a stable id is assigned from the persisted sequence and the entry is stored.
export function postEntry(date: string, memo: string, lines: EntryLine[]): PostResult {
  const draft: JournalEntry = { id: 'DRAFT', date, memo: memo.trim(), lines };
  const check: ValidationResult = validateEntry(draft);
  if (!check.ok) return { ok: false, reason: check.reason };

  const seq = state.seq + 1;
  const entry: JournalEntry = {
    id: `JE-${seq}`,
    date,
    memo: memo.trim(),
    lines: lines.map((l) => ({ ...l })),
  };
  const entries = [...state.entries, entry];
  writeJSON(ENTRIES_KEY, entries);
  writeJSON(SEQ_KEY, seq);
  set({ entries, seq });
  return { ok: true, entry };
}

// ---------- reset ----------

// Clear persisted state and restore the seed chart and entries.
export function resetAll(): void {
  try {
    localStorage.removeItem(ACCOUNTS_KEY);
    localStorage.removeItem(ENTRIES_KEY);
    localStorage.removeItem(SEQ_KEY);
  } catch {
    // ignore storage errors
  }
  state = {
    accounts: SEED_ACCOUNTS,
    entries: SEED_ENTRIES,
    seq: SEED_SEQ,
  };
  emit();
}
