// Browser-side model of the subscription portal. It persists the customer's
// subscription and invoice history in localStorage and exposes actions to
// change plan, change seats, pause, resume, cancel at period end, and
// reactivate. Every billing action appends an invoice line through the pricing
// engine so the history mirrors what the customer would be charged. Nothing
// here talks to a server.

import {
  PLANS,
  addInterval,
  canTransition,
  clampSeats,
  findPlan,
  planTotalCents,
  prorate,
  seedSubscription,
} from './engine';
import type { Invoice, InvoiceKind, Subscription } from './types';

const SUB_KEY = 'subscription-portal.sub.v1';
const INV_KEY = 'subscription-portal.invoices.v1';

export type State = {
  sub: Subscription;
  invoices: Invoice[];
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

function makeId(prefix: string): string {
  const n = Math.floor(Math.random() * 1_000_000)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0');
  return `${prefix}-${n}`;
}

function freshState(now: number): State {
  const sub = seedSubscription(now);
  const plan = findPlan(sub.planId);
  const signup: Invoice = {
    id: makeId('INV'),
    at: sub.periodStart,
    kind: 'signup',
    description: plan
      ? `${plan.name} subscription started, ${sub.seats} seats`
      : 'Subscription started',
    amountCents: plan ? planTotalCents(plan, sub.seats) : 0,
  };
  return { sub, invoices: [signup] };
}

function loadState(): State {
  const now = Date.now();
  const seeded = freshState(now);
  const sub = readJSON<Subscription | null>(SUB_KEY, null);
  const invoices = readJSON<Invoice[] | null>(INV_KEY, null);
  if (sub && invoices) {
    return { sub, invoices };
  }
  // First visit: persist the seed so reloads are stable.
  writeJSON(SUB_KEY, seeded.sub);
  writeJSON(INV_KEY, seeded.invoices);
  return seeded;
}

// ---------- minimal external store ----------

let state: State = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function commit(next: State): void {
  state = next;
  writeJSON(SUB_KEY, next.sub);
  writeJSON(INV_KEY, next.invoices);
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

function appendInvoice(
  invoices: Invoice[],
  kind: InvoiceKind,
  description: string,
  amountCents: number,
  at: number,
): Invoice[] {
  const line: Invoice = { id: makeId('INV'), at, kind, description, amountCents };
  return [line, ...invoices];
}

// ---------- billing actions ----------

// Change plan and seats together. Seats are clamped to the target plan bounds.
// The prorated net is charged now (or credited) and recorded on the invoice.
export function changePlan(toPlanId: string, toSeats: number): void {
  const now = Date.now();
  const fromPlan = findPlan(state.sub.planId);
  const toPlan = findPlan(toPlanId);
  if (!fromPlan || !toPlan) return;
  if (state.sub.status === 'canceled') return;

  const { seats } = clampSeats(toPlan, toSeats);
  const p = prorate(state.sub, fromPlan, toPlan, seats, now);

  // Switching interval rebases the period so the renewal date matches the new
  // cadence; same-interval changes keep the running cycle.
  let periodStart = state.sub.periodStart;
  let periodEnd = state.sub.periodEnd;
  if (toPlan.interval !== fromPlan.interval) {
    periodStart = now;
    periodEnd = addInterval(now, toPlan.interval);
  }

  const sub: Subscription = {
    ...state.sub,
    planId: toPlan.id,
    seats,
    periodStart,
    periodEnd,
    // A plan change on a pending cancellation keeps the schedule; on a paused
    // plan it stays paused until resumed.
  };

  const desc = `Switched to ${toPlan.name}, ${seats} seats`;
  const invoices = appendInvoice(state.invoices, 'plan_change', desc, p.amountCents, now);
  commit({ sub, invoices });
}

// Change only the seat count on the current plan, repricing the remaining days.
export function changeSeats(toSeats: number): void {
  const now = Date.now();
  const plan = findPlan(state.sub.planId);
  if (!plan) return;
  if (state.sub.status === 'canceled') return;

  const { seats } = clampSeats(plan, toSeats);
  if (seats === state.sub.seats) return;

  const p = prorate(state.sub, plan, plan, seats, now);
  const sub: Subscription = { ...state.sub, seats };
  const delta = seats - state.sub.seats;
  const verb = delta > 0 ? 'Added' : 'Removed';
  const desc = `${verb} ${Math.abs(delta)} seat${Math.abs(delta) === 1 ? '' : 's'} (now ${seats})`;
  const invoices = appendInvoice(state.invoices, 'seat_change', desc, p.amountCents, now);
  commit({ sub, invoices });
}

export function pause(): void {
  if (canTransition(state.sub.status, 'paused')) return;
  const now = Date.now();
  const sub: Subscription = { ...state.sub, status: 'paused', cancelAt: null };
  const invoices = appendInvoice(
    state.invoices,
    'pause',
    'Subscription paused, billing suspended',
    0,
    now,
  );
  commit({ sub, invoices });
}

// Resume a paused subscription, starting a fresh billing period from now.
export function resume(): void {
  if (canTransition(state.sub.status, 'active')) return;
  const now = Date.now();
  const plan = findPlan(state.sub.planId);
  if (!plan) return;
  const periodEnd = addInterval(now, plan.interval);
  const sub: Subscription = {
    ...state.sub,
    status: 'active',
    periodStart: now,
    periodEnd,
    cancelAt: null,
  };
  const invoices = appendInvoice(
    state.invoices,
    'resume',
    'Subscription resumed, billing restarted',
    planTotalCents(plan, state.sub.seats),
    now,
  );
  commit({ sub, invoices });
}

// Schedule cancellation for the end of the current period. The subscription
// stays usable until then.
export function cancelAtPeriodEnd(): void {
  if (canTransition(state.sub.status, 'pending_cancel')) return;
  const now = Date.now();
  const sub: Subscription = {
    ...state.sub,
    status: 'pending_cancel',
    cancelAt: state.sub.periodEnd,
  };
  const invoices = appendInvoice(
    state.invoices,
    'cancel',
    'Cancellation scheduled for period end',
    0,
    now,
  );
  commit({ sub, invoices });
}

// Reactivate either a pending cancellation (clears the schedule, stays active)
// or a fully canceled subscription (starts a fresh period).
export function reactivate(): void {
  if (canTransition(state.sub.status, 'active')) return;
  const now = Date.now();
  const plan = findPlan(state.sub.planId);
  if (!plan) return;

  if (state.sub.status === 'pending_cancel') {
    const sub: Subscription = { ...state.sub, status: 'active', cancelAt: null };
    const invoices = appendInvoice(
      state.invoices,
      'reactivate',
      'Cancellation reverted, subscription continues',
      0,
      now,
    );
    commit({ sub, invoices });
    return;
  }

  // From canceled: start a fresh period and charge the first cycle.
  const periodEnd = addInterval(now, plan.interval);
  const sub: Subscription = {
    ...state.sub,
    status: 'active',
    periodStart: now,
    periodEnd,
    cancelAt: null,
  };
  const invoices = appendInvoice(
    state.invoices,
    'reactivate',
    `${plan.name} reactivated, ${state.sub.seats} seats`,
    planTotalCents(plan, state.sub.seats),
    now,
  );
  commit({ sub, invoices });
}

// Wipe persisted subscription and invoices and reseed.
export function resetAll(): void {
  try {
    localStorage.removeItem(SUB_KEY);
    localStorage.removeItem(INV_KEY);
  } catch {
    // ignore storage errors
  }
  commit(freshState(Date.now()));
}

export { PLANS, findPlan };
