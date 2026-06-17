import { useState } from 'react';
import '../styles/demo.css';
import './payscope.css';
import {
  useStore,
  addMeter,
  removeMeter,
  addPlan,
  removePlan,
  addEvent,
  createInvoice,
  resetAll,
} from './payscope/store';
import type { PlanMeter } from './payscope/types';

type Tab = 'setup' | 'usage' | 'invoices';

export default function PayscopeDemo() {
  const [tab, setTab] = useState<Tab>('setup');

  return (
    <div className="demo" aria-label="PayScope usage metering and invoicing demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Usage metering and invoicing</h3>
      <p className="demo__lede">
        Define meters to track consumption, create plans with included quotas
        and overage rates, record usage events, then generate detailed invoices
        with line-item overage calculations. All data persists in localStorage.
      </p>

      <nav className="ps__tabs" aria-label="sections">
        {(['setup', 'usage', 'invoices'] as const).map((t) => (
          <button
            key={t}
            className={`ps__tab ${tab === t ? 'ps__tab--on' : ''}`}
            onClick={() => setTab(t)}
            aria-current={tab === t ? 'page' : undefined}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'setup' && <SetupPanel />}
      {tab === 'usage' && <UsagePanel />}
      {tab === 'invoices' && <InvoicePanel />}

      <div className="demo__controls">
        <button className="demo__btn demo__btn--ghost" onClick={resetAll}>
          Reset all data
        </button>
      </div>
    </div>
  );
}

function UsagePanel() {
  const store = useStore();
  const [meterId, setMeterId] = useState(store.meters[0]?.id ?? '');
  const [qty, setQty] = useState('1');
  const [lastDup, setLastDup] = useState(false);

  const meterMap = new Map(store.meters.map((m) => [m.id, m]));

  function freshKey(): string {
    return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  const [idempKey, setIdempKey] = useState(freshKey);

  function handleRecord() {
    const q = parseFloat(qty);
    if (!meterId || isNaN(q) || q <= 0) return;
    const added = addEvent(meterId, q, idempKey);
    setLastDup(!added);
    if (added) {
      setIdempKey(freshKey());
      setQty('1');
    }
  }

  function handleReplay() {
    if (!meterId) return;
    const q = parseFloat(qty);
    if (isNaN(q) || q <= 0) return;
    const added = addEvent(meterId, q, idempKey);
    setLastDup(!added);
  }

  return (
    <section className="ps__stage" aria-label="usage recording">
      {store.meters.length === 0 ? (
        <p className="ps__empty">
          No meters defined. Go to the setup tab to create meters first.
        </p>
      ) : (
        <fieldset className="ps__fieldset glass">
          <legend className="ps__legend">Record event</legend>
          <div className="ps__form-row">
            <label className="ps__field">
              <span className="ps__field-label">Meter</span>
              <select
                className="ps__select"
                value={meterId}
                onChange={(e) => setMeterId(e.target.value)}
              >
                {store.meters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.unit})
                  </option>
                ))}
              </select>
            </label>
            <label className="ps__field">
              <span className="ps__field-label">Quantity</span>
              <input
                className="ps__input"
                type="number"
                min="0"
                step="1"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </label>
            <label className="ps__field">
              <span className="ps__field-label">Idempotency key</span>
              <input
                className="ps__input"
                type="text"
                value={idempKey}
                onChange={(e) => setIdempKey(e.target.value)}
                aria-describedby="idemp-hint"
              />
            </label>
          </div>
          <p id="idemp-hint" className="ps__empty" style={{ padding: 0, marginTop: -6 }}>
            Replaying the same key is a no-op (duplicate detection).
          </p>
          <div className="demo__controls" style={{ marginTop: 0 }}>
            <button className="demo__btn" onClick={handleRecord}>
              Record event
            </button>
            <button className="demo__btn demo__btn--ghost" onClick={handleReplay}>
              Replay same key
            </button>
            {lastDup && <span className="ps__event-dup">duplicate, no-op</span>}
          </div>
        </fieldset>
      )}

      <EventLog events={store.events} meterMap={meterMap} />
    </section>
  );
}

function EventLog({
  events,
  meterMap,
}: {
  events: ReturnType<typeof useStore>['events'];
  meterMap: Map<string, ReturnType<typeof useStore>['meters'][number]>;
}) {
  if (events.length === 0) {
    return <p className="ps__empty">No events recorded yet.</p>;
  }

  const sorted = [...events].reverse();

  return (
    <div className="ps__event-log" role="log" aria-label="event log">
      {sorted.map((ev) => {
        const m = meterMap.get(ev.meterId);
        return (
          <div key={ev.id} className="ps__event-row">
            <span className="ps__event-meter">{m?.name ?? ev.meterId}</span>
            <span className="ps__event-qty">
              +{ev.quantity} {m?.unit ?? ''}
            </span>
            <span className="ps__event-time">
              {new Date(ev.timestamp).toLocaleTimeString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function InvoicePanel() {
  const store = useStore();
  const [planId, setPlanId] = useState(store.plans[0]?.id ?? '');

  // Default period: current day start to end
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayEnd = dayStart + 86400000 - 1;
  const [periodStart, setPeriodStart] = useState(dayStart);
  const [periodEnd, setPeriodEnd] = useState(dayEnd);

  function handleGenerate() {
    if (!planId) return;
    createInvoice(planId, periodStart, periodEnd);
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString();
  }

  return (
    <section className="ps__stage" aria-label="invoices">
      {store.plans.length === 0 ? (
        <p className="ps__empty">
          No plans defined. Go to the setup tab to create plans first.
        </p>
      ) : (
        <fieldset className="ps__fieldset glass">
          <legend className="ps__legend">Generate invoice</legend>
          <div className="ps__period-row">
            <label className="ps__field">
              <span className="ps__field-label">Plan</span>
              <select
                className="ps__select"
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
              >
                {store.plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ps__field">
              <span className="ps__field-label">Period start</span>
              <input
                className="ps__input"
                type="date"
                value={new Date(periodStart).toISOString().split('T')[0]}
                onChange={(e) => setPeriodStart(new Date(e.target.value).getTime())}
              />
            </label>
            <label className="ps__field">
              <span className="ps__field-label">Period end</span>
              <input
                className="ps__input"
                type="date"
                value={new Date(periodEnd).toISOString().split('T')[0]}
                onChange={(e) =>
                  setPeriodEnd(new Date(e.target.value).getTime() + 86400000 - 1)
                }
              />
            </label>
          </div>
          <button className="demo__btn" onClick={handleGenerate}>
            Generate invoice
          </button>
        </fieldset>
      )}

      {store.invoices.length > 0 && (
        <div className="ps__invoices-list" aria-label="generated invoices">
          {[...store.invoices].reverse().map((inv) => (
            <article key={inv.id} className="ps__invoice glass">
              <div className="ps__invoice-head">
                <span className="ps__invoice-id">{inv.id}</span>
                <span className="ps__invoice-plan">
                  {inv.planName} | {formatDate(inv.periodStart)} to {formatDate(inv.periodEnd)}
                </span>
              </div>
              <table className="ps__invoice-table" aria-label={`Invoice ${inv.id} details`}>
                <thead>
                  <tr>
                    <th scope="col">Meter</th>
                    <th scope="col">Usage</th>
                    <th scope="col">Included</th>
                    <th scope="col">Overage</th>
                    <th scope="col">Rate</th>
                    <th scope="col" className="ps__td-right">Charge</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lineItems.map((li, i) => (
                    <tr key={i}>
                      <td>{li.meterName}</td>
                      <td>
                        {li.totalUsage} {li.meterUnit}
                      </td>
                      <td>{li.includedQuota}</td>
                      <td>{li.overageUsage}</td>
                      <td>${li.overageRate}</td>
                      <td className="ps__td-right">${li.charge.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ps__invoice-total">
                <span className="ps__invoice-total-label">subtotal</span>
                <span className="ps__invoice-total-val">${inv.subtotal.toFixed(2)}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SetupPanel() {
  const store = useStore();
  return (
    <section className="ps__stage" aria-label="setup">
      <MeterForm />
      <MeterList meters={store.meters} />
      <PlanForm meters={store.meters} />
      <PlanList plans={store.plans} meters={store.meters} />
    </section>
  );
}

function MeterForm() {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [rate, setRate] = useState('');

  function handleAdd() {
    const n = name.trim();
    const u = unit.trim();
    const r = parseFloat(rate);
    if (!n || !u || isNaN(r) || r < 0) return;
    addMeter(n, u, r);
    setName('');
    setUnit('');
    setRate('');
  }

  return (
    <fieldset className="ps__fieldset glass">
      <legend className="ps__legend">New meter</legend>
      <div className="ps__form-row">
        <label className="ps__field">
          <span className="ps__field-label">Name</span>
          <input
            className="ps__input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="API calls"
          />
        </label>
        <label className="ps__field">
          <span className="ps__field-label">Unit</span>
          <input
            className="ps__input"
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="requests"
          />
        </label>
        <label className="ps__field">
          <span className="ps__field-label">Rate per unit ($)</span>
          <input
            className="ps__input"
            type="number"
            min="0"
            step="0.001"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="0.002"
          />
        </label>
      </div>
      <button className="demo__btn" onClick={handleAdd} disabled={!name.trim()}>
        Add meter
      </button>
    </fieldset>
  );
}

function MeterList({ meters }: { meters: ReturnType<typeof useStore>['meters'] }) {
  if (meters.length === 0) {
    return <p className="ps__empty">No meters defined yet.</p>;
  }
  return (
    <div className="ps__list" role="list" aria-label="defined meters">
      {meters.map((m) => (
        <div key={m.id} className="ps__list-item" role="listitem">
          <div className="ps__list-main">
            <span className="ps__list-name">{m.name}</span>
            <span className="ps__list-meta">
              {m.unit} at ${m.ratePerUnit}/unit
            </span>
          </div>
          <button
            className="ps__remove"
            onClick={() => removeMeter(m.id)}
            aria-label={`remove ${m.name}`}
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}

function PlanForm({ meters }: { meters: ReturnType<typeof useStore>['meters'] }) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<
    Record<string, { included: string; overage: string }>
  >({});

  function toggleMeter(meterId: string) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[meterId]) {
        delete next[meterId];
      } else {
        next[meterId] = { included: '0', overage: '0' };
      }
      return next;
    });
  }

  function updateSelected(meterId: string, field: 'included' | 'overage', value: string) {
    setSelected((prev) => ({
      ...prev,
      [meterId]: { ...prev[meterId], [field]: value },
    }));
  }

  function handleAdd() {
    const n = name.trim();
    if (!n) return;
    const planMeters: PlanMeter[] = [];
    for (const [meterId, cfg] of Object.entries(selected)) {
      const included = parseFloat(cfg.included);
      const overage = parseFloat(cfg.overage);
      if (isNaN(included) || isNaN(overage)) continue;
      planMeters.push({
        meterId,
        includedQuota: Math.max(0, included),
        overageRate: Math.max(0, overage),
      });
    }
    if (planMeters.length === 0) return;
    addPlan(n, planMeters);
    setName('');
    setSelected({});
  }

  return (
    <fieldset className="ps__fieldset glass">
      <legend className="ps__legend">New plan</legend>
      <label className="ps__field">
        <span className="ps__field-label">Plan name</span>
        <input
          className="ps__input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Starter"
        />
      </label>

      {meters.length === 0 && (
        <p className="ps__empty">Add meters first to attach them to a plan.</p>
      )}

      {meters.length > 0 && (
        <div className="ps__meter-picks" role="group" aria-label="attach meters">
          {meters.map((m) => {
            const active = !!selected[m.id];
            return (
              <div key={m.id} className={`ps__meter-pick ${active ? 'ps__meter-pick--on' : ''}`}>
                <button
                  className="ps__meter-pick-toggle"
                  onClick={() => toggleMeter(m.id)}
                  aria-pressed={active}
                >
                  {m.name} ({m.unit})
                </button>
                {active && (
                  <div className="ps__meter-pick-fields">
                    <label className="ps__field ps__field--sm">
                      <span className="ps__field-label">Included</span>
                      <input
                        className="ps__input ps__input--sm"
                        type="number"
                        min="0"
                        value={selected[m.id].included}
                        onChange={(e) => updateSelected(m.id, 'included', e.target.value)}
                      />
                    </label>
                    <label className="ps__field ps__field--sm">
                      <span className="ps__field-label">Overage rate ($)</span>
                      <input
                        className="ps__input ps__input--sm"
                        type="number"
                        min="0"
                        step="0.001"
                        value={selected[m.id].overage}
                        onChange={(e) => updateSelected(m.id, 'overage', e.target.value)}
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button className="demo__btn" onClick={handleAdd} disabled={!name.trim()}>
        Create plan
      </button>
    </fieldset>
  );
}

function PlanList({
  plans,
  meters,
}: {
  plans: ReturnType<typeof useStore>['plans'];
  meters: ReturnType<typeof useStore>['meters'];
}) {
  const meterMap = new Map(meters.map((m) => [m.id, m]));
  if (plans.length === 0) {
    return <p className="ps__empty">No plans defined yet.</p>;
  }
  return (
    <div className="ps__list" role="list" aria-label="defined plans">
      {plans.map((p) => (
        <div key={p.id} className="ps__list-item ps__list-item--plan" role="listitem">
          <div className="ps__list-main">
            <span className="ps__list-name">{p.name}</span>
            <span className="ps__list-meta">
              {p.meters.length} meter{p.meters.length === 1 ? '' : 's'}
            </span>
            <div className="ps__plan-meters">
              {p.meters.map((pm) => {
                const m = meterMap.get(pm.meterId);
                return (
                  <span key={pm.meterId} className="ps__plan-meter-chip">
                    {m?.name ?? pm.meterId}: {pm.includedQuota} free, ${pm.overageRate}/overage
                  </span>
                );
              })}
            </div>
          </div>
          <button
            className="ps__remove"
            onClick={() => removePlan(p.id)}
            aria-label={`remove plan ${p.name}`}
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}
