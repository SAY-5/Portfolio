import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './edgemesh.css';

// Real numbers from the chaos suite: 200/200 scenarios passed, 16,000 RPCs
// with 15,764 succeeded and 236 classified failures, 0 LB invariant
// violations. Convergence p50/p95/max was 1/8/9 ms across the run, well
// under the 2-second edge deadline. Steady-state call benchmark sits at
// 5,511 ns/op with 7 allocs/op on an Apple M2 Pro.
const NODE_COUNT = 12;
const DEADLINE_MS = 2000;
const CONV_P50 = 1;
const CONV_P95 = 8;
const CONV_MAX = 9;
const BENCH_NS = 5511;
const TOTAL_RPCS = 16000;
const SUCCEEDED = 15764;
const FAILURES = 236;

type Health = 'healthy' | 'unhealthy';
type Node = { id: number; x: number; y: number };

// Twelve peers laid out on a ring around a central caller. The caller owns the
// outbound RPC path and load-balances across whichever peers are healthy.
const RADIUS = 118;
const CX = 160;
const CY = 160;
const nodes: Node[] = Array.from({ length: NODE_COUNT }, (_, i) => {
  const angle = (i / NODE_COUNT) * Math.PI * 2 - Math.PI / 2;
  return {
    id: i,
    x: CX + Math.cos(angle) * RADIUS,
    y: CY + Math.sin(angle) * RADIUS,
  };
});

const ease = [0.22, 1, 0.36, 1] as const;

export default function EdgemeshDemo() {
  const reduce = useReducedMotion();
  const [health, setHealth] = useState<Health[]>(
    () => Array<Health>(NODE_COUNT).fill('healthy'),
  );
  const [target, setTarget] = useState(0);
  const [converging, setConverging] = useState(false);
  const [convMs, setConvMs] = useState<number | null>(null);
  const [sent, setSent] = useState(0);
  const [rerouted, setRerouted] = useState(0);
  const rrCursorRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);

  const healthyIds = nodes.filter((n) => health[n.id] === 'healthy').map((n) => n.id);

  const clearTimers = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (tickRef.current !== null) clearInterval(tickRef.current);
    rafRef.current = null;
    tickRef.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // Pick the next healthy peer round-robin, skipping unhealthy ones. This is the
  // visible reroute: the caller never sends to a peer it has marked down.
  const stepTraffic = useCallback(() => {
    const ids = nodes
      .filter((n) => health[n.id] === 'healthy')
      .map((n) => n.id);
    if (ids.length === 0) {
      setTarget(-1);
      return;
    }
    const cursor = rrCursorRef.current;
    const next = ids[(cursor + 1) % ids.length];
    rrCursorRef.current = (cursor + 1) % ids.length;
    setTarget(next);
    setSent((s) => s + 1);
  }, [health]);

  // Drive steady-state traffic so the mesh always looks alive.
  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(stepTraffic, 620);
    return () => window.clearInterval(id);
  }, [stepTraffic, reduce]);

  function toggleNode(id: number) {
    const wasHealthy = health[id] === 'healthy';
    setHealth((h) => {
      const copy = h.slice();
      copy[id] = wasHealthy ? 'unhealthy' : 'healthy';
      return copy;
    });
    // A peer flipping down forces the balancer to reconverge its routing table.
    runConvergence();
    if (wasHealthy && target === id) {
      // Caller was about to hit this peer; count the reroute around it.
      setRerouted((r) => r + 1);
    }
  }

  // Race the convergence timer against the 2-second edge deadline. The real
  // suite lands at p95 8ms, so the bar barely moves before it settles.
  function runConvergence() {
    clearTimers();
    setConverging(true);
    setConvMs(null);

    if (reduce) {
      setConvMs(CONV_P95);
      setConverging(false);
      return;
    }

    const settleAt = CONV_P50 + Math.random() * (CONV_MAX - CONV_P50);
    // Compress the real millisecond timing into a readable ~700ms sweep.
    const visualMs = 700;
    const start = performance.now();
    const tick = (now: number) => {
      const t = now - start;
      const p = Math.min(1, t / visualMs);
      setConvMs(+(settleAt * easeOut(p)).toFixed(1));
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setConvMs(+settleAt.toFixed(1));
        setConverging(false);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function injectPartition() {
    // Drop three peers at once: an asymmetric partition the suite models.
    const downCount = Math.min(3, healthyIds.length - 1);
    if (downCount <= 0) return;
    const pick = healthyIds.slice(0, downCount);
    setHealth((h) => {
      const copy = h.slice();
      pick.forEach((id) => (copy[id] = 'unhealthy'));
      return copy;
    });
    setRerouted((r) => r + downCount);
    runConvergence();
  }

  function reset() {
    clearTimers();
    setHealth(Array<Health>(NODE_COUNT).fill('healthy'));
    setTarget(0);
    rrCursorRef.current = 0;
    setConverging(false);
    setConvMs(null);
    setSent(0);
    setRerouted(0);
  }

  const healthyCount = healthyIds.length;
  const deadlinePct =
    convMs === null ? 0 : Math.min(100, (convMs / DEADLINE_MS) * 100);
  const targetNode = target >= 0 ? nodes[target] : null;
  const targetHealthy = target >= 0 && health[target] === 'healthy';

  return (
    <div className="demo" aria-label="edgemesh load balancing demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Reroute around a dead peer</h3>
      <p className="demo__lede">
        The caller load-balances gRPC across twelve edge peers. Click a peer to
        flip it down, or inject a partition, and watch the balancer skip the
        unhealthy peers while the convergence timer races the 2-second edge
        deadline.
      </p>

      <div className="em__stage">
        <div className="em__graph">
          <svg
            className="em__svg"
            viewBox="0 0 320 320"
            role="group"
            aria-label="mesh of twelve peers around a caller"
          >
            <defs>
              <radialGradient id="em-core" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="var(--accent-soft)" />
                <stop offset="100%" stopColor="var(--accent)" />
              </radialGradient>
            </defs>

            {/* idle edges to every healthy peer */}
            {nodes.map((n) => {
              const ok = health[n.id] === 'healthy';
              return (
                <line
                  key={`edge-${n.id}`}
                  x1={CX}
                  y1={CY}
                  x2={n.x}
                  y2={n.y}
                  stroke={ok ? 'var(--line)' : 'transparent'}
                  strokeWidth={1}
                  strokeDasharray="3 4"
                />
              );
            })}

            {/* active traffic edge to the current target */}
            {targetNode && targetHealthy && (
              <motion.line
                key={`active-${target}-${sent}`}
                x1={CX}
                y1={CY}
                x2={targetNode.x}
                y2={targetNode.y}
                stroke="var(--accent)"
                strokeWidth={2}
                initial={{ pathLength: reduce ? 1 : 0, opacity: 0.9 }}
                animate={{ pathLength: 1, opacity: [0.9, 0.3] }}
                transition={{ duration: reduce ? 0 : 0.5, ease }}
              />
            )}

            {/* the caller core */}
            <circle cx={CX} cy={CY} r={20} fill="url(#em-core)" />
            <text x={CX} y={CY + 4} textAnchor="middle" className="em__core-label">
              caller
            </text>

            {/* peer nodes */}
            {nodes.map((n) => {
              const ok = health[n.id] === 'healthy';
              const isTarget = n.id === target && ok;
              return (
                <g
                  key={n.id}
                  className="em__peer"
                  role="button"
                  tabIndex={0}
                  aria-pressed={!ok}
                  aria-label={`Peer ${n.id + 1}, ${ok ? 'healthy' : 'unhealthy'}. Toggle health.`}
                  onClick={() => toggleNode(n.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleNode(n.id);
                    }
                  }}
                >
                  <motion.circle
                    cx={n.x}
                    cy={n.y}
                    r={isTarget ? 13 : 11}
                    fill={ok ? 'var(--ink-700)' : 'var(--ink-850)'}
                    stroke={
                      ok
                        ? isTarget
                          ? 'var(--accent)'
                          : 'rgba(79, 208, 138, 0.8)'
                        : 'var(--accent-line)'
                    }
                    strokeWidth={isTarget ? 2.5 : 1.5}
                    animate={
                      isTarget && !reduce
                        ? { scale: [1, 1.18, 1] }
                        : { scale: 1 }
                    }
                    transition={{ duration: 0.45, ease }}
                  />
                  {!ok && (
                    <line
                      x1={n.x - 5}
                      y1={n.y - 5}
                      x2={n.x + 5}
                      y2={n.y + 5}
                      stroke="var(--accent)"
                      strokeWidth={1.5}
                    />
                  )}
                  <text
                    x={n.x}
                    y={n.y + 3}
                    textAnchor="middle"
                    className="em__peer-label"
                  >
                    {n.id + 1}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="em__panel">
          <div className="em__conv">
            <div className="em__conv-head">
              <span className="em__conv-name">Convergence</span>
              <span className="em__conv-val">
                {convMs === null ? '0.0' : convMs.toFixed(1)}
                <span className="em__conv-unit">ms</span>
              </span>
            </div>
            <div
              className="em__deadline"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={DEADLINE_MS}
              aria-valuenow={convMs ?? 0}
              aria-label="convergence against 2 second deadline"
            >
              <motion.div
                className="em__deadline-fill"
                animate={{ width: `${Math.max(deadlinePct, convMs ? 1.5 : 0)}%` }}
                transition={{ duration: reduce ? 0 : 0.2, ease }}
              />
              <span className="em__deadline-tick">2,000 ms deadline</span>
            </div>
            <div className="em__conv-meta">
              {converging
                ? 'rebuilding routing table'
                : convMs === null
                  ? 'settled, p95 8 ms across the chaos run'
                  : `settled in ${convMs.toFixed(1)} ms, ${Math.round(DEADLINE_MS / Math.max(convMs, 0.1))}x under deadline`}
            </div>
          </div>

          <div className="em__stats">
            <div className="em__stat">
              <span className="em__stat-val">{healthyCount}</span>
              <span className="em__stat-unit">healthy peers</span>
            </div>
            <div className="em__stat">
              <span className="em__stat-val">{sent}</span>
              <span className="em__stat-unit">RPCs sent</span>
            </div>
            <div className="em__stat">
              <span className="em__stat-val em__stat-val--accent">{rerouted}</span>
              <span className="em__stat-unit">reroutes</span>
            </div>
          </div>

          <ul className="em__facts">
            <li>
              <b>{BENCH_NS.toLocaleString()} ns/op</b> steady-state call, 7
              allocs/op on M2 Pro
            </li>
            <li>
              <b>
                {SUCCEEDED.toLocaleString()}/{TOTAL_RPCS.toLocaleString()}
              </b>{' '}
              RPCs succeeded, {FAILURES} classified failures
            </li>
            <li>
              <b>0</b> load-balancer invariant violations over 200/200 scenarios
            </li>
          </ul>
        </div>

        <AnimatePresence>
          {healthyCount <= 6 && (
            <motion.div
              className="em__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease }}
            >
              <span className="em__verdict-head">
                {healthyCount} of {NODE_COUNT} peers up
              </span>
              <span className="em__verdict-text">
                Traffic stays on the live peers only. The balancer reconverged
                in single-digit milliseconds, the same window the 12-node chaos
                suite holds across all 200 scenarios.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={injectPartition}>
          Inject partition
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset mesh
        </button>
        <span className="demo__hint">
          {convMs === null
            ? 'p50 1 ms / p95 8 ms / max 9 ms'
            : `last converge ${convMs.toFixed(1)} ms`}
        </span>
      </div>
    </div>
  );
}

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
}
