// Domain types for the PageRunner on-call and incident-escalation model.
// Everything is plain data so the engine stays pure and trivially testable.

// A person who can be paged. Responders are referenced everywhere by id.
export type Responder = {
  id: string;
  name: string;
  handle: string;
};

// A weekly on-call rotation. The ordered list of responder ids takes turns,
// one full week each, starting from rotationStart (a minute-of-week anchor).
// The cadence is fixed at one responder per calendar week.
export type Rotation = {
  // Ordered responder ids; index 0 is on call for the first week.
  order: string[];
  // Length of one shift in minutes. A week is 7 * 24 * 60 = 10080 minutes.
  shiftMinutes: number;
};

// One rung of an escalation policy: page this responder, and if no ack arrives
// within ackTimeoutMin, escalate to the next tier.
export type EscalationTier = {
  // Who to page at this tier. The special value 'oncall' resolves at runtime to
  // whoever the rotation says is currently on call.
  target: string;
  ackTimeoutMin: number;
};

// Ordered escalation rungs. Tier 0 is paged first.
export type EscalationPolicy = {
  tiers: EscalationTier[];
};

export type IncidentStatus = 'triggered' | 'acked' | 'resolved';

export type IncidentEventKind =
  | 'triggered'
  | 'paged'
  | 'escalated'
  | 'acked'
  | 'resolved';

// One entry in an incident's timeline. atMinute is an absolute minute on the
// simulation clock (minutes since the epoch the store defines).
export type IncidentEvent = {
  kind: IncidentEventKind;
  atMinute: number;
  // Responder id this event concerns, when relevant (a page or an ack).
  responderId?: string;
  // Escalation tier index this event concerns, when relevant.
  tier?: number;
  note: string;
};

export type Incident = {
  id: string;
  title: string;
  status: IncidentStatus;
  // Absolute clock minute the incident was triggered at.
  createdAtMinute: number;
  // Absolute clock minute an ack arrived at, if any.
  ackedAtMinute: number | null;
  // Absolute clock minute the incident was resolved at, if any.
  resolvedAtMinute: number | null;
  // The tier that was active when the incident was acknowledged, frozen so the
  // timeline stays stable after escalation stops.
  ackedAtTier: number | null;
  timeline: IncidentEvent[];
};

export const MINUTES_PER_WEEK = 7 * 24 * 60;
