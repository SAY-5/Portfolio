import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './disttrace.css';

// Real numbers from the project: DistTrace was used to identify 12 critical
// bottlenecks across 5 microservices and reduce p99 API latency by 45% across
// the service mesh. It groups OTLP-shaped spans into trace trees, computes
// per-service p50/p95/p99 rollups, flags services at or above a configurable
// p99 threshold, and walks the longest synchronous root-to-leaf chain.
const BOTTLENECKS = 12;
const SERVICES = 5;
const P99_CUT = 45; // percent

const ease = [0.22, 1, 0.36, 1] as const;

type Span = {
  id: string;
  service: string;
  name: string;
  depth: number;
  start: number; // ms offset from trace root
  dur: number; // ms
  parent: string | null;
  // p50/p95/p99 rollup for the owning service, in ms
  p50: number;
  p95: number;
  p99: number;
};

// One trace tree across five services. Durations and the per-service
// percentiles are fixed so the critical-path math is deterministic.
const spans: Span[] = [
  { id: 's0', service: 'gateway', name: 'POST /checkout', depth: 0, start: 0, dur: 340, parent: null, p50: 120, p95: 280, p99: 360 },
  { id: 's1', service: 'orders', name: 'createOrder', depth: 1, start: 14, dur: 300, parent: 's0', p50: 90, p95: 240, p99: 320 },
  { id: 's2', service: 'inventory', name: 'reserveStock', depth: 2, start: 30, dur: 70, parent: 's1', p50: 35, p95: 64, p99: 78 },
  { id: 's3', service: 'pricing', name: 'quote', depth: 2, start: 108, dur: 196, parent: 's1', p50: 70, p95: 170, p99: 210 },
  { id: 's4', service: 'payments', name: 'charge', depth: 3, start: 120, dur: 168, parent: 's3', p50: 60, p95: 150, p99: 190 },
  { id: 's5', service: 'inventory', name: 'commit', depth: 1, start: 318, dur: 18, parent: 's0', p50: 35, p95: 64, p99: 78 },
];

// The synchronous critical path: longest root-to-leaf chain by accumulated
// duration. Computed once, matches the gateway -> orders -> pricing -> payments
// chain that drives the 340 ms total.
const CRITICAL_PATH = ['s0', 's1', 's3', 's4'];

const SERVICE_COLORS: Record<string, string> = {
  gateway: '#ff5b29',
  orders: '#ffa07a',
  inventory: '#4fd08a',
  pricing: '#7aa2ff',
  payments: '#c08bff',
};

const TRACE_TOTAL = 340; // ms, span 0 duration

// A small rotating set of live trace summaries the SSE /stream endpoint would
// push. Deterministic ordering, no randomness at render time.
const STREAM = [
  { id: 'tr-9c41', svc: 'payments', p99: 204, over: true },
  { id: 'tr-9c42', svc: 'inventory', p99: 71, over: false },
  { id: 'tr-9c43', svc: 'pricing', p99: 218, over: true },
  { id: 'tr-9c44', svc: 'orders', p99: 309, over: true },
  { id: 'tr-9c45', svc: 'gateway', p99: 188, over: false },
  { id: 'tr-9c46', svc: 'inventory', p99: 64, over: false },
];

export default function DistTraceDemo() {
  const reduce = useReducedMotion();
  const [threshold, setThreshold] = useState(180);
  const [showPath, setShowPath] = useState(true);
  const [feed, setFeed] = useState<typeof STREAM>([]);
  const [streaming, setStreaming] = useState(false);
  const idxRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function toggleStream() {
    if (streaming) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      setStreaming(false);
      return;
    }
    setStreaming(true);
    if (reduce) {
      setFeed(STREAM.slice(0, 5));
      setStreaming(false);
      return;
    }
    const push = () => {
      const item = STREAM[idxRef.current % STREAM.length];
      idxRef.current += 1;
      setFeed((prev) => [{ ...item, id: `${item.id}-${idxRef.current}` }, ...prev].slice(0, 5));
    };
    push();
    timerRef.current = setInterval(push, 1100);
  }

  const overCount = spans.filter((s) => s.p99 >= threshold).length;

  return (
    <div className="demo" aria-label="disttrace demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Trace tree, critical path, and p99 threshold</h3>
      <p className="demo__lede">
        Spans group into a trace tree across five services. Drag the p99
        threshold to flag services over the line, toggle the longest
        synchronous root-to-leaf path, and start the live stream of trace
        summaries.
      </p>

      <div className="dt__stage">
        <div className="dt__flame" role="img" aria-label="trace flame graph across five services">
          <div className="dt__axis">
            <span>0 ms</span>
            <span>{Math.round(TRACE_TOTAL / 2)} ms</span>
            <span>{TRACE_TOTAL} ms</span>
          </div>
          {spans.map((s, i) => {
            const onPath = CRITICAL_PATH.includes(s.id);
            const over = s.p99 >= threshold;
            const left = (s.start / TRACE_TOTAL) * 100;
            const width = Math.max(4, (s.dur / TRACE_TOTAL) * 100);
            return (
              <div className="dt__row" style={{ marginLeft: `${s.depth * 14}px` }} key={s.id}>
                <motion.div
                  className={`dt__bar ${onPath && showPath ? 'dt__bar--path' : ''} ${over ? 'dt__bar--over' : ''}`}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    borderColor: SERVICE_COLORS[s.service],
                  }}
                  initial={{ opacity: reduce ? 1 : 0, scaleX: reduce ? 1 : 0.6 }}
                  animate={{ opacity: 1, scaleX: 1 }}
                  transition={{ duration: reduce ? 0 : 0.4, delay: reduce ? 0 : i * 0.07, ease }}
                >
                  <span
                    className="dt__bar-dot"
                    style={{ background: SERVICE_COLORS[s.service] }}
                  />
                  <span className="dt__bar-label">
                    {s.service}:{s.name}
                  </span>
                  <span className="dt__bar-dur">{s.dur} ms</span>
                </motion.div>
              </div>
            );
          })}
          <AnimatePresence>
            {showPath && (
              <motion.div
                className="dt__path-badge"
                initial={{ opacity: 0, y: reduce ? 0 : -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                critical path: {CRITICAL_PATH.length} spans, {TRACE_TOTAL} ms
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="dt__panel">
          <div className="dt__threshold">
            <div className="dt__threshold-label">
              <span>p99 threshold</span>
              <b>{threshold} ms</b>
            </div>
            <input
              className="dt__slider"
              type="range"
              min={60}
              max={340}
              step={10}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              aria-label="p99 latency threshold in milliseconds"
            />
            <div className="dt__threshold-meta">
              {overCount} of {spans.length} spans at or above threshold
            </div>
          </div>

          <ul className="dt__rollups">
            {Array.from(new Set(spans.map((s) => s.service))).map((svc) => {
              const s = spans.find((sp) => sp.service === svc)!;
              const over = s.p99 >= threshold;
              return (
                <li key={svc} className={`dt__rollup ${over ? 'dt__rollup--over' : ''}`}>
                  <span className="dt__rollup-dot" style={{ background: SERVICE_COLORS[svc] }} />
                  <span className="dt__rollup-name">{svc}</span>
                  <span className="dt__rollup-vals">
                    <span>p50 {s.p50}</span>
                    <span>p95 {s.p95}</span>
                    <span className="dt__rollup-p99">p99 {s.p99}</span>
                  </span>
                  {over && <span className="dt__rollup-flag">over</span>}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="dt__feed">
          <div className="dt__feed-head">
            <span>SSE /stream</span>
            <span className={`dt__feed-dot ${streaming ? 'dt__feed-dot--live' : ''}`}>
              {streaming ? 'live' : 'idle'}
            </span>
          </div>
          <ul className="dt__feed-list">
            <AnimatePresence initial={false}>
              {feed.length === 0 ? (
                <li className="dt__feed-empty">start the stream to receive trace summaries</li>
              ) : (
                feed.map((t) => (
                  <motion.li
                    key={t.id}
                    className={`dt__feed-line ${t.over ? 'dt__feed-line--over' : ''}`}
                    initial={{ opacity: 0, x: reduce ? 0 : -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduce ? 0 : 0.3, ease }}
                  >
                    <span className="dt__feed-id">{t.id.slice(0, 7)}</span>
                    <span className="dt__feed-svc">{t.svc}</span>
                    <span className="dt__feed-p99">p99 {t.p99} ms</span>
                    {t.over && <span className="dt__feed-tag">bottleneck</span>}
                  </motion.li>
                ))
              )}
            </AnimatePresence>
          </ul>
        </div>

        <div className="dt__verdict">
          <span className="dt__verdict-x">{P99_CUT}%</span>
          <span className="dt__verdict-text">
            Flagging bottlenecks this way surfaced {BOTTLENECKS} across{' '}
            {SERVICES} microservices and cut p99 API latency by {P99_CUT}%
            across the mesh.
          </span>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={toggleStream}>
          {streaming ? 'Stop stream' : 'Start stream'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => setShowPath((p) => !p)}
          aria-pressed={showPath}
        >
          {showPath ? 'Hide critical path' : 'Show critical path'}
        </button>
        <span className="demo__hint">{spans.length} spans, {SERVICES} services</span>
      </div>
    </div>
  );
}
