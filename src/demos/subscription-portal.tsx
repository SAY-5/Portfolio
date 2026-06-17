import { useMemo, useState } from 'react';
import '../styles/demo.css';
import './subscription-portal.css';
import { useStore } from './subscription-portal/state';
import {
  PLANS,
  cancelAtPeriodEnd,
  changePlan,
  changeSeats,
  findPlan,
  pause,
  reactivate,
  resetAll,
  resume,
} from './subscription-portal/store';
import {
  clampSeats,
  money,
  planTotalCents,
  prorate,
} from './subscription-portal/engine';
import { formatDate, statusLabel } from './subscription-portal/format';
import type { Invoice, Subscription } from './subscription-portal/types';

const KIND_LABEL: Record<Invoice['kind'], string> = {
  signup: 'Signup',
  plan_change: 'Plan change',
  seat_change: 'Seat change',
  renewal: 'Renewal',
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Cancel',
  reactivate: 'Reactivate',
};

function Amount({ cents }: { cents: number }) {
  if (cents === 0) {
    return <span className="sp-amt sp-amt--zero">included</span>;
  }
  const credit = cents < 0;
  return (
    <span className={`sp-amt ${credit ? 'sp-amt--credit' : 'sp-amt--charge'}`}>
      {credit ? '-' : '+'}
      {money(Math.abs(cents))}
    </span>
  );
}

function PlanManagement({ sub }: { sub: Subscription }) {
  const current = findPlan(sub.planId);
  const [draftPlanId, setDraftPlanId] = useState(sub.planId);
  const [draftSeats, setDraftSeats] = useState(sub.seats);
  // A render-time snapshot of the clock so the preview proration is stable
  // across re-renders; the committed action re-reads the real clock.
  const [now] = useState(() => Date.now());

  const draftPlan = findPlan(draftPlanId);
  const seatClamp = draftPlan
    ? clampSeats(draftPlan, draftSeats)
    : { seats: draftSeats, reason: null };
  const effectiveSeats = seatClamp.seats;

  const preview = useMemo(() => {
    if (!current || !draftPlan) return null;
    return prorate(sub, current, draftPlan, effectiveSeats, now);
  }, [current, draftPlan, sub, effectiveSeats, now]);

  const unchanged =
    draftPlanId === sub.planId && effectiveSeats === sub.seats;
  const disabled = sub.status === 'canceled';

  function confirm() {
    if (unchanged || disabled) return;
    // Seats-only change keeps the running cycle through the seat path; a tier
    // change rebases the period through the plan path.
    if (draftPlanId === sub.planId) {
      changeSeats(effectiveSeats);
    } else {
      changePlan(draftPlanId, effectiveSeats);
    }
  }

  function applySeats(next: number) {
    setDraftSeats(next);
  }

  // Seat stepper bounds follow the drafted plan.
  const min = draftPlan ? draftPlan.minSeats : 1;
  const max = draftPlan ? draftPlan.maxSeats : 99;

  return (
    <section className="sp-section" aria-labelledby="sp-plans-h">
      <h4 id="sp-plans-h" className="sp-section__title">
        Change plan
      </h4>

      <div className="sp-grid" role="radiogroup" aria-label="available plans">
        {PLANS.map((p) => {
          const selected = p.id === draftPlanId;
          const isCurrent = p.id === sub.planId;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`glass sp-plan${selected ? ' sp-plan--on' : ''}`}
              onClick={() => {
                setDraftPlanId(p.id);
                setDraftSeats(clampSeats(p, draftSeats).seats);
              }}
              disabled={disabled}
            >
              <div className="sp-plan__head">
                <span className="sp-plan__name">{p.name}</span>
                {isCurrent ? (
                  <span className="sp-plan__current">Current</span>
                ) : null}
              </div>
              <div className="sp-plan__price">
                <strong>{money(p.priceCents)}</strong>
                <span>/ seat / {p.interval}</span>
              </div>
              <p className="sp-plan__blurb">{p.blurb}</p>
              <ul className="sp-plan__features">
                {p.features.slice(0, 4).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <div className="glass sp-reprice">
        <div className="sp-stepper" aria-label="seat count">
          <span className="sp-stepper__label">Seats</span>
          <div className="sp-stepper__ctrl">
            <button
              type="button"
              className="sp-stepper__btn"
              aria-label="remove a seat"
              onClick={() => applySeats(effectiveSeats - 1)}
              disabled={disabled || effectiveSeats <= min}
            >
              -
            </button>
            <output className="sp-stepper__val" aria-live="polite">
              {effectiveSeats}
            </output>
            <button
              type="button"
              className="sp-stepper__btn"
              aria-label="add a seat"
              onClick={() => applySeats(effectiveSeats + 1)}
              disabled={disabled || effectiveSeats >= max}
            >
              +
            </button>
          </div>
          {seatClamp.reason ? (
            <span className="sp-stepper__note">{seatClamp.reason}</span>
          ) : null}
        </div>

        <div className="sp-preview" aria-live="polite">
          {preview && draftPlan ? (
            <>
              <div className="sp-preview__row">
                <span>New total</span>
                <span className="sp-preview__v">
                  {money(planTotalCents(draftPlan, effectiveSeats))} /{' '}
                  {draftPlan.interval}
                </span>
              </div>
              <div className="sp-preview__row sp-preview__row--muted">
                <span>
                  Credit for {preview.daysRemaining} of {preview.daysInPeriod}{' '}
                  days
                </span>
                <span className="sp-preview__v">
                  -{money(preview.creditCents)}
                </span>
              </div>
              <div className="sp-preview__row sp-preview__row--muted">
                <span>Charge for remaining days</span>
                <span className="sp-preview__v">
                  +{money(preview.chargeCents)}
                </span>
              </div>
              <div className="sp-preview__row sp-preview__row--total">
                <span>
                  {preview.amountCents >= 0 ? 'Due now' : 'Account credit'}
                </span>
                <span
                  className={`sp-preview__v ${
                    preview.amountCents < 0 ? 'sp-amt--credit' : ''
                  }`}
                >
                  {preview.amountCents < 0 ? '-' : ''}
                  {money(Math.abs(preview.amountCents))}
                </span>
              </div>
            </>
          ) : null}
          <button
            type="button"
            className="demo__btn sp-confirm"
            onClick={confirm}
            disabled={unchanged || disabled}
          >
            {unchanged ? 'No change' : 'Confirm change'}
          </button>
        </div>
      </div>
    </section>
  );
}

function Lifecycle({ sub }: { sub: Subscription }) {
  const { status } = sub;

  return (
    <section className="sp-section" aria-labelledby="sp-life-h">
      <h4 id="sp-life-h" className="sp-section__title">
        Lifecycle
      </h4>

      <div className="glass sp-life">
        <div className="sp-life__state">
          <span className="sp-life__label">Status</span>
          <span className={`sp-status sp-status--${status}`}>
            {statusLabel(status)}
          </span>
          {status === 'pending_cancel' && sub.cancelAt ? (
            <span className="sp-life__effective">
              Ends {formatDate(sub.cancelAt)}
            </span>
          ) : null}
        </div>

        <div className="sp-life__actions" role="group" aria-label="lifecycle actions">
          {status === 'active' ? (
            <button
              type="button"
              className="demo__btn demo__btn--ghost"
              onClick={pause}
            >
              Pause subscription
            </button>
          ) : null}

          {status === 'paused' ? (
            <button type="button" className="demo__btn" onClick={resume}>
              Resume subscription
            </button>
          ) : null}

          {status === 'active' ? (
            <button
              type="button"
              className="demo__btn demo__btn--ghost"
              onClick={cancelAtPeriodEnd}
            >
              Cancel at period end
            </button>
          ) : null}

          {status === 'pending_cancel' ? (
            <button type="button" className="demo__btn" onClick={reactivate}>
              Keep subscription
            </button>
          ) : null}

          {status === 'canceled' ? (
            <button type="button" className="demo__btn" onClick={reactivate}>
              Reactivate subscription
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default function SubscriptionPortalDemo() {
  const { sub, invoices } = useStore();
  const plan = findPlan(sub.planId);

  return (
    <div className="demo" aria-label="subscription self-service portal">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Manage your subscription</h3>
      <p className="demo__lede">
        View your current plan, change tier or seats and preview the prorated
        amount, and pause, cancel, or reactivate. Every action posts an invoice
        line and persists in your browser.
      </p>

      <section className="sp-section" aria-labelledby="sp-overview-h">
        <h4 id="sp-overview-h" className="sp-section__title">
          Overview
        </h4>
        <div className="sp-overview">
          <article className="glass sp-card" aria-label="current plan">
            <div className="sp-card__head">
              <div>
                <span className="sp-card__eyebrow">Current plan</span>
                <h5 className="sp-card__plan">{plan ? plan.name : 'Unknown'}</h5>
              </div>
              <span className={`sp-status sp-status--${sub.status}`}>
                {statusLabel(sub.status)}
              </span>
            </div>

            <dl className="sp-meta">
              <div className="sp-meta__row">
                <dt>Price</dt>
                <dd>
                  {plan
                    ? `${money(planTotalCents(plan, sub.seats))} / ${plan.interval}`
                    : '-'}
                </dd>
              </div>
              <div className="sp-meta__row">
                <dt>Seats</dt>
                <dd>{sub.seats}</dd>
              </div>
              <div className="sp-meta__row">
                <dt>{sub.status === 'pending_cancel' ? 'Ends' : 'Renews'}</dt>
                <dd>
                  {sub.status === 'paused'
                    ? 'Paused'
                    : sub.status === 'canceled'
                      ? 'Ended'
                      : formatDate(sub.periodEnd)}
                </dd>
              </div>
              {plan ? (
                <div className="sp-meta__row">
                  <dt>Per seat</dt>
                  <dd>
                    {money(plan.priceCents)} / {plan.interval}
                  </dd>
                </div>
              ) : null}
            </dl>

            {plan ? (
              <ul className="sp-features" aria-label="plan features">
                {plan.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : null}
          </article>

          <article className="glass sp-card" aria-label="invoice history">
            <div className="sp-card__head">
              <span className="sp-card__eyebrow">Invoice history</span>
            </div>
            <ul className="sp-invoices">
              {invoices.map((inv) => (
                <li key={inv.id} className="sp-invoice">
                  <div className="sp-invoice__main">
                    <span className={`sp-tagk sp-tagk--${inv.kind}`}>
                      {KIND_LABEL[inv.kind]}
                    </span>
                    <span className="sp-invoice__desc">{inv.description}</span>
                  </div>
                  <div className="sp-invoice__side">
                    <Amount cents={inv.amountCents} />
                    <time
                      className="sp-invoice__date"
                      dateTime={new Date(inv.at).toISOString()}
                    >
                      {formatDate(inv.at)}
                    </time>
                  </div>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      <PlanManagement sub={sub} />

      <Lifecycle sub={sub} />

      <div className="demo__controls">
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={resetAll}
        >
          Reset portal
        </button>
        <span className="demo__hint">
          Clears the subscription and invoices saved in your browser.
        </span>
      </div>
    </div>
  );
}
