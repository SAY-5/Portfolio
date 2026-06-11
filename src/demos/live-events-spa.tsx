import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import './live-events-spa.css';

// The feed streams domain events over Server-Sent Events into the SPA. The
// client holds a fixed in-memory ring buffer and filters over it with no
// round-trips while typing. EventSource carries Last-Event-ID so a dropped
// connection resumes from the last id it saw rather than replaying the world.
const RING_CAPACITY = 200;

type EventType = 'order' | 'payment' | 'shipment' | 'refund';

type DomainEvent = {
  id: number;
  type: EventType;
  actor: string;
  amount: number;
};

const TYPES: EventType[] = ['order', 'payment', 'shipment', 'refund'];
const ACTORS = ['svc-orders', 'svc-billing', 'svc-fulfil', 'svc-care'];

// A tiny seeded generator so the stream is deterministic for SSR and replays.
function makeEvent(id: number): DomainEvent {
  const type = TYPES[(id * 7) % TYPES.length];
  const actor = ACTORS[(id * 3) % ACTORS.length];
  const amount = 40 + ((id * 137) % 960);
  return { id, type, actor, amount };
}

const TYPE_LABEL: Record<EventType, string> = {
  order: 'OrderPlaced',
  payment: 'PaymentCaptured',
  shipment: 'ShipmentDispatched',
  refund: 'RefundIssued',
};

const ease = [0.22, 1, 0.36, 1] as const;

export default function LiveEventsSpaDemo() {
  const reduce = useReducedMotion();
  const [buffer, setBuffer] = useState<DomainEvent[]>(() =>
    Array.from({ length: 12 }, (_, i) => makeEvent(i + 1)),
  );
  const [streaming, setStreaming] = useState(false);
  const [connected, setConnected] = useState(true);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<EventType | 'all'>('all');
  const [lastEventId, setLastEventId] = useState(12);
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);
  const nextId = useRef(13);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  function stop() {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }

  useEffect(() => stop, []);

  useEffect(() => {
    if (!streaming || !connected) {
      stop();
      return;
    }
    timer.current = setInterval(
      () => {
        const id = nextId.current++;
        const ev = makeEvent(id);
        setLastEventId(id);
        setBuffer((prev) => {
          const next = [ev, ...prev];
          // The ring buffer is bounded: oldest events fall off the tail.
          return next.length > RING_CAPACITY
            ? next.slice(0, RING_CAPACITY)
            : next;
        });
      },
      reduce ? 700 : 900,
    );
    return stop;
  }, [streaming, connected, reduce]);

  // Client-side filter over the in-memory buffer. No request is made; this is
  // the same filter shape the server uses for history and CSV export.
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return buffer.filter((e) => {
      if (typeFilter !== 'all' && e.type !== typeFilter) return false;
      if (!q) return true;
      return (
        e.actor.toLowerCase().includes(q) ||
        TYPE_LABEL[e.type].toLowerCase().includes(q) ||
        String(e.id).includes(q)
      );
    });
  }, [buffer, filter, typeFilter]);

  function toggleStream() {
    if (!connected) return;
    setStreaming((s) => !s);
  }

  function dropConnection() {
    // Simulate a dropped connection. EventSource would retry on its own and
    // send Last-Event-ID; here the reconnect button resumes from that id.
    setConnected(false);
    setStreaming(false);
    setResumedFrom(null);
  }

  function reconnect() {
    // Resume cleanly: the server replays only events after Last-Event-ID, so
    // the buffer picks up where it left off with no duplicates and no full
    // replay.
    setResumedFrom(lastEventId);
    setConnected(true);
    setStreaming(true);
  }

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = { all: buffer.length };
    for (const t of TYPES) c[t] = 0;
    for (const e of buffer) c[e.type] += 1;
    return c;
  }, [buffer]);

  return (
    <div className="demo les" aria-label="live events SSE stream demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Live event feed over SSE</h3>
      <p className="demo__lede">
        Start the stream to watch domain events arrive over Server-Sent Events
        into a bounded ring buffer. Filters narrow the in-memory buffer
        instantly with no round-trip. Drop the connection, then reconnect to
        resume from Last-Event-ID with no replay.
      </p>

      <div className="les__bar" role="status" aria-live="polite">
        <span
          className={`les__conn les__conn--${connected ? 'up' : 'down'}`}
          aria-label={connected ? 'connection open' : 'connection dropped'}
        >
          <span className="les__dot" />
          {connected ? (streaming ? 'streaming' : 'connected') : 'disconnected'}
        </span>
        <span className="les__meta">
          Last-Event-ID <b>{lastEventId}</b>
        </span>
        <span className="les__meta">
          buffer <b>{buffer.length}</b>/{RING_CAPACITY}
        </span>
      </div>

      <div className="les__filters">
        <label className="les__search">
          <span className="les__sr">Filter events</span>
          <input
            className="les__input"
            type="text"
            placeholder="filter actor, type, or id"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <div className="les__types" role="group" aria-label="filter by type">
          <button
            className={`les__type ${typeFilter === 'all' ? 'les__type--on' : ''}`}
            onClick={() => setTypeFilter('all')}
            aria-pressed={typeFilter === 'all'}
          >
            all {typeCounts.all}
          </button>
          {TYPES.map((t) => (
            <button
              key={t}
              className={`les__type ${typeFilter === t ? 'les__type--on' : ''}`}
              onClick={() => setTypeFilter(t)}
              aria-pressed={typeFilter === t}
            >
              {t} {typeCounts[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="les__listwrap">
        <div className="les__list-head">
          <span>showing {visible.length} of {buffer.length} buffered</span>
          <span className="les__list-hint">newest first</span>
        </div>
        <ul className="les__list">
          <AnimatePresence initial={false}>
            {visible.slice(0, 16).map((e) => {
              const isResumed =
                resumedFrom !== null && e.id > resumedFrom && streaming;
              return (
                <motion.li
                  key={e.id}
                  className={`les__row les__row--${e.type}${
                    isResumed ? ' les__row--resumed' : ''
                  }`}
                  layout={!reduce}
                  initial={{ opacity: 0, y: reduce ? 0 : -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.28, ease }}
                >
                  <span className="les__row-id">#{e.id}</span>
                  <span className="les__row-type">{TYPE_LABEL[e.type]}</span>
                  <span className="les__row-actor">{e.actor}</span>
                  <span className="les__row-amount">${e.amount}.00</span>
                </motion.li>
              );
            })}
          </AnimatePresence>
          {visible.length === 0 && (
            <li className="les__empty">no buffered events match this filter</li>
          )}
        </ul>
      </div>

      <AnimatePresence>
        {resumedFrom !== null && (
          <motion.div
            className="les__resume"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease }}
          >
            resumed from Last-Event-ID <b>{resumedFrom}</b>: the server replayed
            only events after that id, so the buffer continued without gaps or
            duplicates.
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={toggleStream}
          disabled={!connected}
        >
          {streaming ? 'Pause stream' : 'Start stream'}
        </button>
        {connected ? (
          <button
            className="demo__btn demo__btn--ghost"
            onClick={dropConnection}
          >
            Drop connection
          </button>
        ) : (
          <button className="demo__btn" onClick={reconnect}>
            Reconnect
          </button>
        )}
        <span className="demo__hint">
          SSE one-way feed, Kafka durable upstream, Postgres read-model
        </span>
      </div>
    </div>
  );
}
