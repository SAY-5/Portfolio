// Domain types for the in-browser subscription self-service portal. A customer
// owns one subscription against a plan catalog. They can change tier, change
// seat count, and move the subscription through its lifecycle (active, paused,
// pending cancellation, canceled). Each billing action appends an invoice line
// so the history reflects prorated charges and credits over time.

// Billing cadence for a plan. Monthly and yearly are priced independently in
// the catalog rather than derived, so a yearly tier can carry its own discount.
export type Interval = 'month' | 'year';

// Lifecycle status of the subscription.
//  - active: billing normally, renews on the renewal date
//  - paused: billing suspended, no renewal until resumed
//  - pending_cancel: stays active until the period end, then ends
//  - canceled: ended, no further billing
export type Status = 'active' | 'paused' | 'pending_cancel' | 'canceled';

// A purchasable tier. Price is the per-seat amount per interval in whole cents
// to keep all proration math in integers and avoid floating point drift.
export type Plan = {
  id: string;
  name: string;
  blurb: string;
  priceCents: number; // per seat, per interval
  interval: Interval;
  minSeats: number;
  maxSeats: number;
  features: string[];
};

// A single line on the invoice history. Positive amountCents is a charge,
// negative is a credit. Each line records the kind of billing action that
// produced it so the UI can label and group them.
export type InvoiceKind =
  | 'signup'
  | 'plan_change'
  | 'seat_change'
  | 'renewal'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'reactivate';

export type Invoice = {
  id: string;
  at: number; // epoch ms
  kind: InvoiceKind;
  description: string;
  amountCents: number; // positive charge, negative credit, zero informational
};

// The customer's current subscription state. periodStart and periodEnd bound
// the current billing cycle; renewalAt is when the next charge falls due while
// active. cancelAt is set when a cancellation is scheduled for the period end.
export type Subscription = {
  planId: string;
  seats: number;
  status: Status;
  periodStart: number; // epoch ms
  periodEnd: number; // epoch ms, also the renewal boundary
  cancelAt: number | null; // epoch ms when pending_cancel takes effect
};

// Result of pricing a proposed plan or seat change before it is committed. The
// UI shows this to the customer so they can see the prorated amount ahead of
// confirming. amountCents > 0 is an immediate charge, < 0 is account credit.
export type Proration = {
  amountCents: number;
  creditCents: number; // unused value reclaimed from the current plan
  chargeCents: number; // cost of the new plan for the remaining days
  daysRemaining: number;
  daysInPeriod: number;
};
