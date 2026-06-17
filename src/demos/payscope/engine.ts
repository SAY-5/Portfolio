import type { Meter, UsageEvent, Plan, Invoice, InvoiceLineItem } from './types';

// Record a usage event, skipping duplicates by idempotency key.
// Returns the updated events array and a boolean indicating whether it was new.
export function recordEvent(
  events: UsageEvent[],
  event: UsageEvent,
): { events: UsageEvent[]; added: boolean } {
  const duplicate = events.some((e) => e.idempotencyKey === event.idempotencyKey);
  if (duplicate) return { events, added: false };
  return { events: [...events, event], added: true };
}

// Aggregate usage per meter within a billing period.
function aggregateUsage(
  events: UsageEvent[],
  periodStart: number,
  periodEnd: number,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const ev of events) {
    if (ev.timestamp < periodStart || ev.timestamp > periodEnd) continue;
    totals.set(ev.meterId, (totals.get(ev.meterId) ?? 0) + ev.quantity);
  }
  return totals;
}

// Generate an invoice for a plan over a billing period.
// No eval, no dynamic code. Pure arithmetic over known fields.
export function generateInvoice(
  plan: Plan,
  meters: Meter[],
  events: UsageEvent[],
  periodStart: number,
  periodEnd: number,
): Invoice {
  const usage = aggregateUsage(events, periodStart, periodEnd);
  const meterMap = new Map(meters.map((m) => [m.id, m]));
  const lineItems: InvoiceLineItem[] = [];
  let subtotal = 0;

  for (const pm of plan.meters) {
    const meter = meterMap.get(pm.meterId);
    if (!meter) continue;

    const totalUsage = usage.get(pm.meterId) ?? 0;
    const overageUsage = Math.max(0, totalUsage - pm.includedQuota);
    const charge = overageUsage * pm.overageRate;
    subtotal += charge;

    lineItems.push({
      meterName: meter.name,
      meterUnit: meter.unit,
      totalUsage,
      includedQuota: pm.includedQuota,
      overageUsage,
      overageRate: pm.overageRate,
      charge,
    });
  }

  // Round to two decimal places.
  subtotal = Math.round(subtotal * 100) / 100;

  return {
    id: `INV-${Date.now().toString(36).toUpperCase()}`,
    planId: plan.id,
    planName: plan.name,
    periodStart,
    periodEnd,
    lineItems,
    subtotal,
    generatedAt: Date.now(),
  };
}
