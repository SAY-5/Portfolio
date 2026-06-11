import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './tradingetl.css';

// Real numbers from the project: p99 target under 100ms from feed-in to
// consumer-notified. Production overhead is dominated by the ~30ms Postgres
// COPY and ~2ms Redis SET. Five downstream services, each with its own
// predicate and isolated failure tracking, fed from one fanout.
const P99_TARGET = 100; // ms
const COPY_MS = 30; // Postgres COPY
const REDIS_MS = 2; // Redis SET

type Kind = 'equity' | 'fixedincome';

type Tick = {
  id: number;
  kind: Kind;
  symbol: string;
  field: string;
  value: string;
};

type Service = {
  id: string;
  name: string;
  pred: string;
  // does this service consume this kind of tick
  wants: (k: Kind) => boolean;
};

const services: Service[] = [
  { id: 'risk', name: 'risk-engine', pred: 'any tick', wants: () => true },
  {
    id: 'pnl',
    name: 'pnl-attribution',
    pred: 'equity only',
    wants: (k) => k === 'equity',
  },
  {
    id: 'compliance',
    name: 'compliance',
    pred: 'any tick',
    wants: () => true,
  },
  { id: 'ui', name: 'ui-dashboard', pred: 'any tick', wants: () => true },
  {
    id: 'alerting',
    name: 'alerting',
    pred: 'fixed-income only',
    wants: (k) => k === 'fixedincome',
  },
];

const ticks: Tick[] = [
  { id: 1, kind: 'equity', symbol: 'AAPL', field: 'last', value: '214.36' },
  {
    id: 2,
    kind: 'fixedincome',
    symbol: 'US10Y',
    field: 'yield',
    value: '4.281',
  },
  { id: 3, kind: 'equity', symbol: 'MSFT', field: 'last', value: '438.12' },
  {
    id: 4,
    kind: 'fixedincome',
    symbol: 'US2Y',
    field: 'yield',
    value: '4.702',
  },
  { id: 5, kind: 'equity', symbol: 'NVDA', field: 'last', value: '121.08' },
];

type SvcState = 'idle' | 'delivered' | 'dlq' | 'skipped';

const ease = [0.22, 1, 0.36, 1] as const;

export default function TradingetlDemo() {
  const reduce = useReducedMotion();
  const [tickIdx, setTickIdx] = useState(0);
  const [failing, setFailing] = useState(false); // alerting consumer breaks
  const [running, setRunning] = useState(false);
  const [delivered, setDelivered] = useState<Record<string, SvcState>>({});
  const [dlq, setDlq] = useState<{ id: number; symbol: string }[]>([]);
  const [p50, setP50] = useState(0);
  const [p99, setP99] = useState(0);
  const [maxMs, setMaxMs] = useState(0);
  const [done, setDone] = useState(false);
  const timers = useRef<number[]>([]);

  const tick = ticks[tickIdx];
  const matched = services.filter((s) => s.wants(tick.kind));

  function clearTimers() {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function resetRun() {
    clearTimers();
    setRunning(false);
    setDone(false);
    setDelivered({});
    setDlq([]);
    setP50(0);
    setP99(0);
    setMaxMs(0);
  }

  function pickTick(i: number) {
    if (running) return;
    setTickIdx(i);
    resetRun();
  }

  function computeLatencies(dlqHit: boolean) {
    // p99 is the warehouse write path: COPY plus Redis plus fanout dispatch.
    // A failed consumer adds a retry hop before the tick lands in the DLQ.
    const base = COPY_MS + REDIS_MS; // ~32ms write path
    const fanout = matched.length * 4; // per-service dispatch
    const p50v = Math.round(base * 0.6 + REDIS_MS); // cache-warm reads
    const p99v = base + fanout + (dlqHit ? 22 : 0);
    const maxv = p99v + (dlqHit ? 14 : 7);
    return { p50v, p99v, maxv };
  }

  function run() {
    if (running) return;
    resetRun();
    setRunning(true);

    const dlqHit = failing && matched.some((s) => s.id === 'alerting');
    const { p50v, p99v, maxv } = computeLatencies(dlqHit);

    const finish = () => {
      setP50(p50v);
      setP99(p99v);
      setMaxMs(maxv);
      const next: Record<string, SvcState> = {};
      services.forEach((s) => {
        if (!s.wants(tick.kind)) {
          next[s.id] = 'skipped';
        } else if (failing && s.id === 'alerting') {
          next[s.id] = 'dlq';
        } else {
          next[s.id] = 'delivered';
        }
      });
      setDelivered(next);
      if (dlqHit) {
        setDlq((prev) => [...prev, { id: tick.id, symbol: tick.symbol }]);
      }
      setRunning(false);
      setDone(true);
    };

    if (reduce) {
      finish();
      return;
    }

    // Stagger the per-service delivery so the fanout reads as parallel
    // dispatch with isolated outcomes.
    services.forEach((s, i) => {
      const t = window.setTimeout(() => {
        setDelivered((prev) => {
          const nx = { ...prev };
          if (!s.wants(tick.kind)) nx[s.id] = 'skipped';
          else if (failing && s.id === 'alerting') nx[s.id] = 'dlq';
          else nx[s.id] = 'delivered';
          return nx;
        });
      }, 240 + i * 150);
      timers.current.push(t);
    });

    // animate gauges climbing to their settled value
    const climbStart = performance.now();
    const climbDur = 900;
    const climb = () => {
      const p = Math.min(1, (performance.now() - climbStart) / climbDur);
      const e = 1 - Math.pow(1 - p, 3);
      setP50(Math.round(p50v * e));
      setP99(Math.round(p99v * e));
      setMaxMs(Math.round(maxv * e));
      if (p < 1) {
        const id = window.setTimeout(climb, 16);
        timers.current.push(id as unknown as number);
      }
    };
    climb();

    const endId = window.setTimeout(() => {
      if (dlqHit) {
        setDlq((prev) => [...prev, { id: tick.id, symbol: tick.symbol }]);
      }
      setRunning(false);
      setDone(true);
    }, 240 + services.length * 150 + 120);
    timers.current.push(endId);
  }

  function svcClass(s: Service): string {
    const st = delivered[s.id];
    if (st === 'delivered') return 'te__svc te__svc--delivered';
    if (st === 'dlq') return 'te__svc te__svc--dlq';
    if (st === 'skipped') return 'te__svc te__svc--skipped';
    return 'te__svc';
  }
  function svcStateLabel(s: Service): string {
    const st = delivered[s.id];
    if (st === 'delivered') return 'delivered';
    if (st === 'dlq') return 'to DLQ';
    if (st === 'skipped') return 'no match';
    return 'idle';
  }

  const breach = done && p99 > P99_TARGET;

  return (
    <div className="demo" aria-label="TradingETL fanout and latency demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">One tick, five consumers, one DLQ</h3>
      <p className="demo__lede">
        Pick a tick and run the pipeline. It writes to the warehouse and cache,
        then fans out to five services that each apply their own predicate.
        Break the alerting consumer to watch its tick land in the dead-letter
        queue while every other service keeps flowing.
      </p>

      <div className="te__stage">
        <div className="te__top">
          <div className="te__pipe">
            <div className="te__pipe-head">Parsed tick</div>
            <div className="te__tick">
              <span className="te__tick-kind">
                {tick.kind === 'equity' ? 'Equity' : 'FixedIncome'}
              </span>
              {'{ '}symbol: <b>{tick.symbol}</b>, {tick.field}:{' '}
              <b>{tick.value}</b>
              {' }'}
            </div>
            <div className="te__writes">
              <div className="te__write">
                <div className="te__write-name">warehouse</div>
                <div className="te__write-cost">Postgres COPY ~{COPY_MS}ms</div>
              </div>
              <div className="te__write">
                <div className="te__write-name">cache</div>
                <div className="te__write-cost">Redis SET ~{REDIS_MS}ms</div>
              </div>
            </div>
          </div>

          <div className="te__fan">
            <div className="te__fan-head">
              ConsumerRegistry fanout
              <span className="te__fan-count">
                {matched.length} of {services.length} match
              </span>
            </div>
            <div className="te__svcs">
              {services.map((s) => (
                <motion.button
                  key={s.id}
                  type="button"
                  className={svcClass(s)}
                  onClick={() => {
                    if (s.id === 'alerting' && !running) setFailing((f) => !f);
                  }}
                  aria-label={`${s.name}, predicate ${s.pred}`}
                  initial={false}
                  animate={
                    reduce
                      ? {}
                      : { scale: delivered[s.id] ? [1, 1.015, 1] : 1 }
                  }
                  transition={{ duration: 0.3, ease }}
                >
                  <span className="te__svc-dot" />
                  <span className="te__svc-name">{s.name}</span>
                  <span className="te__svc-pred">
                    {s.id === 'alerting'
                      ? failing
                        ? 'broken (click to fix)'
                        : s.pred + ' (click to break)'
                      : s.pred}
                  </span>
                  <span className="te__svc-state">{svcStateLabel(s)}</span>
                </motion.button>
              ))}
            </div>
          </div>
        </div>

        <div className="te__gauges">
          <div className="te__gauge">
            <div className="te__gauge-name">p50</div>
            <div className="te__gauge-val">
              {p50}
              <span className="te__gauge-unit">ms</span>
            </div>
          </div>
          <div className={`te__gauge te__gauge--p99${breach ? ' te__gauge--breach' : ''}`}>
            <div className="te__gauge-name">p99</div>
            <div className="te__gauge-val">
              {p99}
              <span className="te__gauge-unit">ms</span>
            </div>
          </div>
          <div className="te__gauge">
            <div className="te__gauge-name">max</div>
            <div className="te__gauge-val">
              {maxMs}
              <span className="te__gauge-unit">ms</span>
            </div>
          </div>
          <div className="te__gauge">
            <div className="te__gauge-name">target</div>
            <div className="te__gauge-val">
              &lt;{P99_TARGET}
              <span className="te__gauge-unit">ms p99</span>
            </div>
          </div>
        </div>

        <div className={`te__dlq${dlq.length ? ' te__dlq--armed' : ''}`}>
          <div className="te__dlq-head">
            DeadLetterQueue
            <span className="te__dlq-count">
              {dlq.length} queued for replay
            </span>
          </div>
          <div className="te__dlq-list">
            <AnimatePresence>
              {dlq.length === 0 ? (
                <span className="te__dlq-empty">
                  empty: no failed consumers
                </span>
              ) : (
                dlq.map((d, i) => (
                  <motion.span
                    key={`${d.id}-${i}`}
                    className="te__dlq-item"
                    initial={{ opacity: 0, y: reduce ? 0 : 8, scale: reduce ? 1 : 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35, ease }}
                  >
                    alerting <b>{d.symbol}</b> #{d.id}
                  </motion.span>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>

        <AnimatePresence>
          {done && (
            <motion.div
              className={`te__verdict${breach ? ' te__verdict--breach' : ''}`}
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="te__verdict-head">
                {breach
                  ? `p99 ${p99}ms over the ${P99_TARGET}ms gate`
                  : `p99 ${p99}ms under the ${P99_TARGET}ms gate`}
              </span>
              <span className="te__verdict-text">
                {failing
                  ? `The alerting consumer failed in isolation: its tick went to the DLQ for replay while risk-engine, pnl-attribution, compliance, and ui-dashboard kept their deliveries. The CLI exits non-zero when p99 misses the gate, so CI catches it.`
                  : `All matching consumers were notified. The p99 path is dominated by the ${COPY_MS}ms Postgres COPY and the ${REDIS_MS}ms Redis SET, and the CLI exits non-zero if that p99 ever crosses ${P99_TARGET}ms.`}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Running…' : 'Run pipeline'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={resetRun}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {ticks.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => pickTick(i)}
              aria-pressed={i === tickIdx}
              style={{
                font: 'inherit',
                cursor: running ? 'not-allowed' : 'pointer',
                background: 'none',
                border: 'none',
                padding: '0 6px',
                color: i === tickIdx ? 'var(--accent)' : 'var(--text-faint)',
              }}
            >
              {t.symbol}
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}
