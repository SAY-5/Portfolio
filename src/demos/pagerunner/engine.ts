// Pure scheduling and escalation engine. No eval, no Date.now, no I/O: every
// function is a deterministic projection of its arguments, so the UI can drive
// it from a settable clock and replay any moment.

import {
  MINUTES_PER_WEEK,
  type EscalationPolicy,
  type Incident,
  type Rotation,
} from './types';

// Reduce an absolute clock minute to a minute-of-week in [0, MINUTES_PER_WEEK).
export function minuteOfWeek(absoluteMinute: number): number {
  const m = absoluteMinute % MINUTES_PER_WEEK;
  return m < 0 ? m + MINUTES_PER_WEEK : m;
}

// Which rotation slot is on call at a given absolute minute. Each shift covers
// shiftMinutes; slots cycle through rotation.order in turn. Returns the index
// into rotation.order, or -1 when the rotation has no responders.
export function onCallSlotAt(rotation: Rotation, absoluteMinute: number): number {
  const n = rotation.order.length;
  if (n === 0) return -1;
  const shift = rotation.shiftMinutes > 0 ? rotation.shiftMinutes : MINUTES_PER_WEEK;
  const elapsedShifts = Math.floor(mod(absoluteMinute, shift * n) / shift);
  return elapsedShifts % n;
}

// The responder id on call at a given absolute minute, or null when empty.
export function onCallResponderAt(
  rotation: Rotation,
  absoluteMinute: number,
): string | null {
  const slot = onCallSlotAt(rotation, absoluteMinute);
  if (slot < 0) return null;
  return rotation.order[slot];
}

// The upcoming rotation handoffs from a given absolute minute, as a list of
// { atMinute, responderId } entries. Useful for a "schedule ahead" view.
export function upcomingShifts(
  rotation: Rotation,
  fromMinute: number,
  count: number,
): { atMinute: number; responderId: string }[] {
  const n = rotation.order.length;
  if (n === 0 || count <= 0) return [];
  const shift = rotation.shiftMinutes > 0 ? rotation.shiftMinutes : MINUTES_PER_WEEK;
  // Start of the shift currently containing fromMinute.
  const currentShiftStart = Math.floor(fromMinute / shift) * shift;
  const out: { atMinute: number; responderId: string }[] = [];
  for (let i = 0; i < count; i++) {
    const atMinute = currentShiftStart + i * shift;
    const slot = onCallSlotAt(rotation, atMinute);
    out.push({ atMinute, responderId: rotation.order[slot] });
  }
  return out;
}

// The escalation tier an incident sits at after `elapsed` minutes, assuming no
// acknowledgement. Tier 0 is the first page; each time a tier's ackTimeoutMin
// passes without an ack, escalation advances to the next tier. The result is
// clamped to the last tier (we keep paging the final rung; this models a policy
// that never gives up). Returns -1 when the policy has no tiers.
export function tierAfter(policy: EscalationPolicy, elapsedMinutes: number): number {
  const tiers = policy.tiers;
  if (tiers.length === 0) return -1;
  let tier = 0;
  let consumed = 0;
  // Walk forward: tier i holds for its own ackTimeoutMin before escalating.
  while (tier < tiers.length - 1) {
    consumed += Math.max(0, tiers[tier].ackTimeoutMin);
    if (elapsedMinutes < consumed) break;
    tier += 1;
  }
  return tier;
}

// The absolute minute at which tier `tier` would begin paging, measured from an
// incident created at createdAtMinute. Tier 0 begins at creation.
export function tierStartMinute(
  policy: EscalationPolicy,
  createdAtMinute: number,
  tier: number,
): number {
  let offset = 0;
  for (let i = 0; i < tier && i < policy.tiers.length; i++) {
    offset += Math.max(0, policy.tiers[i].ackTimeoutMin);
  }
  return createdAtMinute + offset;
}

// The current escalation tier for a live incident at a given clock minute. A
// resolved or acknowledged incident freezes at the tier it was acked on (or the
// tier active at resolution). A still-triggered incident escalates with time.
export function currentTier(
  incident: Incident,
  policy: EscalationPolicy,
  nowMinute: number,
): number {
  if (incident.status === 'acked' || incident.status === 'resolved') {
    return incident.ackedAtTier ?? tierAfter(policy, escalationElapsed(incident, nowMinute));
  }
  const elapsed = Math.max(0, nowMinute - incident.createdAtMinute);
  return tierAfter(policy, elapsed);
}

// Minutes of un-acked escalation an incident accrued. For a live incident this
// grows with the clock; once acked it freezes at the ack moment.
export function escalationElapsed(incident: Incident, nowMinute: number): number {
  const end =
    incident.ackedAtMinute ??
    incident.resolvedAtMinute ??
    nowMinute;
  return Math.max(0, end - incident.createdAtMinute);
}

// Small helper: positive modulo for negative dividends.
function mod(a: number, m: number): number {
  const r = a % m;
  return r < 0 ? r + m : r;
}
