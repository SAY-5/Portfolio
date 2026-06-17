// Safe, pure search and triage engine. No eval, no Function, no regex built
// from user text: queries are tokenized into plain words and scored against a
// per-ticket term index, so a hostile query can only ever miss, never execute.
// Every function here is a pure transform over its inputs, which keeps the
// store and the React layer trivial to reason about.

import {
  PRIORITY_RANK,
  type Filters,
  type SearchHit,
  type SlaHealth,
  type SortMode,
  type Ticket,
} from './types';

// At-risk window: a non-solved ticket whose SLA falls due within this span is
// worth chasing before it breaches.
export const AT_RISK_MS = 4 * 60 * 60 * 1000; // 4 hours

// Weight subject matches above body and tag matches: a hit in the subject is a
// stronger signal of relevance than the same word buried in the body.
const SUBJECT_WEIGHT = 3;
const TAG_WEIGHT = 2;
const BODY_WEIGHT = 1;

// Split arbitrary text into lowercased word tokens. Anything that is not a
// letter or digit is a separator, so punctuation never leaks into a token and
// the query can never be interpreted as code.
export function tokenize(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of text.toLowerCase()) {
    const isWord = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
    if (isWord) {
      cur += ch;
    } else if (cur) {
      out.push(cur);
      cur = '';
    }
  }
  if (cur) out.push(cur);
  return out;
}

// Count occurrences of each token in a list, used to weight term frequency so
// a ticket that mentions the query word twice outranks one that mentions it
// once.
function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

// Score a single ticket against the query tokens. Each query token contributes
// its term frequency in each field times that field's weight; a token that
// matches nothing contributes nothing. An empty query scores every ticket 0,
// so the caller falls back to filter and sort order.
export function scoreTicket(ticket: Ticket, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const subjectTf = termFrequency(tokenize(ticket.subject));
  const bodyTf = termFrequency(tokenize(ticket.body));
  const tagTf = termFrequency(tokenize(ticket.tags.join(' ')));

  let score = 0;
  for (const q of queryTokens) {
    score += (subjectTf.get(q) ?? 0) * SUBJECT_WEIGHT;
    score += (tagTf.get(q) ?? 0) * TAG_WEIGHT;
    score += (bodyTf.get(q) ?? 0) * BODY_WEIGHT;
  }
  return score;
}

function passesFilters(ticket: Ticket, filters: Filters): boolean {
  if (filters.status && ticket.status !== filters.status) return false;
  if (filters.priority && ticket.priority !== filters.priority) return false;
  if (filters.tag && !ticket.tags.includes(filters.tag)) return false;
  if (filters.assignee) {
    if (filters.assignee === '__unassigned__') {
      if (ticket.assignee !== null) return false;
    } else if (ticket.assignee !== filters.assignee) {
      return false;
    }
  }
  return true;
}

// Run the full pipeline: filter, then score against the query, then sort.
// With a non-empty query and relevance sort, zero-score tickets drop out so
// the result list is the set that actually matched. With an empty query every
// filtered ticket is kept and ordered by the chosen sort.
export function search(
  tickets: Ticket[],
  query: string,
  filters: Filters,
  sort: SortMode,
): SearchHit[] {
  const queryTokens = tokenize(query);
  const hasQuery = queryTokens.length > 0;

  const hits: SearchHit[] = [];
  for (const ticket of tickets) {
    if (!passesFilters(ticket, filters)) continue;
    const score = scoreTicket(ticket, queryTokens);
    if (hasQuery && score === 0) continue;
    hits.push({ ticket, score });
  }

  hits.sort((a, b) => {
    if (sort === 'sla') {
      // Soonest SLA first. Solved tickets have no live SLA pressure, so they
      // sink below any non-solved ticket regardless of due time.
      const aLive = a.ticket.status !== 'solved';
      const bLive = b.ticket.status !== 'solved';
      if (aLive !== bLive) return aLive ? -1 : 1;
      if (a.ticket.slaDueAt !== b.ticket.slaDueAt) {
        return a.ticket.slaDueAt - b.ticket.slaDueAt;
      }
      return b.score - a.score;
    }
    // Relevance: higher score first, then priority, then soonest SLA.
    if (b.score !== a.score) return b.score - a.score;
    const pr = PRIORITY_RANK[b.ticket.priority] - PRIORITY_RANK[a.ticket.priority];
    if (pr !== 0) return pr;
    return a.ticket.slaDueAt - b.ticket.slaDueAt;
  });

  return hits;
}

// A non-solved ticket whose SLA is already past now.
export function isBreached(ticket: Ticket, now: number): boolean {
  return ticket.status !== 'solved' && ticket.slaDueAt < now;
}

// A non-solved ticket that is not yet breached but falls due within the
// at-risk window.
export function isAtRisk(ticket: Ticket, now: number): boolean {
  if (ticket.status === 'solved') return false;
  if (ticket.slaDueAt < now) return false;
  return ticket.slaDueAt - now <= AT_RISK_MS;
}

// Roll the whole ticket set up into breached and at-risk lists, each ordered
// soonest-due first so the dashboard surfaces the most pressing work at top.
export function slaHealth(tickets: Ticket[], now: number): SlaHealth {
  const breached = tickets
    .filter((t) => isBreached(t, now))
    .sort((a, b) => a.slaDueAt - b.slaDueAt);
  const atRisk = tickets
    .filter((t) => isAtRisk(t, now))
    .sort((a, b) => a.slaDueAt - b.slaDueAt);
  return { breached, atRisk };
}

// Every distinct tag across the ticket set, sorted, for the facet filter.
export function allTags(tickets: Ticket[]): string[] {
  const set = new Set<string>();
  for (const t of tickets) for (const tag of t.tags) set.add(tag);
  return [...set].sort();
}

// Every distinct assignee across the ticket set, sorted, for the facet filter.
export function allAssignees(tickets: Ticket[]): string[] {
  const set = new Set<string>();
  for (const t of tickets) if (t.assignee) set.add(t.assignee);
  return [...set].sort();
}
