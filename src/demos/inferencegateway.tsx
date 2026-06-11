import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './inferencegateway.css';

// Four backend replicas with live in-flight counters. The dispatch thread
// pulls a request and a stateless routing policy picks a backend from a
// snapshot of the per-backend inflight counters. Power-of-two-choices samples
// two backends and routes to the lighter one. A histogram tracks enqueue-to-
// dispatch overhead against the p99 <= 10 ms scheduler objective.

type Policy = 'p2c' | 'least' | 'round' | 'random';

const POLICIES: { id: Policy; label: string }[] = [
  { id: 'p2c', label: 'power of two' },
  { id: 'least', label: 'least loaded' },
  { id: 'round', label: 'round robin' },
  { id: 'random', label: 'random' },
];

const BACKENDS = ['be-0', 'be-1', 'be-2', 'be-3'];
const SLO_MS = 10; // p99 <= 10 ms enqueue-to-dispatch objective

// Eight histogram buckets in ms; bucket index 5 sits at the 10 ms SLO line.
const BUCKETS = [1, 2, 4, 6, 8, 10, 14, 20];
const ease = [0.22, 1, 0.36, 1] as const;

function emptyHist() {
  return BUCKETS.map(() => 0);
}

export default function InferencegatewayDemo() {
  const reduce = useReducedMotion();
  const [policy, setPolicy] = useState<Policy>('p2c');
  const [inflight, setInflight] = useState<number[]>([2, 5, 1, 3]);
  const [hist, setHist] = useState<number[]>(emptyHist());
  const [probed, setProbed] = useState<number[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [dispatched, setDispatched] = useState(0);
  const [running, setRunning] = useState(false);
  const rrRef = useRef(0);
  const interval = useRef<number | null>(null);
  const inflightRef = useRef(inflight);
  useEffect(() => {
    inflightRef.current = inflight;
  }, [inflight]);

  function stop() {
    if (interval.current !== null) window.clearInterval(interval.current);
    interval.current = null;
    setRunning(false);
    setProbed([]);
    setPicked(null);
  }

  useEffect(() => stop, []);

  function reset() {
    stop();
    setInflight([2, 5, 1, 3]);
    setHist(emptyHist());
    setDispatched(0);
    rrRef.current = 0;
  }

  // Choose a backend index per the active policy over a snapshot of inflight.
  function choose(snapshot: number[]): { pick: number; probes: number[] } {
    if (policy === 'least') {
      let best = 0;
      for (let i = 1; i < snapshot.length; i += 1) {
        if (snapshot[i] < snapshot[best]) best = i;
      }
      return { pick: best, probes: [] };
    }
    if (policy === 'round') {
      const pick = rrRef.current % snapshot.length;
      rrRef.current += 1;
      return { pick, probes: [] };
    }
    if (policy === 'random') {
      return { pick: Math.floor(Math.random() * snapshot.length), probes: [] };
    }
    // power of two choices: sample two distinct, route to the lighter one
    const a = Math.floor(Math.random() * snapshot.length);
    let b = Math.floor(Math.random() * snapshot.length);
    if (b === a) b = (b + 1) % snapshot.length;
    const pick = snapshot[a] <= snapshot[b] ? a : b;
    return { pick, probes: [a, b] };
  }

  // Dispatch overhead in ms, weighted toward the low buckets at this load. A
  // lighter pick keeps overhead under the 10 ms line more often.
  function overheadMs(load: number): number {
    const base = 1 + Math.random() * 4;
    const pressure = load > 6 ? Math.random() * 12 : Math.random() * 4;
    return base + pressure;
  }

  function bucketOf(ms: number): number {
    for (let i = 0; i < BUCKETS.length; i += 1) {
      if (ms <= BUCKETS[i]) return i;
    }
    return BUCKETS.length - 1;
  }

  function step() {
    const snapshot = inflightRef.current;
    const { pick, probes } = choose(snapshot);
    setProbed(probes);
    setPicked(pick);

    const ms = overheadMs(snapshot[pick]);
    setHist((h) => {
      const next = h.slice();
      next[bucketOf(ms)] += 1;
      return next;
    });
    setDispatched((d) => d + 1);

    // The picked backend gains an in-flight request; others drain a little as
    // earlier requests complete, keeping the counters live.
    setInflight((cur) =>
      cur.map((v, i) => {
        if (i === pick) return v + 1;
        return Math.max(0, v - (Math.random() < 0.5 ? 1 : 0));
      }),
    );
  }

  function toggleRun() {
    if (running) {
      stop();
      return;
    }
    setRunning(true);
    step();
    interval.current = window.setInterval(step, reduce ? 1 : 900);
  }

  const totalHist = hist.reduce((a, b) => a + b, 0);
  const maxHist = Math.max(1, ...hist);
  // p99 over recorded samples: highest bucket holding the top 1% tail.
  let p99 = 0;
  if (totalHist > 0) {
    let cum = 0;
    const target = totalHist * 0.99;
    for (let i = 0; i < hist.length; i += 1) {
      cum += hist[i];
      if (cum >= target) {
        p99 = BUCKETS[i];
        break;
      }
    }
  }
  const maxInflight = Math.max(1, ...inflight, 8);

  return (
    <div className="demo" aria-label="inferencegateway routing demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Load-aware dispatch across replicas</h3>
      <p className="demo__lede">
        The dispatch thread pulls each request and a stateless policy picks a
        backend from a snapshot of in-flight counters. Power of two samples two
        replicas and routes to the lighter one. The histogram tracks enqueue to
        dispatch overhead against the p99 under 10 ms objective.
      </p>

      <div className="ig__stage">
        <div className="ig__policies" role="group" aria-label="routing policy">
          {POLICIES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`ig__policy${policy === p.id ? ' ig__policy--on' : ''}`}
              onClick={() => {
                setPolicy(p.id);
                setProbed([]);
                setPicked(null);
                rrRef.current = 0;
              }}
              aria-pressed={policy === p.id}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="ig__backends">
          {BACKENDS.map((name, i) => {
            const isProbed = probed.includes(i);
            const isPicked = picked === i;
            const cls = isPicked
              ? 'ig__backend ig__backend--picked'
              : isProbed
                ? 'ig__backend ig__backend--probed'
                : 'ig__backend';
            return (
              <motion.div
                key={name}
                className={cls}
                animate={{ scale: isPicked && !reduce ? 1.03 : 1 }}
                transition={{ duration: reduce ? 0 : 0.25, ease }}
              >
                {isPicked && <span className="ig__backend-flag ig__backend-flag--pick">picked</span>}
                {!isPicked && isProbed && (
                  <span className="ig__backend-flag ig__backend-flag--probe">probed</span>
                )}
                <div className="ig__backend-name">{name}</div>
                <div className="ig__backend-inflight">{inflight[i]}</div>
                <div className="ig__backend-unit">in flight</div>
                <div className="ig__backend-bar">
                  <motion.div
                    className="ig__backend-fill"
                    animate={{ width: `${Math.min(100, (inflight[i] / maxInflight) * 100)}%` }}
                    transition={{ duration: reduce ? 0 : 0.4, ease }}
                  />
                </div>
              </motion.div>
            );
          })}
        </div>

        <div className="ig__hist-wrap">
          <div className="ig__hist-head">
            <span>dispatch overhead</span>
            <span className="ig__hist-p99">p99 {p99 ? `${p99} ms` : '--'}</span>
          </div>
          <div className="ig__hist">
            {/* SLO line sits between bucket index 5 (10 ms) and 6 */}
            <div className="ig__hist-slo" style={{ left: 'calc(75% - 1px)' }}>
              <span className="ig__hist-slo-tag">10 ms p99</span>
            </div>
            {hist.map((count, i) => {
              const over = BUCKETS[i] > SLO_MS;
              return (
                <div className="ig__hist-col" key={BUCKETS[i]}>
                  <motion.div
                    className={`ig__hist-bar${over ? ' ig__hist-bar--over' : ''}`}
                    animate={{ height: `${(count / maxHist) * 86}%` }}
                    transition={{ duration: reduce ? 0 : 0.35, ease }}
                  />
                  <span className="ig__hist-label">{BUCKETS[i]}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="ig__stats">
          <div className="ig__stat">
            <span className="ig__stat-val">{dispatched}</span>
            <span className="ig__stat-label">requests dispatched</span>
          </div>
          <div className="ig__stat">
            <span className="ig__stat-val">{inflight.reduce((a, b) => a + b, 0)}</span>
            <span className="ig__stat-label">total in flight</span>
          </div>
          <div className="ig__stat">
            <span className="ig__stat-val">{policy === 'p2c' ? '2' : '1'}</span>
            <span className="ig__stat-label">probes per pick</span>
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={toggleRun}>
          {running ? 'Pause traffic' : 'Send traffic'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={step} disabled={running}>
          Step one
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={running}>
          Reset
        </button>
        <span className="demo__hint">
          {POLICIES.find((p) => p.id === policy)!.label} over an inflight snapshot
        </span>
      </div>
    </div>
  );
}
