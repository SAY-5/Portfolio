import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import './flowdeck.css';

// Real mechanism from the project: ActOnRecord mutations update the cache
// optimistically before the server replies and roll back on failure. The
// server returns FacetCounts alongside every page of records for faceted
// filtering. Three RBAC roles (viewer, operator, supervisor) are enforced by
// a gRPC interceptor. Here a viewer cannot act, an operator can act on open
// records, and only a supervisor can act on a record flagged for review.

type Status = 'open' | 'resolved' | 'review';
type Role = 'viewer' | 'operator' | 'supervisor';

type Rec = {
  id: string;
  title: string;
  queue: 'billing' | 'fraud' | 'access';
  status: Status;
};

const SEED: Rec[] = [
  { id: 'REC-4012', title: 'Duplicate charge dispute', queue: 'billing', status: 'open' },
  { id: 'REC-4019', title: 'Card flagged by rules engine', queue: 'fraud', status: 'review' },
  { id: 'REC-4023', title: 'Seat removed, still billed', queue: 'billing', status: 'open' },
  { id: 'REC-4031', title: 'Login from new region', queue: 'access', status: 'open' },
  { id: 'REC-4044', title: 'Chargeback under review', queue: 'fraud', status: 'review' },
  { id: 'REC-4050', title: 'Role escalation request', queue: 'access', status: 'open' },
];

const ROLES: { id: Role; label: string; note: string }[] = [
  { id: 'viewer', label: 'viewer', note: 'read only' },
  { id: 'operator', label: 'operator', note: 'can resolve open records' },
  { id: 'supervisor', label: 'supervisor', note: 'can also clear review' },
];

const FACETS: { id: Status; label: string }[] = [
  { id: 'open', label: 'open' },
  { id: 'resolved', label: 'resolved' },
  { id: 'review', label: 'review' },
];

// The interceptor rule: who may ActOnRecord on a record of this status.
function canAct(role: Role, status: Status): boolean {
  if (role === 'viewer') return false;
  if (status === 'resolved') return false;
  if (status === 'review') return role === 'supervisor';
  return true; // open records: operator or supervisor
}

// A scripted server: most acts confirm, the fraud queue occasionally rejects
// so the optimistic update has to roll back. Deterministic per record id.
function serverAccepts(rec: Rec): boolean {
  return !(rec.queue === 'fraud' && rec.id === 'REC-4044');
}

type Pending = {
  id: string;
  prev: Status;
  phase: 'optimistic' | 'confirmed' | 'rolledback';
};

const ease = [0.22, 1, 0.36, 1] as const;

export default function FlowdeckDemo() {
  const reduce = useReducedMotion();
  const [records, setRecords] = useState<Rec[]>(SEED);
  const [role, setRole] = useState<Role>('operator');
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [pending, setPending] = useState<Pending | null>(null);
  const [log, setLog] = useState<
    { id: string; text: string; kind: 'optimistic' | 'confirmed' | 'rolledback' | 'denied' }[]
  >([]);
  const t1 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t2 = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (t1.current) clearTimeout(t1.current);
      if (t2.current) clearTimeout(t2.current);
    },
    [],
  );

  // Server-returned facet counts: recomputed from the cache every render, the
  // same way the page would arrive with FacetCounts attached.
  const facetCounts = useMemo(() => {
    const c: Record<Status, number> = { open: 0, resolved: 0, review: 0 };
    for (const r of records) c[r.status] += 1;
    return c;
  }, [records]);

  const visible = useMemo(
    () => (filter === 'all' ? records : records.filter((r) => r.status === filter)),
    [records, filter],
  );

  function pushLog(entry: {
    id: string;
    text: string;
    kind: 'optimistic' | 'confirmed' | 'rolledback' | 'denied';
  }) {
    setLog((l) => [{ ...entry }, ...l].slice(0, 6));
  }

  function act(rec: Rec) {
    if (pending) return;
    if (!canAct(role, rec.status)) {
      pushLog({
        id: rec.id,
        text: `interceptor denied: ${role} cannot act on ${rec.status}`,
        kind: 'denied',
      });
      return;
    }

    const prev = rec.status;
    const nextStatus: Status = 'resolved';

    // Optimistic write: mutate the cache before the server replies.
    setRecords((rs) =>
      rs.map((r) => (r.id === rec.id ? { ...r, status: nextStatus } : r)),
    );
    setPending({ id: rec.id, prev, phase: 'optimistic' });
    pushLog({ id: rec.id, text: 'optimistic resolve applied to cache', kind: 'optimistic' });

    const accepts = serverAccepts(rec);
    const settle = () => {
      if (accepts) {
        setPending({ id: rec.id, prev, phase: 'confirmed' });
        pushLog({ id: rec.id, text: 'server confirmed, cache kept', kind: 'confirmed' });
      } else {
        // Roll back: restore the previous status from the captured snapshot.
        setRecords((rs) =>
          rs.map((r) => (r.id === rec.id ? { ...r, status: prev } : r)),
        );
        setPending({ id: rec.id, prev, phase: 'rolledback' });
        pushLog({ id: rec.id, text: 'server rejected, rolled back', kind: 'rolledback' });
      }
      t2.current = setTimeout(() => setPending(null), reduce ? 0 : 900);
    };
    t1.current = setTimeout(settle, reduce ? 0 : 950);
  }

  function reset() {
    if (t1.current) clearTimeout(t1.current);
    if (t2.current) clearTimeout(t2.current);
    setRecords(SEED);
    setPending(null);
    setLog([]);
    setFilter('all');
  }

  return (
    <div className="demo" aria-label="flowdeck optimistic updates demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Act optimistically, roll back on reject</h3>
      <p className="demo__lede">
        Pick a role, then resolve a record. The cache updates instantly while
        the request is in flight, the server-returned facet counts move with it,
        and a rejected act rolls the row back. The interceptor blocks actions
        your role is not allowed to take.
      </p>

      <div className="fd__roles" role="radiogroup" aria-label="active role">
        {ROLES.map((r) => (
          <button
            key={r.id}
            role="radio"
            aria-checked={role === r.id}
            className="fd__role"
            data-on={role === r.id}
            onClick={() => setRole(r.id)}
            disabled={!!pending}
          >
            <span className="fd__role-name">{r.label}</span>
            <span className="fd__role-note">{r.note}</span>
          </button>
        ))}
      </div>

      <div className="fd__facets" aria-label="faceted filter with server counts">
        <button
          className="fd__facet"
          data-on={filter === 'all'}
          onClick={() => setFilter('all')}
        >
          all <em>{records.length}</em>
        </button>
        {FACETS.map((f) => (
          <button
            key={f.id}
            className="fd__facet"
            data-on={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            <motion.em
              key={facetCounts[f.id]}
              initial={{ scale: reduce ? 1 : 1.4, color: 'var(--accent)' }}
              animate={{ scale: 1, color: 'var(--text-faint)' }}
              transition={{ duration: reduce ? 0 : 0.35, ease }}
            >
              {facetCounts[f.id]}
            </motion.em>
          </button>
        ))}
      </div>

      <div className="fd__list">
        <AnimatePresence initial={false}>
          {visible.map((rec) => {
            const isPending = pending?.id === rec.id;
            const allowed = canAct(role, rec.status);
            return (
              <motion.div
                key={rec.id}
                layout={!reduce}
                className="fd__row"
                data-status={rec.status}
                data-phase={isPending ? pending?.phase : undefined}
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{ duration: reduce ? 0 : 0.3, ease }}
              >
                <div className="fd__row-main">
                  <span className="fd__row-id">{rec.id}</span>
                  <span className="fd__row-title">{rec.title}</span>
                  <span className="fd__row-queue">{rec.queue}</span>
                </div>
                <div className="fd__row-side">
                  <span className="fd__row-status" data-status={rec.status}>
                    {isPending && pending?.phase === 'optimistic'
                      ? 'resolving'
                      : rec.status}
                  </span>
                  <button
                    className="fd__act"
                    onClick={() => act(rec)}
                    disabled={
                      !!pending ||
                      rec.status === 'resolved' ||
                      !allowed
                    }
                    aria-label={`Resolve ${rec.id}`}
                  >
                    {rec.status === 'resolved'
                      ? 'done'
                      : allowed
                        ? 'resolve'
                        : 'locked'}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {visible.length === 0 && (
          <div className="fd__empty">No records in this facet.</div>
        )}
      </div>

      <div className="fd__logwrap">
        <div className="fd__log-head">request log</div>
        <ul className="fd__log">
          {log.length === 0 && (
            <li className="fd__log-empty">Act on a record to see the round trip.</li>
          )}
          <AnimatePresence initial={false}>
            {log.map((e, i) => (
              <motion.li
                key={`${e.id}-${log.length - i}-${e.kind}`}
                className="fd__log-line"
                data-kind={e.kind}
                initial={{ opacity: 0, x: reduce ? 0 : -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.25, ease }}
              >
                <span className="fd__log-id">{e.id}</span>
                <span className="fd__log-text">{e.text}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>

      <div className="demo__controls">
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={!!pending}>
          Reset
        </button>
        <span className="demo__hint">
          role: {role} · grpc-web through envoy to a pure grpc backend
        </span>
      </div>
    </div>
  );
}
