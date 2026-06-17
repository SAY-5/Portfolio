// Reconciliation rollups over all intents. Totals are kept per currency because
// summing across currencies would be meaningless; the UI renders one row per
// currency that has activity. All arithmetic is integer minor units.

import type { Currency, PaymentIntent } from './types';

export type CurrencyTotals = {
  currency: Currency;
  authorized: number;
  captured: number;
  refunded: number;
  // net settled = captured minus refunded.
  net: number;
  count: number;
};

export type Reconciliation = {
  byCurrency: CurrencyTotals[];
  declined: number;
  retried: number;
  intentCount: number;
};

export function reconcile(intents: PaymentIntent[]): Reconciliation {
  const map = new Map<Currency, CurrencyTotals>();
  let declined = 0;
  let retried = 0;

  for (const it of intents) {
    declined += it.declines;
    retried += it.retries;

    const row =
      map.get(it.currency) ??
      {
        currency: it.currency,
        authorized: 0,
        captured: 0,
        refunded: 0,
        net: 0,
        count: 0,
      };
    // Authorized total only counts intents that actually reached authorization
    // or beyond, so failed/created intents do not inflate the authorized line.
    const authorizedReached =
      it.status !== 'created' && it.status !== 'failed';
    row.authorized += authorizedReached ? it.amount : 0;
    row.captured += it.capturedAmount;
    row.refunded += it.refundedAmount;
    row.net = row.captured - row.refunded;
    row.count += 1;
    map.set(it.currency, row);
  }

  return {
    byCurrency: [...map.values()].sort((a, b) =>
      a.currency.localeCompare(b.currency),
    ),
    declined,
    retried,
    intentCount: intents.length,
  };
}
