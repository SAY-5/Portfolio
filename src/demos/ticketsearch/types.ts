// Domain model for the in-browser support ticket triage workspace. Everything
// runs client-side over a localStorage-backed seed: there is no server, so
// these types describe the whole world the app reasons about.

export type Status = 'open' | 'pending' | 'solved';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export type Ticket = {
  id: string;
  subject: string;
  body: string;
  requester: string;
  status: Status;
  priority: Priority;
  tags: string[];
  // null means the ticket sits in the unassigned queue.
  assignee: string | null;
  createdAt: number;
  // SLA target: the moment the ticket is due. A ticket is breached once now
  // passes this for any non-solved ticket, and at-risk while it is close.
  slaDueAt: number;
};

// The ordered set of statuses and priorities, used for faceting and for the
// triage dashboard counts so the UI never hard-codes the same lists twice.
export const STATUSES: Status[] = ['open', 'pending', 'solved'];
export const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent'];

// Higher weight sorts and surfaces more urgent work first.
export const PRIORITY_RANK: Record<Priority, number> = {
  urgent: 3,
  high: 2,
  normal: 1,
  low: 0,
};

// A search hit pairs a ticket with its relevance score so the list can show
// why a result ranked where it did and sort on the same number.
export type SearchHit = {
  ticket: Ticket;
  score: number;
};

// Filters applied before scoring. Empty or null fields mean no constraint on
// that axis, so the default view is every ticket.
export type Filters = {
  status: Status | null;
  priority: Priority | null;
  tag: string | null;
  assignee: string | null;
};

export type SortMode = 'relevance' | 'sla';

// Health rollup the dashboard renders: which tickets have already missed their
// SLA and which are close enough to be worth chasing now.
export type SlaHealth = {
  breached: Ticket[];
  atRisk: Ticket[];
};
