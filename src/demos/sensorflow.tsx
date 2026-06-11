import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './sensorflow.css';

// Two detectors run side by side over the same stream.
// EWMA z-score flags sudden spikes; CUSUM accumulates signed deviation from a
// baseline so a slow persistent shift that EWMA absorbs still crosses the bar.
// Baseline resets after each drift event so the next shift starts from zero.
const EWMA_ALPHA = 0.3; // smoothing for the running mean and variance
const Z_THRESHOLD = 3; // z-score above this is flagged a spike
const CUSUM_K = 0.5; // slack: deviations below this do not accumulate
const CUSUM_H = 6; // decision interval: cumulative sum above this fires drift
const BASELINE = 20; // nominal reading the stream sits at when calm

const WINDOW = 48; // points kept on screen
const W = 540;
const H = 200;

type Mode = 'calm' | 'spike' | 'drift';
type Point = { v: number; spike: boolean; i: number };

const ease = [0.22, 1, 0.36, 1] as const;

function yFor(v: number) {
  // map a reading (roughly 10..34) into chart space, inverted for SVG
  const lo = 8;
  const hi = 36;
  const t = (v - lo) / (hi - lo);
  return H - 14 - Math.max(0, Math.min(1, t)) * (H - 28);
}

export default function SensorflowDemo() {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<Mode>('calm');
  const [running, setRunning] = useState(true);
  const [points, setPoints] = useState<Point[]>([]);
  const [cusum, setCusum] = useState(0);
  const [anomalies, setAnomalies] = useState(0);
  const [drifts, setDrifts] = useState(0);
  const [lastEvent, setLastEvent] = useState<string>('stream calm');

  const meanRef = useRef(BASELINE);
  const varRef = useRef(1);
  const cusumRef = useRef(0);
  const iRef = useRef(0);
  const modeRef = useRef<Mode>('calm');
  const timer = useRef<number | null>(null);

  modeRef.current = mode;

  function nextReading(i: number): number {
    const noise = (Math.sin(i * 1.7) + Math.cos(i * 0.9)) * 0.6;
    if (modeRef.current === 'spike') {
      // an isolated jump every few ticks: EWMA catches these
      const isJump = i % 7 === 0;
      return BASELINE + noise + (isJump ? 11 : 0);
    }
    if (modeRef.current === 'drift') {
      // a slow persistent climb EWMA absorbs but CUSUM accumulates
      const ramp = Math.min(7, i * 0.22);
      return BASELINE + noise + ramp;
    }
    return BASELINE + noise;
  }

  function step() {
    const i = iRef.current++;
    const v = nextReading(i);

    // EWMA mean and variance, then z-score for the spike test
    const m = meanRef.current;
    const dev = v - m;
    const newMean = m + EWMA_ALPHA * dev;
    const newVar = (1 - EWMA_ALPHA) * (varRef.current + EWMA_ALPHA * dev * dev);
    const std = Math.sqrt(Math.max(newVar, 1e-6));
    const z = Math.abs(dev) / std;
    const spike = z > Z_THRESHOLD;
    meanRef.current = newMean;
    varRef.current = newVar;

    // CUSUM on signed deviation from the fixed baseline, one-sided upper
    const c = Math.max(0, cusumRef.current + (v - BASELINE) - CUSUM_K);
    cusumRef.current = c;

    if (spike) {
      setAnomalies((n) => n + 1);
      setLastEvent(`spike: z=${z.toFixed(1)} over baseline ${BASELINE}`);
    }

    let firedDrift = false;
    if (c >= CUSUM_H) {
      firedDrift = true;
      setDrifts((n) => n + 1);
      setLastEvent(`drift: CUSUM crossed ${CUSUM_H}, baseline reset`);
      // reset the accumulator and re-baseline so we do not double-count
      cusumRef.current = 0;
      meanRef.current = v;
    }

    setCusum(firedDrift ? 0 : c);
    setPoints((prev) => {
      const next = [...prev, { v, spike, i }];
      return next.length > WINDOW ? next.slice(next.length - WINDOW) : next;
    });
  }

  useEffect(() => {
    if (!running) {
      if (timer.current) window.clearInterval(timer.current);
      timer.current = null;
      return;
    }
    const ms = reduce ? 320 : 130;
    timer.current = window.setInterval(step, ms);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, reduce]);

  function reset() {
    meanRef.current = BASELINE;
    varRef.current = 1;
    cusumRef.current = 0;
    iRef.current = 0;
    setPoints([]);
    setCusum(0);
    setAnomalies(0);
    setDrifts(0);
    setLastEvent('stream calm');
  }

  const cusumPct = Math.min(100, (cusum / CUSUM_H) * 100);
  const near = cusumPct >= 70;

  const path = points.length
    ? points
        .map((p, idx) => {
          const x = 6 + (idx / (WINDOW - 1)) * (W - 12);
          return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${yFor(p.v).toFixed(1)}`;
        })
        .join(' ')
    : '';

  const baselineY = yFor(BASELINE);

  return (
    <div className="demo" aria-label="sensorflow streaming detection demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Two detectors on one stream</h3>
      <p className="demo__lede">
        Readings flow in left to right. EWMA z-score flags sudden spikes in the
        accent color; CUSUM accumulates signed deviation from the baseline, so a
        slow shift EWMA would absorb still fills the bar until it fires a drift
        event and the baseline resets.
      </p>

      <div className="sfl__stage">
        <div className="sfl__modes" role="group" aria-label="stream mode">
          {(['calm', 'spike', 'drift'] as Mode[]).map((m) => (
            <button
              key={m}
              className={`sfl__mode${mode === m ? ' sfl__mode--on' : ''}`}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {m === 'calm' ? 'calm' : m === 'spike' ? 'sudden spikes' : 'slow drift'}
            </button>
          ))}
        </div>

        <div className="sfl__chart">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="sfl__svg"
            role="img"
            aria-label="live sensor reading chart"
          >
            <line
              x1={6}
              x2={W - 6}
              y1={baselineY}
              y2={baselineY}
              className="sfl__baseline"
            />
            <text x={10} y={baselineY - 6} className="sfl__baseline-label">
              baseline {BASELINE}
            </text>
            {path && (
              <motion.path
                d={path}
                className="sfl__trace"
                fill="none"
                initial={false}
                transition={{ duration: reduce ? 0 : 0.12 }}
              />
            )}
            {points.map((p, idx) => {
              if (!p.spike) return null;
              const x = 6 + (idx / (WINDOW - 1)) * (W - 12);
              return (
                <motion.circle
                  key={p.i}
                  cx={x}
                  cy={yFor(p.v)}
                  r={5}
                  className="sfl__spike"
                  initial={{ scale: reduce ? 1 : 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.25, ease }}
                />
              );
            })}
          </svg>
        </div>

        <div className="sfl__cusum">
          <div className="sfl__cusum-head">
            <span>CUSUM accumulator</span>
            <span className="sfl__cusum-val">
              {cusum.toFixed(1)} / {CUSUM_H}
            </span>
          </div>
          <div className="sfl__cusum-track">
            <motion.div
              className={`sfl__cusum-fill${near ? ' sfl__cusum-fill--near' : ''}`}
              animate={{ width: `${cusumPct}%` }}
              transition={{ duration: reduce ? 0 : 0.18, ease }}
            />
            <div className="sfl__cusum-threshold" aria-hidden="true" />
          </div>
          <AnimatePresence>
            <motion.div
              key={lastEvent}
              className="sfl__event"
              initial={{ opacity: 0, y: reduce ? 0 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {lastEvent}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="sfl__stats">
          <div className="sfl__stat">
            <div className="sfl__stat-val">{anomalies}</div>
            <div className="sfl__stat-unit">spikes flagged (EWMA)</div>
          </div>
          <div className="sfl__stat sfl__stat--drift">
            <div className="sfl__stat-val">{drifts}</div>
            <div className="sfl__stat-unit">drift events (CUSUM)</div>
          </div>
          <div className="sfl__stat">
            <div className="sfl__stat-val">&lt;500</div>
            <div className="sfl__stat-unit">ms end to end</div>
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause stream' : 'Resume stream'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">
          z threshold {Z_THRESHOLD}, decision interval {CUSUM_H}
        </span>
      </div>
    </div>
  );
}
