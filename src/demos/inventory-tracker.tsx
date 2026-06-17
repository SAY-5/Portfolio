import { useMemo, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './inventory-tracker.css';
import { useStore } from './inventory-tracker/state';
import {
  addItem,
  clearError,
  findItem,
  moveStock,
  resetAll,
} from './inventory-tracker/store';
import {
  allMovements,
  categoryTotals,
  isLow,
  itemValue,
  lowStock,
  totalUnits,
  totalValue,
} from './inventory-tracker/engine';
import {
  CATEGORIES,
  CURRENCY,
  type Category,
  type Item,
  type TxnKind,
} from './inventory-tracker/types';

// In-browser inventory and stock manager. Items, the transaction ledger, and a
// monotonic sequence persist in localStorage, so the catalog and every movement
// survive a reload. All stock moves run through one pure engine: an issue can
// never drive on-hand quantity below zero, and the rejection is shown inline
// rather than silently clamped. The dashboard rolls up low-stock alerts, total
// inventory value, and per-category breakdowns from the same engine the table
// uses, so the numbers always agree. Nothing here uses eval or talks to a
// server.

type View = 'items' | 'detail' | 'dashboard';

const money = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: CURRENCY,
    maximumFractionDigits: 0,
  }).format(n);

const KIND_LABEL: Record<TxnKind, string> = {
  receive: 'Receive',
  issue: 'Issue',
  adjust: 'Adjust',
};

export default function InventoryTrackerDemo() {
  const state = useStore();
  const reduce = useReducedMotion();
  const [view, setView] = useState<View>('items');
  const [selected, setSelected] = useState<string | null>(null);

  // The clock is snapshotted into render state once per mount, never read
  // inside the render path, so the view stays pure and deterministic.
  const [mountNow] = useState(() => Date.now());

  const lowCount = useMemo(() => lowStock(state.items).length, [state.items]);

  function openItem(sku: string) {
    clearError();
    setSelected(sku);
    setView('detail');
  }

  return (
    <div className="demo iv" data-reduce={reduce ? 'true' : 'false'}>
      <span className="demo__tag">inventory-tracker</span>
      <h3 className="demo__title">Inventory and stock manager</h3>
      <p className="demo__lede">
        Track stock keeping units, receive and issue stock against a guarded
        ledger, and watch low-stock alerts and total value update live. Items
        and every movement persist in your browser. An issue can never drive a
        count below zero.
      </p>

      <nav className="iv__tabs" aria-label="Inventory views">
        <TabButton active={view === 'items'} onClick={() => setView('items')}>
          Items
        </TabButton>
        <TabButton
          active={view === 'detail'}
          disabled={!selected}
          onClick={() => selected && setView('detail')}
        >
          Item detail
        </TabButton>
        <TabButton
          active={view === 'dashboard'}
          onClick={() => setView('dashboard')}
        >
          Dashboard{lowCount > 0 ? ` (${lowCount})` : ''}
        </TabButton>
      </nav>

      {view === 'items' && (
        <ItemsView items={state.items} onOpen={openItem} mountNow={mountNow} />
      )}
      {view === 'detail' && (
        <DetailView
          sku={selected}
          mountNow={mountNow}
          onBack={() => setView('items')}
        />
      )}
      {view === 'dashboard' && <DashboardView items={state.items} />}
    </div>
  );
}

function TabButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="iv__tab"
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// ---------- Items table ----------

function ItemsView({
  items,
  onOpen,
  mountNow,
}: {
  items: Item[];
  onOpen: (sku: string) => void;
  mountNow: number;
}) {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<'all' | Category>('all');
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (cat !== 'all' && i.category !== cat) return false;
      if (!q) return true;
      return (
        i.sku.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)
      );
    });
  }, [items, query, cat]);

  return (
    <section className="iv__panel glass" aria-label="Items">
      <div className="iv__toolbar">
        <label className="iv__field">
          <span className="iv__label">Search</span>
          <input
            type="search"
            className="iv__input"
            placeholder="SKU or name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="iv__field">
          <span className="iv__label">Category</span>
          <select
            className="iv__input"
            value={cat}
            onChange={(e) => setCat(e.target.value as 'all' | Category)}
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="demo__btn"
          onClick={() => setAdding((v) => !v)}
          aria-expanded={adding}
        >
          {adding ? 'Close' : 'Add item'}
        </button>
      </div>

      {adding && (
        <AddItemForm mountNow={mountNow} onDone={() => setAdding(false)} />
      )}

      <div
        className="iv__tablewrap"
        role="region"
        aria-label="Item list"
        tabIndex={0}
      >
        <table className="iv__table">
          <caption className="iv__caption">
            {filtered.length} of {items.length} items
          </caption>
          <thead>
            <tr>
              <th scope="col">SKU</th>
              <th scope="col">Name</th>
              <th scope="col">Category</th>
              <th scope="col" className="iv__num">Qty</th>
              <th scope="col" className="iv__num">Reorder</th>
              <th scope="col" className="iv__num">Unit cost</th>
              <th scope="col" className="iv__num">Value</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="iv__sr">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="iv__empty">
                  No items match.
                </td>
              </tr>
            )}
            {filtered.map((i) => {
              const low = isLow(i);
              return (
                <tr key={i.sku} className={low ? 'iv__row--low' : undefined}>
                  <td className="mono">{i.sku}</td>
                  <td>{i.name}</td>
                  <td>{i.category}</td>
                  <td className="iv__num">{i.qty}</td>
                  <td className="iv__num">{i.reorderPoint}</td>
                  <td className="iv__num">{money(i.unitCost)}</td>
                  <td className="iv__num">{money(itemValue(i))}</td>
                  <td>
                    {low ? (
                      <span className="iv__badge iv__badge--low">
                        Low stock
                      </span>
                    ) : (
                      <span className="iv__badge iv__badge--ok">In stock</span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="iv__link"
                      onClick={() => onOpen(i.sku)}
                    >
                      Manage
                      <span className="iv__sr"> {i.name}</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AddItemForm({
  mountNow,
  onDone,
}: {
  mountNow: number;
  onDone: () => void;
}) {
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>(CATEGORIES[0]);
  const [qty, setQty] = useState('0');
  const [reorderPoint, setReorderPoint] = useState('0');
  const [unitCost, setUnitCost] = useState('0');
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = addItem({
      sku,
      name,
      category,
      qty: Number(qty),
      reorderPoint: Number(reorderPoint),
      unitCost: Number(unitCost),
      now: mountNow,
    });
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setError(null);
    onDone();
  }

  return (
    <form className="iv__form" onSubmit={submit} aria-label="Add item">
      <div className="iv__formgrid">
        <label className="iv__field">
          <span className="iv__label">SKU</span>
          <input
            className="iv__input"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            required
          />
        </label>
        <label className="iv__field iv__field--wide">
          <span className="iv__label">Name</span>
          <input
            className="iv__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="iv__field">
          <span className="iv__label">Category</span>
          <select
            className="iv__input"
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="iv__field">
          <span className="iv__label">Qty</span>
          <input
            className="iv__input"
            type="number"
            min={0}
            step={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </label>
        <label className="iv__field">
          <span className="iv__label">Reorder point</span>
          <input
            className="iv__input"
            type="number"
            min={0}
            step={1}
            value={reorderPoint}
            onChange={(e) => setReorderPoint(e.target.value)}
          />
        </label>
        <label className="iv__field">
          <span className="iv__label">Unit cost</span>
          <input
            className="iv__input"
            type="number"
            min={0}
            step={1}
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
          />
        </label>
      </div>
      {error && (
        <p className="iv__error" role="alert">
          {error}
        </p>
      )}
      <div className="demo__controls">
        <button type="submit" className="demo__btn">
          Save item
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={onDone}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------- Item detail + transactions ----------

function DetailView({
  sku,
  mountNow,
  onBack,
}: {
  sku: string | null;
  mountNow: number;
  onBack: () => void;
}) {
  const state = useStore();
  const item = sku ? findItem(sku, state) : undefined;

  if (!item) {
    return (
      <section className="iv__panel glass" aria-label="Item detail">
        <p className="iv__empty">No item selected.</p>
        <button type="button" className="demo__btn" onClick={onBack}>
          Back to items
        </button>
      </section>
    );
  }

  return <DetailBody item={item} mountNow={mountNow} onBack={onBack} />;
}

function DetailBody({
  item,
  mountNow,
  onBack,
}: {
  item: Item;
  mountNow: number;
  onBack: () => void;
}) {
  const state = useStore();
  const [kind, setKind] = useState<TxnKind>('receive');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const history = useMemo(
    () =>
      [...state.transactions]
        .filter((t) => t.sku === item.sku)
        .sort((a, b) => b.seq - a.seq),
    [state.transactions, item.sku],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = moveStock({
      sku: item.sku,
      kind,
      qty: Number(qty),
      reason,
      now: mountNow,
    });
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setError(null);
    setReason('');
    if (kind !== 'adjust') setQty('1');
  }

  const low = isLow(item);

  return (
    <section className="iv__panel glass" aria-label={`Detail for ${item.name}`}>
      <div className="iv__detailhead">
        <button type="button" className="iv__link" onClick={onBack}>
          Back to items
        </button>
        <div className="iv__detailtitle">
          <h4>
            <span className="mono">{item.sku}</span> {item.name}
          </h4>
          <span className="iv__chip">{item.category}</span>
          {low && <span className="iv__badge iv__badge--low">Low stock</span>}
        </div>
      </div>

      <dl className="iv__stats">
        <div>
          <dt>On hand</dt>
          <dd className="iv__big">{item.qty}</dd>
        </div>
        <div>
          <dt>Reorder point</dt>
          <dd>{item.reorderPoint}</dd>
        </div>
        <div>
          <dt>Unit cost</dt>
          <dd>{money(item.unitCost)}</dd>
        </div>
        <div>
          <dt>Line value</dt>
          <dd>{money(itemValue(item))}</dd>
        </div>
      </dl>

      <form className="iv__form" onSubmit={submit} aria-label="Move stock">
        <fieldset className="iv__kinds">
          <legend className="iv__label">Transaction</legend>
          {(['receive', 'issue', 'adjust'] as TxnKind[]).map((k) => (
            <label key={k} className="iv__radio">
              <input
                type="radio"
                name="txn-kind"
                value={k}
                checked={kind === k}
                onChange={() => {
                  setKind(k);
                  setError(null);
                }}
              />
              <span>{KIND_LABEL[k]}</span>
            </label>
          ))}
        </fieldset>
        <div className="iv__formgrid">
          <label className="iv__field">
            <span className="iv__label">
              {kind === 'adjust' ? 'Counted level' : 'Quantity'}
            </span>
            <input
              className="iv__input"
              type="number"
              min={0}
              step={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </label>
          <label className="iv__field iv__field--wide">
            <span className="iv__label">Reason</span>
            <input
              className="iv__input"
              value={reason}
              placeholder={
                kind === 'issue'
                  ? 'e.g. Picked for order'
                  : kind === 'receive'
                    ? 'e.g. PO restock'
                    : 'e.g. Cycle count correction'
              }
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </div>
        {error && (
          <p className="iv__error" role="alert">
            {error}
          </p>
        )}
        <div className="demo__controls">
          <button type="submit" className="demo__btn">
            Apply {KIND_LABEL[kind].toLowerCase()}
          </button>
        </div>
      </form>

      <h5 className="iv__subhead">Movement log</h5>
      <div
        className="iv__tablewrap"
        role="region"
        aria-label="Movement log"
        tabIndex={0}
      >
        <table className="iv__table">
          <thead>
            <tr>
              <th scope="col">Ref</th>
              <th scope="col">Type</th>
              <th scope="col" className="iv__num">Qty</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 && (
              <tr>
                <td colSpan={4} className="iv__empty">
                  No movements yet.
                </td>
              </tr>
            )}
            {history.map((t) => (
              <tr key={t.id}>
                <td className="mono">{t.id}</td>
                <td>
                  <span className={`iv__tx iv__tx--${t.kind}`}>
                    {KIND_LABEL[t.kind]}
                  </span>
                </td>
                <td className="iv__num">{t.qty}</td>
                <td>{t.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------- Dashboard ----------

function DashboardView({ items }: { items: Item[] }) {
  const movements = useStore().transactions;
  const low = useMemo(() => lowStock(items), [items]);
  const value = useMemo(() => totalValue(items), [items]);
  const units = useMemo(() => totalUnits(items), [items]);
  const cats = useMemo(() => categoryTotals(items), [items]);
  const recent = useMemo(() => allMovements(movements).slice(0, 6), [movements]);

  const maxCatValue = cats.reduce((m, c) => Math.max(m, c.value), 0) || 1;

  return (
    <section className="iv__panel glass" aria-label="Dashboard">
      <div className="iv__kpis">
        <article className="iv__kpi">
          <span className="iv__kpi-label">Total inventory value</span>
          <span className="iv__kpi-value">{money(value)}</span>
        </article>
        <article className="iv__kpi">
          <span className="iv__kpi-label">Units on hand</span>
          <span className="iv__kpi-value">{units.toLocaleString('en-US')}</span>
        </article>
        <article className="iv__kpi">
          <span className="iv__kpi-label">Items tracked</span>
          <span className="iv__kpi-value">{items.length}</span>
        </article>
        <article className={`iv__kpi${low.length ? ' iv__kpi--alert' : ''}`}>
          <span className="iv__kpi-label">Low-stock alerts</span>
          <span className="iv__kpi-value">{low.length}</span>
        </article>
      </div>

      <div className="iv__cols">
        <div>
          <h5 className="iv__subhead">Low-stock alerts</h5>
          {low.length === 0 ? (
            <p className="iv__empty">Every item is above its reorder point.</p>
          ) : (
            <ul className="iv__alerts">
              {low.map((r) => (
                <li key={r.sku} className="iv__alert">
                  <span className="mono">{r.sku}</span>
                  <span className="iv__alert-name">{r.name}</span>
                  <span className="iv__alert-qty">
                    {r.qty} / {r.reorderPoint}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h5 className="iv__subhead">Value by category</h5>
          <ul className="iv__bars">
            {cats.map((c) => (
              <li key={c.category} className="iv__bar">
                <div className="iv__bar-top">
                  <span>{c.category}</span>
                  <span className="mono">{money(c.value)}</span>
                </div>
                <div
                  className="iv__bar-track"
                  role="img"
                  aria-label={`${c.category}: ${money(c.value)} across ${c.items} items`}
                >
                  <div
                    className="iv__bar-fill"
                    style={{ width: `${(c.value / maxCatValue) * 100}%` }}
                  />
                </div>
                <span className="iv__bar-sub">
                  {c.items} items, {c.units} units
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <h5 className="iv__subhead">Recent movements</h5>
      {recent.length === 0 ? (
        <p className="iv__empty">No movements recorded yet.</p>
      ) : (
        <ul className="iv__recent">
          {recent.map((t) => (
            <li key={t.id}>
              <span className="mono">{t.id}</span>
              <span className={`iv__tx iv__tx--${t.kind}`}>
                {KIND_LABEL[t.kind]}
              </span>
              <span className="mono">{t.sku}</span>
              <span className="iv__num">{t.qty}</span>
              <span className="iv__recent-reason">{t.reason}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="demo__controls">
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={resetAll}
        >
          Reset to seed data
        </button>
      </div>
    </section>
  );
}
