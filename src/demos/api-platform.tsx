import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './api-platform.css';

// Sliding-window rate limiting backed by a Redis sorted set. Each request is
// a member scored by timestamp; entries older than the window are evicted,
// then the set cardinality is compared against the tier limit inside one
// atomic Lua script. Admitted requests increment a daily usage counter
// (Redis HINCRBY) that drains to Postgres with INSERT ON CONFLICT DO UPDATE.
//
// Real numbers from the project: a single-process Fastify run measured
// 1,963 req/s with p50 3 ms and p95 18 ms on GET /v1/echo, and a free-tier
// burst test admitted 84 and rejected 65,209 requests with 429 + Retry-After.
const WINDOW_MS = 1000; // one second sliding window
const P50_MS = 3;
const P95_MS = 18;

type Tier = { id: string; name: string; limit: number };
const TIERS: Tier[] = [
  { id: 'free', name: 'free', limit: 5 },
  { id: 'pro', name: 'pro', limit: 12 },
  { id: 'scale', name: 'scale', limit: 24 },
];

type Entry = { id: number; score: number; admitted: boolean };

const ease = [0.22, 1, 0.36, 1] as const;

export default function ApiPlatformDemo() {
  const reduce = useReducedMotion();
  const [tierId, setTierId] = useState('free');
  const [rate, setRate] = useState(9); // requests per second the client sends
  const [running, setRunning] = useState(false);
  const [now, setNow] = useState(0); // virtual clock in ms
  const [entries, setEntries] = useState<Entry[]>([]);
  const [admitted, setAdmitted] = useState(0);
  const [rejected, setRejected] = useState(0);
  const [daily, setDaily] = useState(0);
  const [flushed, setFlushed] = useState(0);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  const tier = TIERS.find((t) => t.id === tierId)!;
  const tickRef = useRef<number | null>(null);
  const idRef = useRef(0);
  const stateRef = useRef({ now: 0, entries: [] as Entry[], rate, limit: tier.limit });
  stateRef.current.rate = rate;
  stateRef.current.limit = tier.limit;

  function stop() {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }
  useEffect(() => stop, []);

  // Advance the virtual clock by one step, attempt one request, and evict any
  // sorted-set members older than the window.
  function advance() {
    const step = 1000 / stateRef.current.rate; // ms between requests
    const t = stateRef.current.now + step;
    stateRef.current.now = t;

    // Evict entries that have slid out of the window.
    const live = stateRef.current.entries.filter((e) => e.score > t - WINDOW_MS);
    const inWindow = live.filter((e) => e.admitted).length;
    const limit = stateRef.current.limit;

    idRef.current += 1;
    const admit = inWindow < limit;
    const entry: Entry = { id: idRef.current, score: t, admitted: admit };
    const nextEntries = [...live, entry].slice(-40);
    stateRef.current.entries = nextEntries;

    setNow(Math.round(t));
    setEntries(nextEntries);
    if (admit) {
      setAdmitted((a) => a + 1);
      setDaily((d) => d + 1);
      setRetryAfter(null);
    } else {
      setRejected((r) => r + 1);
      // Retry-After: time until the oldest admitted entry leaves the window.
      const oldest = live
        .filter((e) => e.admitted)
        .reduce((m, e) => Math.min(m, e.score), t);
      setRetryAfter(Math.max(0, Math.ceil((oldest + WINDOW_MS - t) / 1000)));
    }
  }

  function play() {
    if (running) return;
    setRunning(true);
    if (reduce) {
      for (let i = 0; i < 24; i += 1) advance();
      setRunning(false);
      return;
    }
    tickRef.current = window.setInterval(advance, 240);
  }
  function pause() {
    stop();
    setRunning(false);
  }
  function reset() {
    stop();
    setRunning(false);
    idRef.current = 0;
    stateRef.current = { now: 0, entries: [], rate, limit: tier.limit };
    setNow(0);
    setEntries([]);
    setAdmitted(0);
    setRejected(0);
    setDaily(0);
    setFlushed(0);
    setRetryAfter(null);
  }
  function flush() {
    // Idempotent flush: drain the daily counter into Postgres, then the Redis
    // key is cleared. Re-running with nothing buffered is a no-op.
    setFlushed((f) => f + daily);
    setDaily(0);
  }

  const live = entries.filter((e) => e.score > now - WINDOW_MS);
  const liveAdmitted = live.filter((e) => e.admitted).length;
  const total = admitted + rejected;
  const rejectPct = total > 0 ? Math.round((rejected / total) * 100) : 0;
  const fill = Math.min(1, liveAdmitted / tier.limit);

  return (
    <div className="demo" aria-label="api-platform rate limiter demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Sliding-window rate limiter</h3>
      <p className="demo__lede">
        Every request is a member in a Redis sorted set scored by timestamp.
        Entries older than the {WINDOW_MS / 1000}s window are evicted, then the
        in-window count is checked against the tier limit. Over the limit returns
        429 with Retry-After. Admitted calls accumulate a daily counter that
        flushes to Postgres.
      </p>

      <div className="ap__stage">
        <div className="ap__controls-row">
          <div
            className="ap__tiers"
            role="group"
            aria-label="Rate limit tier"
          >
            {TIERS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`ap__tier${t.id === tierId ? ' ap__tier--on' : ''}`}
                aria-pressed={t.id === tierId}
                onClick={() => setTierId(t.id)}
              >
                {t.name}
                <span className="ap__tier-lim">{t.limit}/s</span>
              </button>
            ))}
          </div>
          <label className="ap__rate">
            <span className="ap__rate-label">
              client rate <b>{rate}/s</b>
            </span>
            <input
              type="range"
              min={1}
              max={20}
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
              className="ap__slider"
              aria-label="Client request rate per second"
            />
          </label>
        </div>

        <div className="ap__window" aria-hidden="true">
          <div className="ap__window-head">
            <span>redis sorted set</span>
            <span className="ap__window-count">
              {liveAdmitted}/{tier.limit} in window
            </span>
          </div>
          <div className="ap__track">
            <div
              className="ap__capacity"
              style={{
                background:
                  fill >= 1
                    ? 'rgba(255, 91, 41, 0.16)'
                    : 'rgba(79, 208, 138, 0.1)',
              }}
            />
            <AnimatePresence initial={false}>
              {live.map((e) => {
                const age = (now - e.score) / WINDOW_MS; // 0 fresh .. 1 leaving
                const left = `${Math.max(0, Math.min(100, (1 - age) * 100))}%`;
                return (
                  <motion.span
                    key={e.id}
                    className={`ap__bucket ap__bucket--${
                      e.admitted ? 'ok' : 'rej'
                    }`}
                    style={{ left }}
                    initial={{
                      opacity: 0,
                      scale: reduce ? 1 : 0.4,
                      y: reduce ? 0 : -14,
                    }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: reduce ? 1 : 0.4 }}
                    transition={{ duration: reduce ? 0 : 0.28, ease }}
                  />
                );
              })}
            </AnimatePresence>
            <div className="ap__track-labels">
              <span>now</span>
              <span>-{WINDOW_MS / 1000}s (evicted)</span>
            </div>
          </div>
        </div>

        <div className="ap__meters">
          <div className="ap__meter ap__meter--ok">
            <div className="ap__meter-name">admitted</div>
            <div className="ap__meter-val">{admitted}</div>
          </div>
          <div className="ap__meter ap__meter--rej">
            <div className="ap__meter-name">rejected 429</div>
            <div className="ap__meter-val">{rejected}</div>
            <div className="ap__meter-meta">
              {retryAfter !== null
                ? `Retry-After: ${retryAfter}s`
                : `${rejectPct}% of stream`}
            </div>
          </div>
          <div className="ap__meter">
            <div className="ap__meter-name">latency p50 / p95</div>
            <div className="ap__meter-val ap__meter-val--sm">
              {P50_MS} / {P95_MS}
              <span className="ap__meter-unit">ms</span>
            </div>
            <div className="ap__meter-meta">measured 1,963 req/s</div>
          </div>
        </div>

        <div className="ap__usage">
          <div className="ap__usage-side">
            <div className="ap__usage-name">daily counter (Redis HINCRBY)</div>
            <div className="ap__usage-val">{daily}</div>
            <div className="ap__usage-bar">
              <motion.div
                className="ap__usage-fill"
                animate={{ width: `${Math.min(100, daily * 2)}%` }}
                transition={{ duration: reduce ? 0 : 0.3, ease }}
              />
            </div>
          </div>
          <div className="ap__usage-arrow" aria-hidden="true">
            flush
          </div>
          <div className="ap__usage-side ap__usage-side--pg">
            <div className="ap__usage-name">postgres (ON CONFLICT)</div>
            <div className="ap__usage-val">{flushed}</div>
            <div className="ap__usage-meta">committed rows</div>
          </div>
        </div>
      </div>

      <div className="demo__controls">
        {running ? (
          <button type="button" className="demo__btn" onClick={pause}>
            Pause
          </button>
        ) : (
          <button type="button" className="demo__btn" onClick={play}>
            Send traffic
          </button>
        )}
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={flush}
          disabled={daily === 0}
        >
          Flush to Postgres
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={reset}
        >
          Reset
        </button>
        <span className="demo__hint">
          {rate > tier.limit
            ? `${rate}/s over ${tier.limit}/s limit: expect 429s`
            : `${rate}/s within ${tier.limit}/s limit`}
        </span>
      </div>
    </div>
  );
}
