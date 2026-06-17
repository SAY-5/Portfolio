// The PayFlow state machine. Pure and side-effect free: every function takes a
// snapshot plus a clock value and returns a new snapshot, so the store can own
// persistence and the engine stays trivially testable. There is no eval and no
// dynamic dispatch; transitions are an explicit, closed table.

import type {
  Action,
  ApplyResult,
  IntentEvent,
  IntentStatus,
  PaymentIntent,
  ProcessorMode,
  ProcessorResult,
} from './types';

// The legal transition table. A status maps to the actions it permits; any
// action not listed for a status is rejected. captured permits both refund and
// another (top-up) refund, and partially_refunded permits further refunds.
const LEGAL: Record<IntentStatus, Action[]> = {
  created: ['authorize'],
  authorized: ['capture', 'void'],
  captured: ['refund'],
  partially_refunded: ['refund'],
  refunded: [],
  voided: [],
  failed: [],
};

export function isLegal(status: IntentStatus, action: Action): boolean {
  return LEGAL[status].includes(action);
}

export function legalActions(status: IntentStatus): Action[] {
  return LEGAL[status];
}

// ---------- id helpers ----------

// Deterministic-enough ids without pulling in a dependency. The caller passes a
// clock so the engine never reads Date.now itself.
function rand(): string {
  return Math.floor(Math.random() * 1_000_000)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0');
}

export function newIntentId(): string {
  return `PI-${rand()}`;
}

function newEventId(): string {
  return `EV-${rand()}${rand()}`;
}

// ---------- simulated processor ----------

// A processor that approves or declines per its configured mode. On a decline
// the client retries with exponential backoff up to maxRetries; the deciding
// attempt for an approve mode succeeds on the first try. The backoff schedule
// is deterministic (250ms doubling) so the retry path renders the same way each
// run.
export function runProcessor(
  mode: ProcessorMode,
  maxRetries: number,
): ProcessorResult {
  const backoffMs: number[] = [];
  if (mode === 'approve') {
    return { approved: true, attempts: 1, backoffMs, reason: 'approved' };
  }
  // Decline mode: every attempt fails, so we exhaust the retry budget and the
  // backoff schedule shows what a real client would have waited between tries.
  let delay = 250;
  for (let i = 0; i < maxRetries; i++) {
    backoffMs.push(delay);
    delay *= 2;
  }
  return {
    approved: false,
    attempts: maxRetries + 1,
    backoffMs,
    reason: 'card_declined',
  };
}

// ---------- intent construction ----------

export function createIntent(
  amount: number,
  currency: PaymentIntent['currency'],
  now: number,
): PaymentIntent {
  return {
    id: newIntentId(),
    amount,
    currency,
    status: 'created',
    capturedAmount: 0,
    refundedAmount: 0,
    declines: 0,
    retries: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function event(
  intentId: string,
  action: IntentEvent['action'],
  ok: boolean,
  now: number,
  extra: Partial<IntentEvent> = {},
): IntentEvent {
  return {
    id: newEventId(),
    intentId,
    at: now,
    action,
    ok,
    ...extra,
  };
}

function reject(
  intent: PaymentIntent,
  action: Action,
  reason: string,
  now: number,
  idempotencyKey?: string,
): ApplyResult {
  return {
    ok: false,
    intent,
    event: event(intent.id, action, false, now, { reason, idempotencyKey }),
  };
}

// ---------- action options ----------

export type ApplyOptions = {
  now: number;
  // Minor-unit amount for capture and refund. Ignored by authorize and void.
  amount?: number;
  // Processor configuration for authorize. Other actions never call out.
  processorMode?: ProcessorMode;
  maxRetries?: number;
  idempotencyKey?: string;
};

// Apply one action to an intent and return the next snapshot plus its event.
// The engine validates legality first, then action-specific invariants, and
// only ever returns a new object. Idempotency replay is handled by the store,
// which owns the key index; the engine stays pure.
export function apply(
  intent: PaymentIntent,
  action: Action,
  opts: ApplyOptions,
): ApplyResult {
  const { now, idempotencyKey } = opts;

  if (!isLegal(intent.status, action)) {
    return reject(
      intent,
      action,
      `illegal transition: cannot ${action} from ${intent.status}`,
      now,
      idempotencyKey,
    );
  }

  switch (action) {
    case 'authorize':
      return applyAuthorize(intent, opts);
    case 'capture':
      return applyCapture(intent, opts);
    case 'refund':
      return applyRefund(intent, opts);
    case 'void':
      return applyVoid(intent, opts);
    default:
      // Exhaustive: action is one of the four above.
      return reject(intent, action, 'unknown action', now, idempotencyKey);
  }
}

function applyAuthorize(intent: PaymentIntent, opts: ApplyOptions): ApplyResult {
  const { now, idempotencyKey } = opts;
  const mode: ProcessorMode = opts.processorMode ?? 'approve';
  const maxRetries = opts.maxRetries ?? 2;
  const processor = runProcessor(mode, maxRetries);

  if (!processor.approved) {
    // The authorization failed at the processor. The intent moves to failed and
    // records the declines and retries it accumulated, which the reconciliation
    // view sums.
    const next: PaymentIntent = {
      ...intent,
      status: 'failed',
      declines: intent.declines + 1,
      retries: intent.retries + maxRetries,
      updatedAt: now,
    };
    return {
      ok: false,
      intent: next,
      event: event(intent.id, 'authorize', false, now, {
        reason: processor.reason,
        idempotencyKey,
      }),
      processor,
    };
  }

  const next: PaymentIntent = {
    ...intent,
    status: 'authorized',
    updatedAt: now,
  };
  return {
    ok: true,
    intent: next,
    event: event(intent.id, 'authorize', true, now, { idempotencyKey }),
    processor,
  };
}

function applyCapture(intent: PaymentIntent, opts: ApplyOptions): ApplyResult {
  const { now, idempotencyKey } = opts;
  // Default to a full capture of the authorized amount.
  const amount = opts.amount ?? intent.amount;

  if (!Number.isInteger(amount) || amount <= 0) {
    return reject(intent, 'capture', 'capture amount must be a positive integer', now, idempotencyKey);
  }
  if (amount > intent.amount) {
    return reject(
      intent,
      'capture',
      `capture ${amount} exceeds authorized ${intent.amount}`,
      now,
      idempotencyKey,
    );
  }

  const next: PaymentIntent = {
    ...intent,
    status: 'captured',
    capturedAmount: amount,
    updatedAt: now,
  };
  return {
    ok: true,
    intent: next,
    event: event(intent.id, 'capture', true, now, { amount, idempotencyKey }),
  };
}

function applyRefund(intent: PaymentIntent, opts: ApplyOptions): ApplyResult {
  const { now, idempotencyKey } = opts;
  // Default to refunding the remaining captured balance.
  const remaining = intent.capturedAmount - intent.refundedAmount;
  const amount = opts.amount ?? remaining;

  if (!Number.isInteger(amount) || amount <= 0) {
    return reject(intent, 'refund', 'refund amount must be a positive integer', now, idempotencyKey);
  }
  if (amount > remaining) {
    return reject(
      intent,
      'refund',
      `refund ${amount} exceeds refundable ${remaining}`,
      now,
      idempotencyKey,
    );
  }

  const refundedAmount = intent.refundedAmount + amount;
  const fullyRefunded = refundedAmount >= intent.capturedAmount;
  const next: PaymentIntent = {
    ...intent,
    status: fullyRefunded ? 'refunded' : 'partially_refunded',
    refundedAmount,
    updatedAt: now,
  };
  return {
    ok: true,
    intent: next,
    event: event(intent.id, 'refund', true, now, { amount, idempotencyKey }),
  };
}

function applyVoid(intent: PaymentIntent, opts: ApplyOptions): ApplyResult {
  const { now, idempotencyKey } = opts;
  const next: PaymentIntent = {
    ...intent,
    status: 'voided',
    updatedAt: now,
  };
  return {
    ok: true,
    intent: next,
    event: event(intent.id, 'void', true, now, { idempotencyKey }),
  };
}
