import { useEffect, useMemo, useState } from 'react';
import '../styles/demo.css';
import './ticketsearch.css';
import {
  PRIORITIES,
  PRIORITY_RANK,
  STATUSES,
  type Filters,
  type Priority,
  type SortMode,
  type Status,
  type Ticket,
} from './ticketsearch/types';
import {
  AT_RISK_MS,
  allAssignees,
  allTags,
  isAtRisk,
  isBreached,
  search,
  slaHealth,
} from './ticketsearch/engine';
import { useStore } from './ticketsearch/state';
import {
  addTag,
  assign,
  removeTag,
  resetAll,
  setPriority,
  setStatus,
} from './ticketsearch/store';

// In-browser support ticket triage workspace. Tickets are seeded into
// localStorage and survive reloads. The search box runs the safe tokenized
// engine live, facet filters narrow the set, and any result opens into a detail
// pane where it can be retriaged: status, priority, assignee, and tags. The
// triage dashboard rolls the whole set up into per-status and per-priority
// counts plus SLA-breached, at-risk, and unassigned queues. The clock is
// snapshotted into render state and refreshed on an interval, so SLA math never
// reads Date.now during a render.

type View = 'search' | 'dashboard';

const ASSIGNEES = ['Mara Silva', 'Jon Avery', 'Wei Chen'];

function relativeTime(ts: number, now: number): string {
  const diff = now - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function slaLabel(ticket: Ticket, now: number): string {
  if (ticket.status === 'solved') return 'solved';
  const diff = ticket.slaDueAt - now;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const unit =
    mins < 60
      ? `${mins}m`
      : mins < 1440
        ? `${Math.round(mins / 60)}h`
        : `${Math.round(mins / 1440)}d`;
  return diff < 0 ? `${unit} over` : `due in ${unit}`;
}

function slaTone(ticket: Ticket, now: number): 'breached' | 'risk' | 'ok' | 'done' {
  if (ticket.status === 'solved') return 'done';
  if (isBreached(ticket, now)) return 'breached';
  if (isAtRisk(ticket, now)) return 'risk';
  return 'ok';
}

export default function TicketsearchDemo() {
  const { tickets } = useStore();

  // Clock snapshot in render state, refreshed every 30s by an effect. SLA
  // computations read `now` from state, never Date.now inline in render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(iv);
  }, []);

  const [view, setView] = useState<View>('search');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>({
    status: null,
    priority: null,
    tag: null,
    assignee: null,
  });
  const [sort, setSort] = useState<SortMode>('relevance');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState('');

  const tags = useMemo(() => allTags(tickets), [tickets]);
  const assignees = useMemo(() => allAssignees(tickets), [tickets]);
  const hits = useMemo(
    () => search(tickets, query, filters, sort),
    [tickets, query, filters, sort],
  );
  const health = useMemo(() => slaHealth(tickets, now), [tickets, now]);

  const selected = useMemo(
    () => tickets.find((t) => t.id === selectedId) ?? null,
    [tickets, selectedId],
  );

  // Per-status and per-priority counts for the dashboard.
  const statusCounts = useMemo(() => {
    const c: Record<Status, number> = { open: 0, pending: 0, solved: 0 };
    for (const t of tickets) c[t.status] += 1;
    return c;
  }, [tickets]);

  const priorityCounts = useMemo(() => {
    const c: Record<Priority, number> = { low: 0, normal: 0, high: 0, urgent: 0 };
    for (const t of tickets) c[t.priority] += 1;
    return c;
  }, [tickets]);

  const unassigned = useMemo(
    () => tickets.filter((t) => t.assignee === null && t.status !== 'solved'),
    [tickets],
  );

  function toggleFacet<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: prev[key] === value ? null : value }));
  }

  function openTicket(id: string) {
    setSelectedId(id);
    setView('search');
  }

  const atRiskHours = Math.round(AT_RISK_MS / (60 * 60 * 1000));

  return (
    <div className="demo tsa" aria-label="Support ticket triage workspace">
      <span className="demo__tag">Support workspace</span>
      <h3 className="demo__title">TicketSearch</h3>
      <p className="demo__lede">
        Search and filter a seeded queue of support tickets, open one to retriage
        it, and watch SLA health at a glance. Tickets persist in your browser, so
        any change survives a reload. Search runs a safe tokenized scorer over
        subject, body, and tags with no code execution. At-risk means due within{' '}
        {atRiskHours} hours.
      </p>

      <div className="tsa__tabs" role="tablist" aria-label="Views">
        <button
          role="tab"
          aria-selected={view === 'search'}
          className={`tsa__tab ${view === 'search' ? 'tsa__tab--on' : ''}`}
          onClick={() => setView('search')}
        >
          Search and triage
        </button>
        <button
          role="tab"
          aria-selected={view === 'dashboard'}
          className={`tsa__tab ${view === 'dashboard' ? 'tsa__tab--on' : ''}`}
          onClick={() => setView('dashboard')}
        >
          Triage dashboard
        </button>
      </div>

      {view === 'search' ? (
        <div className="tsa__work">
          <section className="tsa__left glass" aria-label="Search and filters">
            <label className="tsa__search">
              <span className="tsa__sr">Search tickets</span>
              <input
                type="search"
                className="tsa__input"
                placeholder="Search subject, body, tags…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>

            <div className="tsa__sortrow">
              <span className="tsa__facet-label">Sort</span>
              <div className="tsa__seg" role="group" aria-label="Sort order">
                <button
                  className={`tsa__seg-btn ${sort === 'relevance' ? 'tsa__seg-btn--on' : ''}`}
                  aria-pressed={sort === 'relevance'}
                  onClick={() => setSort('relevance')}
                >
                  Relevance
                </button>
                <button
                  className={`tsa__seg-btn ${sort === 'sla' ? 'tsa__seg-btn--on' : ''}`}
                  aria-pressed={sort === 'sla'}
                  onClick={() => setSort('sla')}
                >
                  SLA soonest
                </button>
              </div>
            </div>

            <fieldset className="tsa__facet">
              <legend className="tsa__facet-label">Status</legend>
              <div className="tsa__chips">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    className={`tsa__chip ${filters.status === s ? 'tsa__chip--on' : ''}`}
                    aria-pressed={filters.status === s}
                    onClick={() => toggleFacet('status', s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="tsa__facet">
              <legend className="tsa__facet-label">Priority</legend>
              <div className="tsa__chips">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    className={`tsa__chip tsa__chip--p-${p} ${filters.priority === p ? 'tsa__chip--on' : ''}`}
                    aria-pressed={filters.priority === p}
                    onClick={() => toggleFacet('priority', p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="tsa__facet">
              <legend className="tsa__facet-label">Assignee</legend>
              <div className="tsa__chips">
                <button
                  className={`tsa__chip ${filters.assignee === '__unassigned__' ? 'tsa__chip--on' : ''}`}
                  aria-pressed={filters.assignee === '__unassigned__'}
                  onClick={() => toggleFacet('assignee', '__unassigned__')}
                >
                  unassigned
                </button>
                {assignees.map((a) => (
                  <button
                    key={a}
                    className={`tsa__chip ${filters.assignee === a ? 'tsa__chip--on' : ''}`}
                    aria-pressed={filters.assignee === a}
                    onClick={() => toggleFacet('assignee', a)}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="tsa__facet">
              <legend className="tsa__facet-label">Tag</legend>
              <div className="tsa__chips">
                {tags.map((t) => (
                  <button
                    key={t}
                    className={`tsa__chip ${filters.tag === t ? 'tsa__chip--on' : ''}`}
                    aria-pressed={filters.tag === t}
                    onClick={() => toggleFacet('tag', t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </fieldset>
          </section>

          <section className="tsa__mid glass" aria-label="Results">
            <div className="tsa__results-head">
              <span>
                {hits.length} {hits.length === 1 ? 'ticket' : 'tickets'}
              </span>
            </div>
            <ul className="tsa__list">
              {hits.length === 0 && (
                <li className="tsa__empty">No tickets match this search and filter.</li>
              )}
              {hits.map(({ ticket, score }) => {
                const tone = slaTone(ticket, now);
                return (
                  <li key={ticket.id}>
                    <button
                      className={`tsa__row ${selectedId === ticket.id ? 'tsa__row--on' : ''}`}
                      onClick={() => setSelectedId(ticket.id)}
                      aria-pressed={selectedId === ticket.id}
                    >
                      <span className="tsa__row-top">
                        <span className={`tsa__pri tsa__pri--${ticket.priority}`}>
                          {ticket.priority}
                        </span>
                        <span className="tsa__row-id">{ticket.id}</span>
                        <span className={`tsa__sla tsa__sla--${tone}`}>
                          {slaLabel(ticket, now)}
                        </span>
                      </span>
                      <span className="tsa__row-subject">{ticket.subject}</span>
                      <span className="tsa__row-meta">
                        <span className={`tsa__status tsa__status--${ticket.status}`}>
                          {ticket.status}
                        </span>
                        <span className="tsa__row-req">{ticket.requester}</span>
                        {ticket.assignee ? (
                          <span className="tsa__row-asg">{ticket.assignee}</span>
                        ) : (
                          <span className="tsa__row-asg tsa__row-asg--none">unassigned</span>
                        )}
                        {score > 0 && <span className="tsa__row-score">score {score}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="tsa__right glass" aria-label="Ticket detail">
            {selected ? (
              <TicketDetail
                ticket={selected}
                now={now}
                tagDraft={tagDraft}
                onTagDraft={setTagDraft}
                onClose={() => setSelectedId(null)}
              />
            ) : (
              <div className="tsa__detail-empty">
                Select a ticket to see its detail and retriage it.
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="tsa__dash">
          <div className="tsa__dash-cards">
            <div className="tsa__card glass">
              <div className="tsa__card-head">By status</div>
              <ul className="tsa__statlist">
                {STATUSES.map((s) => (
                  <li key={s}>
                    <span className={`tsa__status tsa__status--${s}`}>{s}</span>
                    <b>{statusCounts[s]}</b>
                  </li>
                ))}
              </ul>
            </div>
            <div className="tsa__card glass">
              <div className="tsa__card-head">By priority</div>
              <ul className="tsa__statlist">
                {[...PRIORITIES]
                  .sort((a, b) => PRIORITY_RANK[b] - PRIORITY_RANK[a])
                  .map((p) => (
                    <li key={p}>
                      <span className={`tsa__pri tsa__pri--${p}`}>{p}</span>
                      <b>{priorityCounts[p]}</b>
                    </li>
                  ))}
              </ul>
            </div>
            <div className="tsa__card glass tsa__card--alert">
              <div className="tsa__card-head">SLA breached</div>
              <div className="tsa__bignum">{health.breached.length}</div>
              <div className="tsa__card-sub">at risk {health.atRisk.length}</div>
            </div>
            <div className="tsa__card glass">
              <div className="tsa__card-head">Unassigned</div>
              <div className="tsa__bignum">{unassigned.length}</div>
              <div className="tsa__card-sub">open and pending</div>
            </div>
          </div>

          <div className="tsa__queues">
            <QueueList
              title="SLA breached"
              tone="breached"
              tickets={health.breached}
              now={now}
              onOpen={openTicket}
              empty="Nothing breached. Good."
            />
            <QueueList
              title="At risk"
              tone="risk"
              tickets={health.atRisk}
              now={now}
              onOpen={openTicket}
              empty="Nothing at risk right now."
            />
            <QueueList
              title="Unassigned queue"
              tone="ok"
              tickets={unassigned}
              now={now}
              onOpen={openTicket}
              empty="Every active ticket has an owner."
            />
          </div>

          <div className="tsa__dash-foot">
            <button className="demo__btn demo__btn--ghost" onClick={() => resetAll()}>
              Reset to seed
            </button>
            <span className="demo__hint">
              Reset clears localStorage and restores the original {tickets.length}-ticket queue.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function QueueList({
  title,
  tone,
  tickets,
  now,
  onOpen,
  empty,
}: {
  title: string;
  tone: 'breached' | 'risk' | 'ok';
  tickets: Ticket[];
  now: number;
  onOpen: (id: string) => void;
  empty: string;
}) {
  return (
    <section className={`tsa__queue glass tsa__queue--${tone}`} aria-label={title}>
      <div className="tsa__queue-head">
        {title} <span className="tsa__queue-count">{tickets.length}</span>
      </div>
      <ul className="tsa__queue-list">
        {tickets.length === 0 && <li className="tsa__empty">{empty}</li>}
        {tickets.map((t) => (
          <li key={t.id}>
            <button className="tsa__queue-row" onClick={() => onOpen(t.id)}>
              <span className={`tsa__pri tsa__pri--${t.priority}`}>{t.priority}</span>
              <span className="tsa__queue-subject">{t.subject}</span>
              <span className={`tsa__sla tsa__sla--${slaTone(t, now)}`}>
                {slaLabel(t, now)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TicketDetail({
  ticket,
  now,
  tagDraft,
  onTagDraft,
  onClose,
}: {
  ticket: Ticket;
  now: number;
  tagDraft: string;
  onTagDraft: (v: string) => void;
  onClose: () => void;
}) {
  const tone = slaTone(ticket, now);

  function submitTag(e: React.FormEvent) {
    e.preventDefault();
    addTag(ticket.id, tagDraft);
    onTagDraft('');
  }

  return (
    <div className="tsa__detail">
      <div className="tsa__detail-head">
        <span className="tsa__row-id">{ticket.id}</span>
        <button className="tsa__close" onClick={onClose} aria-label="Close detail">
          ×
        </button>
      </div>
      <h4 className="tsa__detail-subject">{ticket.subject}</h4>
      <div className="tsa__detail-by">
        <span>{ticket.requester}</span>
        <span aria-hidden="true">·</span>
        <span>opened {relativeTime(ticket.createdAt, now)}</span>
        <span aria-hidden="true">·</span>
        <span className={`tsa__sla tsa__sla--${tone}`}>{slaLabel(ticket, now)}</span>
      </div>
      <p className="tsa__detail-body">{ticket.body}</p>

      <div className="tsa__field">
        <label className="tsa__field-label" htmlFor={`status-${ticket.id}`}>
          Status
        </label>
        <select
          id={`status-${ticket.id}`}
          className="tsa__select"
          value={ticket.status}
          onChange={(e) => setStatus(ticket.id, e.target.value as Status)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="tsa__field">
        <label className="tsa__field-label" htmlFor={`priority-${ticket.id}`}>
          Priority
        </label>
        <select
          id={`priority-${ticket.id}`}
          className="tsa__select"
          value={ticket.priority}
          onChange={(e) => setPriority(ticket.id, e.target.value as Priority)}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div className="tsa__field">
        <label className="tsa__field-label" htmlFor={`assignee-${ticket.id}`}>
          Assignee
        </label>
        <select
          id={`assignee-${ticket.id}`}
          className="tsa__select"
          value={ticket.assignee ?? ''}
          onChange={(e) => assign(ticket.id, e.target.value || null)}
        >
          <option value="">unassigned</option>
          {ASSIGNEES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      <div className="tsa__field">
        <span className="tsa__field-label">Tags</span>
        <div className="tsa__taglist">
          {ticket.tags.length === 0 && <span className="tsa__row-asg--none">no tags</span>}
          {ticket.tags.map((t) => (
            <span key={t} className="tsa__tag">
              {t}
              <button
                className="tsa__tag-x"
                onClick={() => removeTag(ticket.id, t)}
                aria-label={`Remove tag ${t}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <form className="tsa__tagform" onSubmit={submitTag}>
          <input
            className="tsa__input tsa__input--sm"
            placeholder="add tag"
            value={tagDraft}
            onChange={(e) => onTagDraft(e.target.value)}
            aria-label="Add a tag"
          />
          <button className="demo__btn demo__btn--ghost" type="submit">
            Add
          </button>
        </form>
      </div>
    </div>
  );
}
