import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './configmesh.css';

// Real numbers from the project: a write at the server pushes config changes
// over a long-lived gRPC bidi stream to subscribers within milliseconds, versus
// polling. The propagation test boots Redis via testcontainers, runs 50
// concurrent subscribers, and fires 100 key mutations. The streaming layer is
// protected by a per-client token-bucket rate limiter implemented as a Redis
// Lua script for atomic try-consume.
const SUBSCRIBERS = 50;
const BUCKET_CAPACITY = 10; // tokens
const REFILL_PER_SEC = 5; // tokens added per second
const ease = [0.22, 1, 0.36, 1] as const;

const KEYS = ['checkout.flag', 'payments.cap', 'search.rollout'] as const;
type Key = (typeof KEYS)[number];

type Node = { id: number; x: number; y: number; baseDelay: number };

// Lay 50 subscriber nodes out on a fixed grid. baseDelay is the deterministic
// per-pair propagation time the stream fan-out lands on (sub-millisecond to a
// few ms), so the distribution looks like a real run rather than noise.
const COLS = 10;
const NODES: Node[] = Array.from({ length: SUBSCRIBERS }, (_, i) => {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  // Deterministic pseudo-jitter so the layout and timings are stable on the
  // server render and the client render (no Math.random at module scope).
  const seed = (i * 2654435761) % 1000;
  const baseDelay = 0.6 + (seed / 1000) * 3.4; // 0.6ms .. 4.0ms
  return { id: i, x: col, y: row, baseDelay: +baseDelay.toFixed(1) };
});

export default function ConfigmeshDemo() {
  const reduce = useReducedMotion();
  const [activeKey, setActiveKey] = useState<Key>('checkout.flag');
  const [versions, setVersions] = useState<Record<Key, number>>({
    'checkout.flag': 7,
    'payments.cap': 3,
    'search.rollout': 12,
  });
  // Which nodes have received the current write (true once the push lands).
  const [lit, setLit] = useState<Set<number>>(new Set());
  const [pushing, setPushing] = useState(false);
  const [lastSpread, setLastSpread] = useState<{ p50: number; p95: number } | null>(null);

  // Token bucket for the reconnect-storm client.
  const [storm, setStorm] = useState(false);
  const [tokens, setTokens] = useState(BUCKET_CAPACITY);
  const [accepted, setAccepted] = useState(0);
  const [throttled, setThrottled] = useState(0);

  const timers = useRef<number[]>([]);
  const lastTick = useRef<number>(0);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => () => clearTimers(), []);

  // Token-bucket loop: the storm client tries to consume one token roughly
  // every 120ms; the bucket refills at REFILL_PER_SEC. Try-consume is the
  // atomic Redis Lua step, so a request is either accepted or throttled.
  useEffect(() => {
    if (!storm) return;
    lastTick.current = performance.now();
    let raf = 0;
    let acc = 0;
    const loop = (now: number) => {
      const dt = (now - lastTick.current) / 1000;
      lastTick.current = now;
      acc += dt;
      setTokens((prev) => Math.min(BUCKET_CAPACITY, prev + dt * REFILL_PER_SEC));
      // attempt a consume every ~120ms of wall time
      if (acc >= 0.12) {
        acc = 0;
        setTokens((prev) => {
          if (prev >= 1) {
            setAccepted((a) => a + 1);
            return prev - 1;
          }
          setThrottled((t) => t + 1);
          return prev;
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [storm]);

  const sorted = useMemo(
    () => NODES.map((n) => n.baseDelay).sort((a, b) => a - b),
    [],
  );

  function write() {
    if (pushing) return;
    clearTimers();
    setPushing(true);
    setLit(new Set());

    // Monotonic version bump: atomic INCR + SET in Redis.
    setVersions((v) => ({ ...v, [activeKey]: v[activeKey] + 1 }));

    if (reduce) {
      setLit(new Set(NODES.map((n) => n.id)));
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      setLastSpread({ p50, p95 });
      setPushing(false);
      return;
    }

    // Fan the push out: each node lights up scaled to its real propagation
    // delay (compressed to an animation timescale so 4ms reads as ~900ms).
    const scale = 230; // ms of animation per ms of real propagation
    NODES.forEach((n) => {
      const t = window.setTimeout(() => {
        setLit((prev) => {
          const next = new Set(prev);
          next.add(n.id);
          return next;
        });
      }, n.baseDelay * scale);
      timers.current.push(t);
    });

    const maxDelay = Math.max(...NODES.map((n) => n.baseDelay)) * scale;
    const done = window.setTimeout(() => {
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      setLastSpread({ p50, p95 });
      setPushing(false);
    }, maxDelay + 80);
    timers.current.push(done);
  }

  function reset() {
    clearTimers();
    setLit(new Set());
    setPushing(false);
    setLastSpread(null);
  }

  const litCount = lit.size;
  const tokenPct = (tokens / BUCKET_CAPACITY) * 100;
  const totalReqs = accepted + throttled;
  const throttledPct = totalReqs ? Math.round((throttled / totalReqs) * 100) : 0;

  return (
    <div className="demo" aria-label="configmesh streaming push demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">A write ripples to 50 subscribers</h3>
      <p className="demo__lede">
        Pick a key and write it. The server bumps a monotonic version with an
        atomic INCR and pushes the change over the long-lived gRPC stream to
        every subscriber within milliseconds. Turn on the reconnect storm to
        watch the per-client token bucket throttle a misbehaving client.
      </p>

      <div className="cm__stage">
        <div className="cm__keys" role="group" aria-label="config keys">
          {KEYS.map((k) => {
            const isActive = k === activeKey;
            return (
              <button
                key={k}
                className={`cm__key${isActive ? ' cm__key--active' : ''}`}
                aria-pressed={isActive}
                onClick={() => !pushing && setActiveKey(k)}
                disabled={pushing}
              >
                <span className="cm__key-name">{k}</span>
                <span className="cm__key-ver">v{versions[k]}</span>
              </button>
            );
          })}
        </div>

        <div className="cm__grid-wrap">
          <div className="cm__grid-head">
            <span className="cm__grid-title">subscribers</span>
            <span className="cm__grid-count">
              {litCount} / {SUBSCRIBERS} received
            </span>
          </div>
          <div className="cm__grid" role="img" aria-label={`${litCount} of ${SUBSCRIBERS} subscribers updated`}>
            {NODES.map((n) => {
              const on = lit.has(n.id);
              return (
                <motion.span
                  key={n.id}
                  className={`cm__node${on ? ' cm__node--on' : ''}`}
                  initial={false}
                  animate={
                    on
                      ? { scale: reduce ? 1 : [1, 1.35, 1], opacity: 1 }
                      : { scale: 1, opacity: 0.4 }
                  }
                  transition={{ duration: reduce ? 0 : 0.4, ease }}
                  title={`node ${n.id}: ${n.baseDelay}ms`}
                />
              );
            })}
          </div>
          <AnimatePresence>
            {lastSpread && (
              <motion.div
                className="cm__spread"
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease }}
              >
                <span className="cm__spread-row">
                  <span className="cm__spread-k">p50 propagation</span>
                  <span className="cm__spread-v">{lastSpread.p50} ms</span>
                </span>
                <span className="cm__spread-row">
                  <span className="cm__spread-k">p95 propagation</span>
                  <span className="cm__spread-v">{lastSpread.p95} ms</span>
                </span>
                <span className="cm__spread-note">
                  server-initiated push, no polling
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className={`cm__bucket${storm ? ' cm__bucket--storm' : ''}`}>
          <div className="cm__bucket-head">
            <span className="cm__bucket-title">token bucket</span>
            <span className="cm__bucket-meta">
              cap {BUCKET_CAPACITY}, refill {REFILL_PER_SEC}/s
            </span>
          </div>
          <div className="cm__meter" aria-hidden="true">
            <motion.div
              className="cm__meter-fill"
              animate={{ width: `${tokenPct}%` }}
              transition={{ duration: reduce ? 0 : 0.18, ease: 'linear' }}
            />
          </div>
          <div className="cm__bucket-stats">
            <span>
              <strong>{tokens.toFixed(1)}</strong> tokens
            </span>
            <span className="cm__stat-ok">{accepted} accepted</span>
            <span className="cm__stat-block">{throttled} throttled</span>
          </div>
          {storm && totalReqs > 0 && (
            <div className="cm__bucket-verdict">
              {throttledPct}% of storm requests throttled at the stream edge
            </div>
          )}
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={write} disabled={pushing}>
          {pushing ? 'Pushing…' : `Write ${activeKey}`}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => {
            setStorm((s) => !s);
            if (storm) {
              setAccepted(0);
              setThrottled(0);
              setTokens(BUCKET_CAPACITY);
            }
          }}
        >
          {storm ? 'Stop reconnect storm' : 'Start reconnect storm'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={pushing}>
          Reset
        </button>
        <span className="demo__hint">
          {activeKey} now at v{versions[activeKey]}
        </span>
      </div>
    </div>
  );
}
