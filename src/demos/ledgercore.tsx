import { useMemo, useState } from 'react';
import '../styles/demo.css';
import './ledgercore.css';
import { useStore } from './ledgercore/state';
import {
  addAccount,
  postEntry,
  resetAll,
  type State,
} from './ledgercore/store';
import {
  accountBalance,
  balanceSheet,
  formatCents,
  incomeSummary,
  isBalanced,
  parseCents,
  sumCredits,
  sumDebits,
  trialBalance,
} from './ledgercore/engine';
import {
  ACCOUNT_TYPES,
  normalSide,
  type Account,
  type AccountType,
  type EntryLine,
} from './ledgercore/types';

// In-browser double-entry ledger. The chart of accounts and posted journal
// entries persist in localStorage and re-render through useSyncExternalStore.
// Every amount is integer cents and every computation runs through the pure
// engine: an entry posts only when its debits equal its credits, and the trial
// balance, balance sheet, and income summary are all derived from the same
// posted entries. No eval, no server, no floating-point money.

type Tab = 'accounts' | 'journal' | 'reports';

const TYPE_LABEL: Record<AccountType, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  expense: 'Expenses',
};

// A single editable line in the draft entry. Amounts are held as raw text while
// the user types and parsed to cents at validation time.
type DraftLine = {
  id: number;
  accountCode: string;
  debit: string;
  credit: string;
};

function emptyLine(id: number, accountCode = ''): DraftLine {
  return { id, accountCode, debit: '', credit: '' };
}

// Convert the draft text lines into engine lines in cents. Returns null when any
// amount fails the strict money parse, so the caller can reject before posting.
function draftToLines(draft: DraftLine[]): EntryLine[] | null {
  const out: EntryLine[] = [];
  for (const l of draft) {
    if (l.accountCode === '') continue;
    const hasDebit = l.debit.trim() !== '';
    const hasCredit = l.credit.trim() !== '';
    if (!hasDebit && !hasCredit) continue;
    const debit = hasDebit ? parseCents(l.debit) : 0;
    const credit = hasCredit ? parseCents(l.credit) : 0;
    if (debit === null || credit === null) return null;
    out.push({ accountCode: l.accountCode, debit, credit });
  }
  return out;
}

export default function LedgercoreDemo() {
  const state = useStore();
  const [tab, setTab] = useState<Tab>('accounts');

  return (
    <div className="demo lc" aria-label="ledgercore double-entry ledger">
      <span className="demo__tag">Interactive app</span>
      <h3 className="demo__title">A working double-entry ledger</h3>
      <p className="demo__lede">
        Add accounts, post balanced journal entries, and read the books. Debits
        must equal credits before an entry can post; the trial balance, balance
        sheet, and income summary are all derived from what you post. Everything
        is stored locally in whole cents.
      </p>

      <nav className="lc__tabs" aria-label="Ledger sections">
        <TabButton id="accounts" tab={tab} setTab={setTab}>
          Chart of accounts
        </TabButton>
        <TabButton id="journal" tab={tab} setTab={setTab}>
          Journal
        </TabButton>
        <TabButton id="reports" tab={tab} setTab={setTab}>
          Reports
        </TabButton>
      </nav>

      <div className="lc__panel glass" role="region" aria-label={tab}>
        {tab === 'accounts' && <AccountsView state={state} />}
        {tab === 'journal' && <JournalView state={state} />}
        {tab === 'reports' && <ReportsView state={state} />}
      </div>

      <div className="demo__controls">
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={() => {
            if (
              window.confirm(
                'Clear all accounts and entries, restoring the seed books?',
              )
            ) {
              resetAll();
            }
          }}
        >
          Reset ledger
        </button>
        <span className="demo__hint">
          {state.accounts.length} accounts, {state.entries.length} posted entries
        </span>
      </div>
    </div>
  );
}

function TabButton({
  id,
  tab,
  setTab,
  children,
}: {
  id: Tab;
  tab: Tab;
  setTab: (t: Tab) => void;
  children: React.ReactNode;
}) {
  const active = tab === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`lc__tab${active ? ' lc__tab--active' : ''}`}
      onClick={() => setTab(id)}
    >
      {children}
    </button>
  );
}

// ---------- chart of accounts ----------

function AccountsView({ state }: { state: State }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('asset');
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<AccountType, Account[]>();
    for (const t of ACCOUNT_TYPES) map.set(t, []);
    for (const a of state.accounts) map.get(a.type)!.push(a);
    return map;
  }, [state.accounts]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = addAccount({ code, name, type });
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setError(null);
    setCode('');
    setName('');
  }

  return (
    <div className="lc__accounts">
      <form className="lc__form" onSubmit={submit} aria-label="Add account">
        <div className="lc__field">
          <label htmlFor="acct-code">Code</label>
          <input
            id="acct-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="6000"
            inputMode="numeric"
          />
        </div>
        <div className="lc__field lc__field--grow">
          <label htmlFor="acct-name">Name</label>
          <input
            id="acct-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Utilities Expense"
          />
        </div>
        <div className="lc__field">
          <label htmlFor="acct-type">Type</label>
          <select
            id="acct-type"
            value={type}
            onChange={(e) => setType(e.target.value as AccountType)}
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="demo__btn">
          Add account
        </button>
      </form>
      {error && (
        <p className="lc__error" role="alert">
          {error}
        </p>
      )}

      <div className="lc__groups">
        {ACCOUNT_TYPES.map((t) => {
          const accounts = grouped.get(t)!;
          if (accounts.length === 0) return null;
          return (
            <section className="lc__group" key={t} aria-label={TYPE_LABEL[t]}>
              <h4 className="lc__group-head">
                <span>{TYPE_LABEL[t]}</span>
                <span className="lc__group-side">{normalSide(t)} normal</span>
              </h4>
              <table className="lc__table">
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Name</th>
                    <th scope="col" className="lc__num">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.code}>
                      <td className="lc__mono">{a.code}</td>
                      <td>{a.name}</td>
                      <td className="lc__num lc__mono">
                        {formatCents(accountBalance(a, state.entries))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------- journal ----------

function JournalView({ state }: { state: State }) {
  const [date, setDate] = useState('2026-02-01');
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [
    emptyLine(1),
    emptyLine(2),
  ]);
  const [nextId, setNextId] = useState(3);
  const [error, setError] = useState<string | null>(null);

  const engineLines = useMemo(() => draftToLines(lines), [lines]);
  const totalDebit = engineLines ? sumDebits(engineLines) : 0;
  const totalCredit = engineLines ? sumCredits(engineLines) : 0;
  const diff = totalDebit - totalCredit;
  const balanced =
    engineLines !== null &&
    engineLines.length >= 2 &&
    isBalanced(engineLines) &&
    totalDebit > 0;

  function updateLine(id: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function addRow() {
    setLines((prev) => [...prev, emptyLine(nextId)]);
    setNextId((n) => n + 1);
  }

  function removeRow(id: number) {
    setLines((prev) =>
      prev.length <= 2 ? prev : prev.filter((l) => l.id !== id),
    );
  }

  function post(e: React.FormEvent) {
    e.preventDefault();
    if (engineLines === null) {
      setError('Amounts must be whole money values like 100 or 100.50.');
      return;
    }
    const result = postEntry(date, memo, engineLines);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setError(null);
    setMemo('');
    setLines([emptyLine(nextId), emptyLine(nextId + 1)]);
    setNextId((n) => n + 2);
  }

  const journal = useMemo(() => [...state.entries].reverse(), [state.entries]);

  return (
    <div className="lc__journal">
      <form className="lc__entry" onSubmit={post} aria-label="Post journal entry">
        <div className="lc__entry-head">
          <div className="lc__field">
            <label htmlFor="je-date">Date</label>
            <input
              id="je-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="lc__field lc__field--grow">
            <label htmlFor="je-memo">Memo</label>
            <input
              id="je-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Describe the transaction"
            />
          </div>
        </div>

        <table className="lc__table lc__entry-lines">
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col" className="lc__num">
                Debit
              </th>
              <th scope="col" className="lc__num">
                Credit
              </th>
              <th scope="col">
                <span className="lc__sr">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>
                  <label className="lc__sr" htmlFor={`line-acct-${l.id}`}>
                    Account
                  </label>
                  <select
                    id={`line-acct-${l.id}`}
                    value={l.accountCode}
                    onChange={(e) =>
                      updateLine(l.id, { accountCode: e.target.value })
                    }
                  >
                    <option value="">Select account</option>
                    {state.accounts.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code} {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="lc__num">
                  <label className="lc__sr" htmlFor={`line-debit-${l.id}`}>
                    Debit
                  </label>
                  <input
                    id={`line-debit-${l.id}`}
                    className="lc__amt"
                    value={l.debit}
                    onChange={(e) =>
                      updateLine(l.id, { debit: e.target.value, credit: '' })
                    }
                    placeholder="0.00"
                    inputMode="decimal"
                  />
                </td>
                <td className="lc__num">
                  <label className="lc__sr" htmlFor={`line-credit-${l.id}`}>
                    Credit
                  </label>
                  <input
                    id={`line-credit-${l.id}`}
                    className="lc__amt"
                    value={l.credit}
                    onChange={(e) =>
                      updateLine(l.id, { credit: e.target.value, debit: '' })
                    }
                    placeholder="0.00"
                    inputMode="decimal"
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="lc__rm"
                    onClick={() => removeRow(l.id)}
                    disabled={lines.length <= 2}
                    aria-label={`Remove line ${l.id}`}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Totals</th>
              <td className="lc__num lc__mono">{formatCents(totalDebit)}</td>
              <td className="lc__num lc__mono">{formatCents(totalCredit)}</td>
              <td />
            </tr>
          </tfoot>
        </table>

        <div className="lc__entry-foot">
          <button
            type="button"
            className="demo__btn demo__btn--ghost"
            onClick={addRow}
          >
            Add line
          </button>
          <div
            className={`lc__balance${balanced ? ' lc__balance--ok' : ''}`}
            role="status"
            aria-live="polite"
          >
            {balanced ? (
              <span>In balance</span>
            ) : (
              <span>
                Out of balance by {formatCents(Math.abs(diff))}{' '}
                {diff > 0 ? '(debit heavy)' : diff < 0 ? '(credit heavy)' : ''}
              </span>
            )}
          </div>
          <button type="submit" className="demo__btn" disabled={!balanced}>
            Post entry
          </button>
        </div>
      </form>
      {error && (
        <p className="lc__error" role="alert">
          {error}
        </p>
      )}

      <h4 className="lc__subhead">Journal</h4>
      <ul className="lc__entries">
        {journal.length === 0 && (
          <li className="lc__empty">No entries posted yet.</li>
        )}
        {journal.map((entry) => (
          <li className="lc__je" key={entry.id}>
            <div className="lc__je-head">
              <span className="lc__mono">{entry.id}</span>
              <span className="lc__je-date">{entry.date}</span>
              <span className="lc__je-memo">{entry.memo || '(no memo)'}</span>
            </div>
            <table className="lc__table lc__je-lines">
              <tbody>
                {entry.lines.map((line, i) => {
                  const acct = state.accounts.find(
                    (a) => a.code === line.accountCode,
                  );
                  return (
                    <tr key={i}>
                      <td className="lc__mono">{line.accountCode}</td>
                      <td>{acct ? acct.name : 'Unknown account'}</td>
                      <td className="lc__num lc__mono">
                        {line.debit > 0 ? formatCents(line.debit) : ''}
                      </td>
                      <td className="lc__num lc__mono">
                        {line.credit > 0 ? formatCents(line.credit) : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- reports ----------

function ReportsView({ state }: { state: State }) {
  const tb = useMemo(
    () => trialBalance(state.accounts, state.entries),
    [state.accounts, state.entries],
  );
  const bs = useMemo(
    () => balanceSheet(state.accounts, state.entries),
    [state.accounts, state.entries],
  );
  const inc = useMemo(
    () => incomeSummary(state.accounts, state.entries),
    [state.accounts, state.entries],
  );

  return (
    <div className="lc__reports">
      <section aria-label="Trial balance">
        <h4 className="lc__subhead">Trial balance</h4>
        <table className="lc__table">
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Account</th>
              <th scope="col" className="lc__num">
                Debit
              </th>
              <th scope="col" className="lc__num">
                Credit
              </th>
            </tr>
          </thead>
          <tbody>
            {tb.rows.map((row) => (
              <tr key={row.account.code}>
                <td className="lc__mono">{row.account.code}</td>
                <td>{row.account.name}</td>
                <td className="lc__num lc__mono">
                  {row.debit > 0 ? formatCents(row.debit) : ''}
                </td>
                <td className="lc__num lc__mono">
                  {row.credit > 0 ? formatCents(row.credit) : ''}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={tb.balanced ? 'lc__tb-ok' : 'lc__tb-bad'}>
              <th scope="row" colSpan={2}>
                Totals {tb.balanced ? '(equal)' : '(not equal)'}
              </th>
              <td className="lc__num lc__mono">{formatCents(tb.totalDebit)}</td>
              <td className="lc__num lc__mono">{formatCents(tb.totalCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      <div className="lc__statements">
        <section className="lc__statement" aria-label="Income summary">
          <h4 className="lc__subhead">Income summary</h4>
          <dl className="lc__dl">
            <div>
              <dt>Revenue</dt>
              <dd className="lc__mono">{formatCents(inc.revenue)}</dd>
            </div>
            <div>
              <dt>Expenses</dt>
              <dd className="lc__mono">{formatCents(inc.expenses)}</dd>
            </div>
            <div className="lc__dl-total">
              <dt>Net income</dt>
              <dd className="lc__mono">{formatCents(inc.netIncome)}</dd>
            </div>
          </dl>
        </section>

        <section className="lc__statement" aria-label="Balance sheet">
          <h4 className="lc__subhead">Balance sheet</h4>
          <dl className="lc__dl">
            <div>
              <dt>Assets</dt>
              <dd className="lc__mono">{formatCents(bs.assets)}</dd>
            </div>
            <div>
              <dt>Liabilities</dt>
              <dd className="lc__mono">{formatCents(bs.liabilities)}</dd>
            </div>
            <div>
              <dt>Equity</dt>
              <dd className="lc__mono">{formatCents(bs.equityAccounts)}</dd>
            </div>
            <div>
              <dt>Retained earnings</dt>
              <dd className="lc__mono">{formatCents(bs.retainedEarnings)}</dd>
            </div>
            <div className="lc__dl-total">
              <dt>Liabilities + equity</dt>
              <dd className="lc__mono">
                {formatCents(bs.liabilitiesPlusEquity)}
              </dd>
            </div>
          </dl>
          <p
            className={`lc__identity${bs.balanced ? ' lc__identity--ok' : ' lc__identity--bad'}`}
            role="status"
          >
            Assets {formatCents(bs.assets)} {bs.balanced ? 'equal' : 'differ from'}{' '}
            liabilities plus equity {formatCents(bs.liabilitiesPlusEquity)}
          </p>
        </section>
      </div>
    </div>
  );
}
