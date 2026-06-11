import { useMemo, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './streamcatalog.css';

// streamcatalog catalogs Kafka streams and tracks lineage. Selecting a stream
// traverses producer / consumer / derivation edges transitively in both
// directions and terminates safely even when the graph contains a cycle.
// Access models (public, domain, private) decide who may self-serve subscribe;
// an allowed subscribe records a subscription and a lineage edge automatically.

type Access = 'public' | 'domain' | 'private';

type Stream = {
  id: string;
  label: string;
  domain: string;
  access: Access;
  x: number;
  y: number;
};

// Directed lineage edges: from -> to means `from` feeds `to` downstream.
type Edge = { from: string; to: string };

const streams: Stream[] = [
  { id: 'orders', label: 'orders.raw', domain: 'commerce', access: 'public', x: 70, y: 60 },
  { id: 'payments', label: 'payments.raw', domain: 'commerce', access: 'private', x: 70, y: 170 },
  { id: 'enriched', label: 'orders.enriched', domain: 'commerce', access: 'domain', x: 270, y: 110 },
  { id: 'fraud', label: 'fraud.signals', domain: 'risk', access: 'private', x: 270, y: 230 },
  { id: 'ledger', label: 'ledger.events', domain: 'finance', access: 'domain', x: 470, y: 60 },
  { id: 'metrics', label: 'sales.metrics', domain: 'analytics', access: 'public', x: 470, y: 175 },
  { id: 'recs', label: 'recs.feed', domain: 'analytics', access: 'public', x: 470, y: 285 },
];

const edges: Edge[] = [
  { from: 'orders', to: 'enriched' },
  { from: 'payments', to: 'enriched' },
  { from: 'payments', to: 'fraud' },
  { from: 'enriched', to: 'ledger' },
  { from: 'enriched', to: 'metrics' },
  { from: 'fraud', to: 'metrics' },
  { from: 'metrics', to: 'recs' },
  // derivation edge that closes a cycle: recs feeds back into fraud scoring.
  { from: 'recs', to: 'fraud' },
];

const accessLabel: Record<Access, string> = {
  public: 'public',
  domain: 'domain',
  private: 'private',
};

// Who is trying to subscribe in this demo: an analytics team consumer.
const VIEWER_DOMAIN = 'analytics';

function canSubscribe(s: Stream): boolean {
  if (s.access === 'public') return true;
  if (s.access === 'domain') return s.domain === VIEWER_DOMAIN;
  return false; // private: never self-serve
}

// Transitive traversal in one direction with cycle-safe termination.
function traverse(start: string, dir: 'down' | 'up', extra: Edge[]): Set<string> {
  const all = [...edges, ...extra];
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const node = stack.pop()!;
    for (const e of all) {
      const next = dir === 'down' ? (e.from === node ? e.to : null) : e.to === node ? e.from : null;
      if (next && !seen.has(next)) {
        seen.add(next);
        stack.push(next); // visited set guards against the recs -> fraud cycle
      }
    }
  }
  seen.delete(start);
  return seen;
}

const ease = [0.22, 1, 0.36, 1] as const;

export default function StreamcatalogDemo() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState('enriched');
  const [subs, setSubs] = useState<Edge[]>([]);
  const [note, setNote] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  const { down, up } = useMemo(() => {
    return {
      down: traverse(active, 'down', subs),
      up: traverse(active, 'up', subs),
    };
  }, [active, subs]);

  const activeStream = streams.find((s) => s.id === active)!;
  const allEdges = [...edges, ...subs];

  function edgeClass(e: Edge): string {
    // An edge is highlighted if both endpoints are reachable on the same side.
    if (e.to === active && up.has(e.from)) return 'up';
    if (e.from === active && down.has(e.to)) return 'down';
    if (down.has(e.from) && down.has(e.to)) return 'down';
    if (up.has(e.from) && up.has(e.to)) return 'up';
    if (e.from === active || e.to === active) return down.has(e.to) ? 'down' : 'up';
    return 'idle';
  }

  function subscribe(s: Stream) {
    if (!canSubscribe(s)) {
      setNote({
        id: s.id,
        ok: false,
        text:
          s.access === 'private'
            ? `${s.label} is private: no self-serve subscribe, request access from ${s.domain}`
            : `${s.label} is domain-scoped to ${s.domain}, your ${VIEWER_DOMAIN} team is out of scope`,
      });
      return;
    }
    if (subs.some((e) => e.to === s.id)) {
      setNote({ id: s.id, ok: true, text: `${s.label}: already subscribed, lineage edge recorded` });
      return;
    }
    // Allowed: record a subscription plus a lineage edge from the stream to the consumer.
    setSubs((prev) => [...prev, { from: s.id, to: '__consumer__' }]);
    setNote({ id: s.id, ok: true, text: `subscribed to ${s.label}, lineage edge recorded for ${VIEWER_DOMAIN}` });
  }

  function reset() {
    setSubs([]);
    setNote(null);
  }

  function nodeState(id: string): 'active' | 'down' | 'up' | 'idle' {
    if (id === active) return 'active';
    if (down.has(id)) return 'down';
    if (up.has(id)) return 'up';
    return 'idle';
  }

  return (
    <div className="demo" aria-label="streamcatalog lineage demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Lineage and access, one click</h3>
      <p className="demo__lede">
        Select any stream to ripple its lineage outward: upstream producers in
        one color, downstream consumers in another, traversed transitively and
        cycle-safe. Then try to subscribe as an analytics consumer and watch the
        three access models decide who may self-serve.
      </p>

      <div className="sc__stage">
        <div className="sc__graph">
          <svg className="sc__svg" viewBox="0 0 560 340" role="group" aria-label="stream lineage graph">
            <defs>
              <marker id="sc-up" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="#4fd08a" />
              </marker>
              <marker id="sc-down" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="var(--accent)" />
              </marker>
              <marker id="sc-idle" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="var(--line)" />
              </marker>
            </defs>

            {allEdges.map((e, i) => {
              if (e.to === '__consumer__') return null;
              const a = streams.find((s) => s.id === e.from)!;
              const b = streams.find((s) => s.id === e.to)!;
              const cls = edgeClass(e);
              const mx = (a.x + b.x) / 2;
              const stroke = cls === 'down' ? 'var(--accent)' : cls === 'up' ? '#4fd08a' : 'var(--line)';
              const marker = cls === 'down' ? 'url(#sc-down)' : cls === 'up' ? 'url(#sc-up)' : 'url(#sc-idle)';
              return (
                <motion.path
                  key={`${e.from}-${e.to}`}
                  d={`M ${a.x + 58} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x - 4} ${b.y}`}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={cls === 'idle' ? 1.2 : 2}
                  strokeOpacity={cls === 'idle' ? 0.5 : 0.9}
                  markerEnd={marker}
                  initial={false}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: reduce ? 0 : 0.4, delay: reduce ? 0 : i * 0.02, ease }}
                />
              );
            })}

            {streams.map((s) => {
              const st = nodeState(s.id);
              return (
                <g
                  key={s.id}
                  className="sc__node"
                  data-state={st}
                  role="button"
                  tabIndex={0}
                  aria-pressed={s.id === active}
                  aria-label={`Select stream ${s.label}, ${accessLabel[s.access]} access`}
                  onClick={() => setActive(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActive(s.id);
                    }
                  }}
                >
                  <motion.rect
                    x={s.x - 4}
                    y={s.y - 19}
                    width={64}
                    height={38}
                    rx={9}
                    className={`sc__node-box sc__node-box--${st}`}
                    animate={{ scale: st === 'active' && !reduce ? 1.04 : 1 }}
                    transition={{ duration: 0.25, ease }}
                    style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                  />
                  <text x={s.x + 28} y={s.y - 2} textAnchor="middle" className="sc__node-label">
                    {s.label}
                  </text>
                  <text x={s.x + 28} y={s.y + 11} textAnchor="middle" className={`sc__node-badge sc__node-badge--${s.access}`}>
                    {accessLabel[s.access]}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="sc__side">
          <div className="sc__counts">
            <div className="sc__count sc__count--up">
              <span className="sc__count-val">{up.size}</span>
              <span className="sc__count-name">upstream producers</span>
            </div>
            <div className="sc__count sc__count--down">
              <span className="sc__count-val">{down.size}</span>
              <span className="sc__count-name">downstream consumers</span>
            </div>
          </div>

          <div className="sc__selected">
            <span className="sc__selected-label">selected</span>
            <span className="sc__selected-name">{activeStream.label}</span>
            <span className={`sc__pill sc__pill--${activeStream.access}`}>{accessLabel[activeStream.access]}</span>
          </div>

          <button
            className={`sc__sub ${canSubscribe(activeStream) ? 'sc__sub--ok' : 'sc__sub--blocked'}`}
            onClick={() => subscribe(activeStream)}
          >
            {canSubscribe(activeStream) ? 'Self-serve subscribe' : 'Subscribe blocked'}
          </button>

          <div className="sc__sub-meta">
            viewer: {VIEWER_DOMAIN} team · {subs.length} subscription{subs.length === 1 ? '' : 's'} recorded
          </div>

          <AnimatePresence mode="wait">
            {note && (
              <motion.div
                key={note.id + note.text}
                className={`sc__note ${note.ok ? 'sc__note--ok' : 'sc__note--blocked'}`}
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease }}
              >
                {note.text}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Clear subscriptions
        </button>
        <span className="demo__hint">
          public: anyone · domain: same domain only · private: request access. Cycle recs to fraud terminates safely.
        </span>
      </div>
    </div>
  );
}
