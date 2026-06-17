// Framework-agnostic store for the ticket workspace. Tickets live in
// localStorage so they survive a reload; on first run a varied seed is written.
// Every mutation rewrites the persisted array and notifies subscribers, and a
// React binding over useSyncExternalStore gives every component one consistent
// snapshot. Nothing here calls Date.now during render: the seed builds its
// timestamps once at module load relative to a fixed base.

import type { Priority, Status, Ticket } from './types';

const TICKETS_KEY = 'ticketsearch.tickets.v1';

const HOUR = 60 * 60 * 1000;

// ---------- seed ----------

// Build the seed relative to a single base captured once, so the twelve
// tickets have a realistic spread of ages and SLA targets without any per
// render clock read. A handful are deliberately past due or close to due so
// the SLA health view has something to show on first load.
function buildSeed(): Ticket[] {
  const base = Date.now();
  const ago = (h: number) => base - h * HOUR;
  const due = (h: number) => base + h * HOUR;

  const rows: Omit<Ticket, 'id'>[] = [
    {
      subject: 'Login page returns 500 after password reset',
      body: 'Customer reset their password and now every login attempt throws a server error. Reproduced on staging with a fresh reset token.',
      requester: 'Dana Okafor',
      status: 'open',
      priority: 'urgent',
      tags: ['auth', 'bug', 'regression'],
      assignee: null,
      createdAt: ago(3),
      slaDueAt: due(-1),
    },
    {
      subject: 'Export to CSV truncates long descriptions',
      body: 'The reporting export cuts description fields at around 250 characters. Customers need the full text for their audit records.',
      requester: 'Liam Brookes',
      status: 'open',
      priority: 'normal',
      tags: ['export', 'reporting'],
      assignee: 'Mara Silva',
      createdAt: ago(20),
      slaDueAt: due(6),
    },
    {
      subject: 'Webhook deliveries retrying forever on 429',
      body: 'Our webhook endpoint returns 429 under load and the platform keeps retrying without backoff, amplifying the overload.',
      requester: 'Priya Nair',
      status: 'open',
      priority: 'high',
      tags: ['webhook', 'api', 'rate-limit'],
      assignee: null,
      createdAt: ago(5),
      slaDueAt: due(2),
    },
    {
      subject: 'Billing invoice shows wrong tax region',
      body: 'Invoices for our EU subsidiary are being stamped with the US tax region, so the totals are off and finance cannot reconcile.',
      requester: 'Tomas Reyes',
      status: 'pending',
      priority: 'high',
      tags: ['billing', 'tax'],
      assignee: 'Jon Avery',
      createdAt: ago(40),
      slaDueAt: due(-3),
    },
    {
      subject: 'Dark mode toggle resets on navigation',
      body: 'Switching to dark mode works, but moving between pages snaps the theme back to light. Likely a preference not being persisted.',
      requester: 'Sara Mendez',
      status: 'open',
      priority: 'low',
      tags: ['ui', 'preferences'],
      assignee: null,
      createdAt: ago(60),
      slaDueAt: due(30),
    },
    {
      subject: 'API key rotation breaks active sessions',
      body: 'Rotating an API key immediately invalidates in-flight requests with no grace window, causing brief outages for integrations.',
      requester: 'Wei Chen',
      status: 'open',
      priority: 'urgent',
      tags: ['api', 'auth', 'security'],
      assignee: 'Mara Silva',
      createdAt: ago(2),
      slaDueAt: due(1),
    },
    {
      subject: 'Search returns no results for hyphenated terms',
      body: 'Querying for a hyphenated product name like rate-limit returns nothing, even though matching tickets clearly exist.',
      requester: 'Noah Fischer',
      status: 'pending',
      priority: 'normal',
      tags: ['search', 'bug'],
      assignee: 'Jon Avery',
      createdAt: ago(28),
      slaDueAt: due(10),
    },
    {
      subject: 'Onboarding email never arrives for gmail addresses',
      body: 'New signups using gmail report the welcome email never lands. Other providers are fine. Suspect a deliverability or SPF issue.',
      requester: 'Grace Hall',
      status: 'open',
      priority: 'high',
      tags: ['email', 'onboarding', 'deliverability'],
      assignee: null,
      createdAt: ago(8),
      slaDueAt: due(3),
    },
    {
      subject: 'Mobile app crashes when uploading large attachment',
      body: 'Uploading a photo over about 10 MB on the iOS app crashes the upload screen and loses the draft reply.',
      requester: 'Hiro Tanaka',
      status: 'open',
      priority: 'normal',
      tags: ['mobile', 'ios', 'attachments'],
      assignee: 'Mara Silva',
      createdAt: ago(15),
      slaDueAt: due(18),
    },
    {
      subject: 'Refund request not reflected on dashboard',
      body: 'A refund was processed in billing but the customer dashboard still shows the charge as active, confusing the account owner.',
      requester: 'Elena Popa',
      status: 'pending',
      priority: 'normal',
      tags: ['billing', 'dashboard'],
      assignee: 'Jon Avery',
      createdAt: ago(34),
      slaDueAt: due(8),
    },
    {
      subject: 'Documentation link in footer is broken',
      body: 'The Docs link in the site footer points at an old path and returns a 404. Minor, but it looks unprofessional.',
      requester: 'Owen Wright',
      status: 'solved',
      priority: 'low',
      tags: ['docs', 'website'],
      assignee: 'Jon Avery',
      createdAt: ago(72),
      slaDueAt: due(-20),
    },
    {
      subject: 'Bulk import fails silently on duplicate emails',
      body: 'Importing a contact list with duplicate email addresses reports success but silently drops the duplicates with no warning.',
      requester: 'Amara Diallo',
      status: 'open',
      priority: 'high',
      tags: ['import', 'data', 'bug'],
      assignee: null,
      createdAt: ago(6),
      slaDueAt: due(5),
    },
  ];

  return rows.map((row, i) => ({
    ...row,
    id: `TS-${(1001 + i).toString()}`,
  }));
}

// ---------- persistence ----------

function readTickets(): Ticket[] {
  try {
    const raw = localStorage.getItem(TICKETS_KEY);
    if (!raw) {
      const seed = buildSeed();
      writeTickets(seed);
      return seed;
    }
    return JSON.parse(raw) as Ticket[];
  } catch {
    return buildSeed();
  }
}

function writeTickets(tickets: Ticket[]): void {
  try {
    localStorage.setItem(TICKETS_KEY, JSON.stringify(tickets));
  } catch {
    // storage may be unavailable (private mode); the app still works in memory.
  }
}

// ---------- minimal external store ----------

export type State = {
  tickets: Ticket[];
};

let state: State = { tickets: readTickets() };
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function commit(tickets: Ticket[]): void {
  writeTickets(tickets);
  state = { tickets };
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

// ---------- id ----------

function nextId(tickets: Ticket[]): string {
  let max = 1000;
  for (const t of tickets) {
    const n = Number(t.id.replace(/[^0-9]/g, ''));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `TS-${(max + 1).toString()}`;
}

// ---------- actions ----------

export type NewTicket = {
  subject: string;
  body: string;
  requester: string;
  priority: Priority;
  tags: string[];
  // The creating component captures the clock once and passes it in, so the
  // store never reads time during a render-driven call.
  now: number;
};

export function createTicket(input: NewTicket): string {
  const id = nextId(state.tickets);
  const ticket: Ticket = {
    id,
    subject: input.subject.trim() || 'Untitled ticket',
    body: input.body.trim(),
    requester: input.requester.trim() || 'Unknown requester',
    status: 'open',
    priority: input.priority,
    tags: input.tags,
    assignee: null,
    createdAt: input.now,
    // Default SLA target: eight hours out from creation.
    slaDueAt: input.now + 8 * HOUR,
  };
  commit([ticket, ...state.tickets]);
  return id;
}

function update(id: string, patch: Partial<Ticket>): void {
  commit(state.tickets.map((t) => (t.id === id ? { ...t, ...patch } : t)));
}

export function setStatus(id: string, status: Status): void {
  update(id, { status });
}

export function setPriority(id: string, priority: Priority): void {
  update(id, { priority });
}

export function assign(id: string, assignee: string | null): void {
  update(id, { assignee: assignee && assignee.trim() ? assignee.trim() : null });
}

export function addTag(id: string, tag: string): void {
  const clean = tag.trim().toLowerCase();
  if (!clean) return;
  const ticket = state.tickets.find((t) => t.id === id);
  if (!ticket || ticket.tags.includes(clean)) return;
  update(id, { tags: [...ticket.tags, clean] });
}

export function removeTag(id: string, tag: string): void {
  const ticket = state.tickets.find((t) => t.id === id);
  if (!ticket) return;
  update(id, { tags: ticket.tags.filter((t) => t !== tag) });
}

// Wipe persisted tickets and reseed, so the demo always has a known-good
// starting set after a reset.
export function resetAll(): void {
  try {
    localStorage.removeItem(TICKETS_KEY);
  } catch {
    // ignore storage errors
  }
  const seed = buildSeed();
  commit(seed);
}
