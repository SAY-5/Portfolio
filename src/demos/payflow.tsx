import { useState } from 'react';
import '../styles/demo.css';
import './payflow.css';
import { act, createPayment, eventsFor, resetAll, useStore } from './payflow/store';
import { reconcile, type CurrencyTotals } from './payflow/reconcile';
import { legalActions } from './payflow/engine';
import { formatMoney, parseMajor } from './payflow/money';
import {
  CURRENCIES,
  type Action,
  type Currency,
  type IntentEvent,
  type IntentStatus,
  type PaymentIntent,
} from './payflow/types';
import { ACTION_LABEL, PIPELINE, pipelineIndex } from './payflow/flow';

// A working payment-orchestration app. A payment intent is created, then driven
// through authorize, capture, refund or void using only the transitions the
// engine permits. Everything persists to localStorage; no server is involved.

const STATUS_LABEL: Record<IntentStatus, string> = {
  created: 'Created',
  authorized: 'Authorized',
  captured: 'Captured',
  partially_refunded: 'Partially refunded',
  refunded: 'Refunded',
  voided: 'Voided',
  failed: 'Failed',
};

function StatusBadge({ status }: { status: IntentStatus }) {
  return (
    <span className={`pf-badge pf-badge--${status}`}>{STATUS_LABEL[status]}</span>
  );
}

function CreateForm({
  onCreate,
}: {
  onCreate: (amount: string, currency: Currency) => string | null;
}) {
  const [amount, setAmount] = useState('49.99');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const err = onCreate(amount, currency);
    setError(err);
    if (!err) setAmount('');
  }

  return (
    <form className="pf-form glass" onSubmit={submit} aria-label="Create payment">
      <h3 className="pf-form__title">New payment</h3>
      <div className="pf-form__row">
        <label className="pf-field">
          <span className="pf-field__label">Amount</span>
          <input
            className="pf-input"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            aria-describedby={error ? 'pf-amount-err' : undefined}
          />
        </label>
        <label className="pf-field">
          <span className="pf-field__label">Currency</span>
          <select
            className="pf-input"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="demo__btn pf-form__submit">
          Create intent
        </button>
      </div>
      {error && (
        <p className="pf-form__error" id="pf-amount-err" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

// The state diagram: the pipeline nodes, with reached ones highlighted and the
// current one marked. Side states (voided, failed) get their own chip.
function StateDiagram({ intent }: { intent: PaymentIntent }) {
  const reached = pipelineIndex(intent.status);
  const side = intent.status === 'voided' || intent.status === 'failed';
  return (
    <div className="pf-diagram" aria-label="Payment lifecycle">
      <ol className="pf-diagram__track">
        {PIPELINE.map((s, i) => {
          const isCurrent = s === intent.status;
          const isReached = !side && i <= reached;
          return (
            <li
              key={s}
              className={
                'pf-node' +
                (isReached ? ' pf-node--reached' : '') +
                (isCurrent ? ' pf-node--current' : '')
              }
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span className="pf-node__dot" aria-hidden="true" />
              <span className="pf-node__label">{STATUS_LABEL[s]}</span>
            </li>
          );
        })}
      </ol>
      {side && (
        <p className={`pf-diagram__side pf-diagram__side--${intent.status}`}>
          Terminal: {STATUS_LABEL[intent.status]}
        </p>
      )}
    </div>
  );
}

function Timeline({ events }: { events: IntentEvent[] }) {
  if (events.length === 0) {
    return <p className="pf-timeline__empty">No events yet.</p>;
  }
  return (
    <ol className="pf-timeline" aria-label="Event timeline">
      {events.map((e) => (
        <li
          key={e.id}
          className={
            'pf-event' +
            (e.ok ? ' pf-event--ok' : ' pf-event--err') +
            (e.replayed ? ' pf-event--replay' : '')
          }
        >
          <span className="pf-event__dot" aria-hidden="true" />
          <span className="pf-event__action mono">
            {e.action}
            {e.replayed ? ' (replay)' : ''}
          </span>
          {typeof e.amount === 'number' && (
            <span className="pf-event__amount mono">{e.amount}</span>
          )}
          <span className="pf-event__reason">
            {e.ok ? (e.reason ?? 'accepted') : (e.reason ?? 'rejected')}
          </span>
        </li>
      ))}
    </ol>
  );
}

// The detail panel for a selected intent: diagram, the legal actions as buttons,
// a decline toggle to exercise the failure + retry path, and the timeline.
function Detail({ intent }: { intent: PaymentIntent }) {
  const [decline, setDecline] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const events = eventsFor(intent.id);
  const legal = legalActions(intent.status);

  // A partial capture/refund uses half the relevant balance so the UI can show
  // captured vs partially_refunded without a second input field.
  function run(action: Action, partial: boolean) {
    let amount: number | undefined;
    if (action === 'capture') {
      amount = partial ? Math.max(1, Math.floor(intent.amount / 2)) : intent.amount;
    } else if (action === 'refund') {
      const refundable = intent.capturedAmount - intent.refundedAmount;
      amount = partial ? Math.max(1, Math.floor(refundable / 2)) : refundable;
    }
    const ev = act(intent.id, action, {
      amount,
      processorMode: action === 'authorize' && decline ? 'decline' : 'approve',
      maxRetries: 2,
    });
    if (ev && !ev.ok) {
      setNote(ev.reason ?? 'Action rejected.');
    } else {
      setNote(null);
    }
  }

  const canAuthorize = legal.includes('authorize');

  return (
    <div className="pf-detail glass" aria-label={`Intent ${intent.id}`}>
      <div className="pf-detail__head">
        <span className="pf-detail__id mono">{intent.id}</span>
        <StatusBadge status={intent.status} />
      </div>

      <dl className="pf-detail__amounts">
        <div>
          <dt>Authorized</dt>
          <dd className="mono">{formatMoney(intent.amount, intent.currency)}</dd>
        </div>
        <div>
          <dt>Captured</dt>
          <dd className="mono">{formatMoney(intent.capturedAmount, intent.currency)}</dd>
        </div>
        <div>
          <dt>Refunded</dt>
          <dd className="mono">{formatMoney(intent.refundedAmount, intent.currency)}</dd>
        </div>
      </dl>

      <StateDiagram intent={intent} />

      {canAuthorize && (
        <label className="pf-toggle">
          <input
            type="checkbox"
            checked={decline}
            onChange={(e) => setDecline(e.target.checked)}
          />
          <span>Simulate processor decline (exercises retry, then fails)</span>
        </label>
      )}

      <div className="pf-actions" role="group" aria-label="Available transitions">
        {legal.length === 0 && (
          <span className="pf-actions__none">No further transitions (terminal).</span>
        )}
        {legal.map((action) => (
          <span key={action} className="pf-actions__group">
            <button className="demo__btn" onClick={() => run(action, false)}>
              {ACTION_LABEL[action]}
            </button>
            {(action === 'capture' || action === 'refund') && (
              <button
                className="demo__btn demo__btn--ghost"
                onClick={() => run(action, true)}
              >
                {ACTION_LABEL[action]} half
              </button>
            )}
          </span>
        ))}
      </div>

      {note && (
        <p className="pf-detail__note" role="alert">
          {note}
        </p>
      )}

      <div className="pf-detail__retries mono">
        declines {intent.declines} · retries {intent.retries}
      </div>

      <h4 className="pf-detail__sub">Event timeline</h4>
      <Timeline events={events} />
    </div>
  );
}

function ReconcileRow({ row }: { row: CurrencyTotals }) {
  return (
    <tr>
      <th scope="row" className="mono">
        {row.currency}
      </th>
      <td className="mono">{formatMoney(row.authorized, row.currency)}</td>
      <td className="mono">{formatMoney(row.captured, row.currency)}</td>
      <td className="mono">{formatMoney(row.refunded, row.currency)}</td>
      <td className="mono pf-recon__net">{formatMoney(row.net, row.currency)}</td>
    </tr>
  );
}

function Reconciliation({ intents }: { intents: PaymentIntent[] }) {
  const r = reconcile(intents);
  return (
    <section className="pf-recon glass" aria-label="Reconciliation">
      <div className="pf-recon__head">
        <h3 className="pf-recon__title">Reconciliation</h3>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => resetAll()}
          aria-label="Clear all payments and the event log"
        >
          Reset all
        </button>
      </div>

      {r.byCurrency.length === 0 ? (
        <p className="pf-recon__empty">Nothing to reconcile yet.</p>
      ) : (
        <table className="pf-recon__table">
          <caption className="pf-sr-only">
            Authorized, captured, refunded and net settled totals per currency.
          </caption>
          <thead>
            <tr>
              <th scope="col">Currency</th>
              <th scope="col">Authorized</th>
              <th scope="col">Captured</th>
              <th scope="col">Refunded</th>
              <th scope="col">Net</th>
            </tr>
          </thead>
          <tbody>
            {r.byCurrency.map((row) => (
              <ReconcileRow key={row.currency} row={row} />
            ))}
          </tbody>
        </table>
      )}

      <dl className="pf-recon__counts">
        <div>
          <dt>Intents</dt>
          <dd className="mono">{r.intentCount}</dd>
        </div>
        <div>
          <dt>Declined</dt>
          <dd className="mono">{r.declined}</dd>
        </div>
        <div>
          <dt>Retried</dt>
          <dd className="mono">{r.retried}</dd>
        </div>
      </dl>
    </section>
  );
}

export default function PayflowDemo() {
  const { intents } = useStore();
  const [selected, setSelected] = useState<string | null>(null);

  function handleCreate(amount: string, currency: Currency): string | null {
    // money.parseMajor is the only float bridge; reject anything it rejects.
    const minor = parseMajor(amount, currency);
    if (minor === null) return 'Enter a positive amount with valid decimals.';
    // The store owns the clock; the component never reads it during render.
    const created = createPayment(minor, currency);
    if (!created) return 'Could not create the payment intent.';
    setSelected(created.id);
    return null;
  }

  const active = intents.find((i) => i.id === selected) ?? null;

  return (
    <div className="demo" aria-label="PayFlow payment orchestration">
      <span className="demo__tag">Interactive app</span>
      <h3 className="demo__title">PayFlow payment orchestration</h3>
      <p className="demo__lede">
        Create a payment intent, then move it through authorize, capture, refund
        and void using only the transitions the state machine allows. Every
        action is recorded to an immutable event log in your browser.
      </p>

      <CreateForm onCreate={handleCreate} />

      <div className="pf-layout">
        <section className="pf-list" aria-label="Payment intents">
          <div className="pf-list__head">
            <h3 className="pf-list__title">Intents</h3>
            <span className="pf-list__count">{intents.length} total</span>
          </div>
          {intents.length === 0 ? (
            <p className="pf-list__empty">No payments yet. Create one above.</p>
          ) : (
            <ul className="pf-list__items">
              {intents.map((it) => (
                <li key={it.id}>
                  <button
                    className={
                      'pf-row glass' + (it.id === selected ? ' pf-row--active' : '')
                    }
                    onClick={() => setSelected(it.id)}
                    aria-pressed={it.id === selected}
                  >
                    <span className="pf-row__id mono">{it.id}</span>
                    <span className="pf-row__amount mono">
                      {formatMoney(it.amount, it.currency)}
                    </span>
                    <StatusBadge status={it.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {active ? (
          <Detail key={active.id} intent={active} />
        ) : (
          <p className="pf-detail__placeholder">Select an intent to act on it.</p>
        )}
      </div>

      <Reconciliation intents={intents} />
    </div>
  );
}
