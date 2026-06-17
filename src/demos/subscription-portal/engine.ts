// Pure pricing and lifecycle engine for the subscription portal. No eval, no
// network: every function takes plain values and returns plain values, so the
// store can call them and the UI can preview a change before committing it.

import type {
  Interval,
  Plan,
  Proration,
  Status,
  Subscription,
} from './types';

export const CURRENCY = 'USD';

const DAY_MS = 24 * 60 * 60 * 1000;

// Plan catalog. Prices are per seat, per interval, in whole cents. The yearly
// tier is priced below twelve monthly charges to model an annual discount.
export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    blurb: 'For individuals getting set up',
    priceCents: 900,
    interval: 'month',
    minSeats: 1,
    maxSeats: 3,
    features: [
      'Up to 3 seats',
      '5 GB storage',
      'Community support',
      'Single project',
    ],
  },
  {
    id: 'team',
    name: 'Team',
    blurb: 'For small teams shipping together',
    priceCents: 2400,
    interval: 'month',
    minSeats: 2,
    maxSeats: 25,
    features: [
      'Up to 25 seats',
      '100 GB storage',
      'Priority email support',
      'Unlimited projects',
      'Usage analytics',
    ],
  },
  {
    id: 'business',
    name: 'Business',
    blurb: 'For scaling organizations',
    priceCents: 4900,
    interval: 'month',
    minSeats: 5,
    maxSeats: 200,
    features: [
      'Up to 200 seats',
      '1 TB storage',
      'Priority support with SLA',
      'Unlimited projects',
      'Usage analytics',
      'SSO and audit log',
    ],
  },
  {
    id: 'team-annual',
    name: 'Team Annual',
    blurb: 'Team plan billed yearly, two months off',
    priceCents: 24000,
    interval: 'year',
    minSeats: 2,
    maxSeats: 25,
    features: [
      'Up to 25 seats',
      '100 GB storage',
      'Priority email support',
      'Unlimited projects',
      'Usage analytics',
      'Two months free vs monthly',
    ],
  },
];

export function findPlan(planId: string): Plan | undefined {
  return PLANS.find((p) => p.id === planId);
}

export function intervalDays(interval: Interval): number {
  return interval === 'year' ? 365 : 30;
}

// Whole-cent currency formatting. Amounts are stored in cents; this is the only
// place that divides by 100 for display.
export function money(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function planTotalCents(plan: Plan, seats: number): number {
  return plan.priceCents * seats;
}

// Whole days left in the current period as of `now`, clamped to the period
// length so a change on the first day prorates against the full cycle and a
// change after the period end prorates against zero.
export function daysRemaining(sub: Subscription, now: number): number {
  const total = sub.periodEnd - sub.periodStart;
  const left = sub.periodEnd - now;
  const clamped = Math.max(0, Math.min(total, left));
  return Math.round(clamped / DAY_MS);
}

export function periodDays(sub: Subscription): number {
  return Math.round((sub.periodEnd - sub.periodStart) / DAY_MS);
}

// Proration for moving from the current plan and seat count to a target plan
// and seat count, mid cycle. We reclaim the unused value of the current plan
// for the days remaining (a credit) and charge the new plan for those same
// days. The net is what the customer pays now (positive) or banks as credit
// (negative). Both sides use the current period window so switching between a
// monthly and yearly tier still prorates against the running cycle.
export function prorate(
  sub: Subscription,
  fromPlan: Plan,
  toPlan: Plan,
  toSeats: number,
  now: number,
): Proration {
  const periodTotal = periodDays(sub);
  const remaining = daysRemaining(sub, now);
  const ratio = periodTotal === 0 ? 0 : remaining / periodTotal;

  const currentTotal = planTotalCents(fromPlan, sub.seats);
  const nextTotal = planTotalCents(toPlan, toSeats);

  const creditCents = Math.round(currentTotal * ratio);
  const chargeCents = Math.round(nextTotal * ratio);

  return {
    amountCents: chargeCents - creditCents,
    creditCents,
    chargeCents,
    daysRemaining: remaining,
    daysInPeriod: periodTotal,
  };
}

// Validate a seat count against a plan's bounds, returning a clamped value plus
// a reason when it had to be adjusted, so the UI can explain the limit.
export function clampSeats(
  plan: Plan,
  seats: number,
): { seats: number; reason: string | null } {
  if (seats < plan.minSeats) {
    return { seats: plan.minSeats, reason: `Minimum ${plan.minSeats} seats` };
  }
  if (seats > plan.maxSeats) {
    return { seats: plan.maxSeats, reason: `Maximum ${plan.maxSeats} seats` };
  }
  return { seats, reason: null };
}

// Lifecycle transition guard. Returns null when the transition is allowed, or a
// human reason when it is not, so the store can reject invalid moves and the UI
// can disable the control.
export function canTransition(from: Status, to: Status): string | null {
  const allowed: Record<Status, Status[]> = {
    active: ['paused', 'pending_cancel', 'canceled'],
    paused: ['active', 'canceled'],
    pending_cancel: ['active', 'canceled'],
    canceled: ['active'],
  };
  if (from === to) return 'Already in that state';
  if (!allowed[from].includes(to)) {
    return `Cannot move from ${from} to ${to}`;
  }
  return null;
}

export function addInterval(at: number, interval: Interval): number {
  return at + intervalDays(interval) * DAY_MS;
}

// Build a fresh subscription seeded mid cycle so the proration preview shows a
// realistic partial-period credit and charge on first load.
export function seedSubscription(now: number): Subscription {
  const plan = findPlan('team') as Plan;
  const periodStart = now - 12 * DAY_MS;
  const periodEnd = addInterval(periodStart, plan.interval);
  return {
    planId: plan.id,
    seats: 4,
    status: 'active',
    periodStart,
    periodEnd,
    cancelAt: null,
  };
}
