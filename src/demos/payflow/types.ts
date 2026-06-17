// Domain types for the PayFlow payment-orchestration engine. A payment intent
// moves through a strict lifecycle and every action is recorded as an immutable
// event. Amounts are always integer minor units (cents) so arithmetic stays
// exact and never touches floating point.

export type Currency = 'USD' | 'EUR' | 'GBP' | 'JPY';

// The lifecycle a payment intent can occupy. Capture and refund track running
// totals, so partially_refunded is distinct from refunded.
export type IntentStatus =
  | 'created'
  | 'authorized'
  | 'captured'
  | 'partially_refunded'
  | 'refunded'
  | 'voided'
  | 'failed';

// The operations a caller can request against an intent. Each maps to one legal
// edge in the state machine.
export type Action =
  | 'authorize'
  | 'capture'
  | 'refund'
  | 'void';

export type PaymentIntent = {
  id: string;
  amount: number; // authorized ceiling, minor units
  currency: Currency;
  status: IntentStatus;
  capturedAmount: number; // minor units, <= amount
  refundedAmount: number; // minor units, <= capturedAmount
  // Number of processor declines this intent has accumulated, plus how many
  // retries were spent before a terminal outcome. Drives the reconciliation
  // declined/retried counters.
  declines: number;
  retries: number;
  createdAt: number;
  updatedAt: number;
};

// One immutable record appended to the log on every accepted action. Rejected
// actions are also logged so the timeline shows why an illegal move was denied.
export type IntentEvent = {
  id: string;
  intentId: string;
  at: number;
  action: Action | 'create';
  ok: boolean;
  reason?: string;
  // Amount moved by this event in minor units, when relevant.
  amount?: number;
  // Idempotency key the caller supplied, if any.
  idempotencyKey?: string;
  // True when this event is a replay of a prior result for the same key.
  replayed?: boolean;
};

// A processor verdict. The simulated processor can be configured to approve or
// decline, and a decline drives the retry-with-backoff counter.
export type ProcessorMode = 'approve' | 'decline';

export type ProcessorResult = {
  approved: boolean;
  // Attempts spent (1 on a clean approve, more when retries were exercised).
  attempts: number;
  // Backoff schedule in milliseconds that a real client would have waited.
  backoffMs: number[];
  reason?: string;
};

// The result of applying an action through the engine. The next intent is a new
// object (the engine never mutates its input) plus the event that records it.
export type ApplyResult = {
  ok: boolean;
  intent: PaymentIntent;
  event: IntentEvent;
  processor?: ProcessorResult;
};

export const CURRENCIES: Currency[] = ['USD', 'EUR', 'GBP', 'JPY'];

// Currencies without minor units (JPY) keep a zero-decimal exponent so the UI
// formats and parses them correctly.
export const CURRENCY_EXPONENT: Record<Currency, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
};
