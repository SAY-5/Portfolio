import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './mfg-test-controller.css';

// Real numbers from the project: two wire formats for the same four function
// codes (hand-rolled 8-byte frame with CRC16 polynomial 0xA001, and real
// Modbus TCP with the MBAP header). Trend analysis computes a least-squares
// drift slope per register and an SPC control-chart classification of
// in-control, trending, or out-of-control. 200-cycle benchmark: clean run
// ~10,600 commands/s, fault-injected run ~4,200 commands/s.
const CLEAN_CPS = 10600;
const FAULT_CPS = 4200;
const CRC_POLY = '0xA001';

type Fault = 'none' | 'drift' | 'freeze' | 'corrupt';

type Step = {
  id: number;
  reg: string;
  name: string;
  // Nominal reading and the per-step upper threshold the controller checks.
  nominal: number;
  threshold: number;
  unit: string;
};

const plan: Step[] = [
  { id: 1, reg: '40001', name: 'rail voltage', nominal: 12.0, threshold: 12.6, unit: 'V' },
  { id: 2, reg: '40002', name: 'shunt current', nominal: 2.40, threshold: 3.10, unit: 'A' },
  { id: 3, reg: '40003', name: 'coil temp', nominal: 41.0, threshold: 55.0, unit: 'C' },
  { id: 4, reg: '40004', name: 'output pressure', nominal: 88.0, threshold: 96.0, unit: 'kPa' },
  { id: 5, reg: '40005', name: 'leak rate', nominal: 0.12, threshold: 0.40, unit: 'sccm' },
];

const SAMPLES = 14;
const ease = [0.22, 1, 0.36, 1] as const;

type Spc = 'in-control' | 'trending' | 'out-of-control';

// Least-squares slope over evenly spaced samples (x = 0..n-1).
function slope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const xbar = (n - 1) / 2;
  const ybar = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xbar) * (ys[i] - ybar);
    den += (i - xbar) * (i - xbar);
  }
  return den === 0 ? 0 : num / den;
}

function classify(s: number, range: number): Spc {
  const rel = Math.abs(s) / (range || 1);
  if (rel > 0.045) return 'out-of-control';
  if (rel > 0.012) return 'trending';
  return 'in-control';
}

// Build a sample series for a register under a given fault profile.
function buildSeries(step: Step, fault: Fault): number[] {
  const range = step.threshold - step.nominal;
  const out: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / (SAMPLES - 1);
    let v = step.nominal;
    if (fault === 'drift') {
      v = step.nominal + range * 0.9 * t;
    } else if (fault === 'freeze') {
      v = i === 0 ? step.nominal : out[0];
    } else if (fault === 'corrupt') {
      v = step.nominal + (i % 4 === 3 ? range * 1.2 : range * 0.05 * Math.sin(i));
    } else {
      v = step.nominal + range * 0.06 * Math.sin(i * 0.9);
    }
    // tiny deterministic jitter so the chart reads as live, not a clean line
    v += range * 0.02 * Math.sin(i * 2.3 + step.id);
    out.push(v);
  }
  return out;
}

export default function MfgTestControllerDemo() {
  const reduce = useReducedMotion();
  const [fault, setFault] = useState<Fault>('drift');
  const [active, setActive] = useState(0);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<number, 'pass' | 'fail' | null>>({});
  const timerRef = useRef<number | null>(null);

  const step = plan[active];
  const series = buildSeries(step, fault);
  const range = step.threshold - step.nominal;
  const drift = slope(series);
  const spc: Spc = classify(drift, range);
  const last = series[series.length - 1];
  const passes = last <= step.threshold;
  const cps = fault === 'none' ? CLEAN_CPS : FAULT_CPS;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  // Reset verdicts whenever the fault profile changes; the plan must re-run.
  useEffect(() => {
    setResults({});
  }, [fault]);

  // Step through the plan, streaming one verdict at a time like the SSE feed.
  function runPlan() {
    clearTimer();
    setRunning(true);
    setResults({});
    setActive(0);

    if (reduce) {
      const all: Record<number, 'pass' | 'fail'> = {};
      plan.forEach((s) => {
        const ser = buildSeries(s, fault);
        all[s.id] = ser[ser.length - 1] <= s.threshold ? 'pass' : 'fail';
      });
      setResults(all);
      setActive(plan.length - 1);
      setRunning(false);
      return;
    }

    let i = 0;
    timerRef.current = window.setInterval(() => {
      const s = plan[i];
      const ser = buildSeries(s, fault);
      const verdict: 'pass' | 'fail' =
        ser[ser.length - 1] <= s.threshold ? 'pass' : 'fail';
      setActive(i);
      setResults((r) => ({ ...r, [s.id]: verdict }));
      i += 1;
      if (i >= plan.length) {
        clearTimer();
        setRunning(false);
      }
    }, 620);
  }

  function reset() {
    clearTimer();
    setRunning(false);
    setResults({});
    setActive(0);
  }

  // Chart geometry. y maps nominal..threshold (plus headroom) into the plot.
  const W = 320;
  const H = 150;
  const padX = 10;
  const padY = 14;
  const yMin = step.nominal - range * 0.25;
  const yMax = step.threshold + range * 0.35;
  const xAt = (i: number) =>
    padX + (i / (SAMPLES - 1)) * (W - padX * 2);
  const yAt = (v: number) =>
    H - padY - ((v - yMin) / (yMax - yMin)) * (H - padY * 2);
  const thresholdY = yAt(step.threshold);
  const points = series.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ');

  const spcLabel =
    spc === 'in-control'
      ? 'IN CONTROL'
      : spc === 'trending'
        ? 'TRENDING'
        : 'OUT OF CONTROL';

  return (
    <div className="demo" aria-label="mfg test controller demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Drift, detected on the chart</h3>
      <p className="demo__lede">
        Pick a fault profile for the simulated instruments, then run the plan.
        The controller reads each register over Modbus, plots the samples on an
        SPC control chart, fits a least-squares drift slope, and streams a
        pass or fail verdict per step.
      </p>

      <div className="mtc__faults" role="group" aria-label="fault injection profile">
        {(['none', 'drift', 'freeze', 'corrupt'] as Fault[]).map((f) => (
          <button
            key={f}
            className={`mtc__fault ${fault === f ? 'mtc__fault--on' : ''}`}
            aria-pressed={fault === f}
            onClick={() => setFault(f)}
            disabled={running}
          >
            {f === 'none'
              ? 'clean'
              : f === 'corrupt'
                ? 'CRC corrupt'
                : f}
          </button>
        ))}
      </div>

      <div className="mtc__stage">
        <div className="mtc__chartwrap">
          <div className="mtc__chart-head">
            <span className="mtc__chart-title">
              {step.reg} {step.name}
            </span>
            <span className={`mtc__spc mtc__spc--${spc}`}>{spcLabel}</span>
          </div>
          <svg
            className="mtc__chart"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`Control chart for register ${step.reg}, ${spcLabel}`}
          >
            {/* threshold control limit */}
            <line
              x1={padX}
              y1={thresholdY}
              x2={W - padX}
              y2={thresholdY}
              stroke="var(--accent-line)"
              strokeWidth={1}
              strokeDasharray="5 4"
            />
            <text x={W - padX} y={thresholdY - 5} textAnchor="end" className="mtc__limit">
              UCL {step.threshold}
              {step.unit}
            </text>

            {/* nominal centre line */}
            <line
              x1={padX}
              y1={yAt(step.nominal)}
              x2={W - padX}
              y2={yAt(step.nominal)}
              stroke="var(--line)"
              strokeWidth={1}
            />

            {/* sample polyline */}
            <motion.polyline
              key={`${step.id}-${fault}`}
              points={points}
              fill="none"
              stroke={passes ? 'rgba(79, 208, 138, 0.9)' : 'var(--accent)'}
              strokeWidth={2}
              strokeLinejoin="round"
              initial={{ pathLength: reduce ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: reduce ? 0 : 0.7, ease }}
            />

            {/* sample dots */}
            {series.map((v, i) => (
              <motion.circle
                key={`${step.id}-${fault}-${i}`}
                cx={xAt(i)}
                cy={yAt(v)}
                r={2.4}
                fill={v > step.threshold ? 'var(--accent)' : 'var(--paper-dim)'}
                initial={{ opacity: reduce ? 1 : 0 }}
                animate={{ opacity: 1 }}
                transition={{
                  duration: reduce ? 0 : 0.2,
                  delay: reduce ? 0 : i * 0.03,
                }}
              />
            ))}
          </svg>
          <div className="mtc__readout">
            <div className="mtc__readout-item">
              <span className="mtc__readout-label">slope</span>
              <span className="mtc__readout-val">
                {drift >= 0 ? '+' : ''}
                {drift.toFixed(3)} {step.unit}/sample
              </span>
            </div>
            <div className="mtc__readout-item">
              <span className="mtc__readout-label">last</span>
              <span
                className="mtc__readout-val"
                style={{ color: passes ? '#4fd08a' : 'var(--accent)' }}
              >
                {last.toFixed(2)} {step.unit}
              </span>
            </div>
            <div className="mtc__readout-item">
              <span className="mtc__readout-label">throughput</span>
              <span className="mtc__readout-val">
                {cps.toLocaleString()} cmd/s
              </span>
            </div>
          </div>
        </div>

        <div className="mtc__steps">
          <div className="mtc__steps-head">
            <span>SSE step stream</span>
            <span className="mtc__wire">
              {fault === 'corrupt' ? `CRC16 ${CRC_POLY}` : 'Modbus TCP / MBAP'}
            </span>
          </div>
          <ul className="mtc__list">
            {plan.map((s, i) => {
              const verdict = results[s.id] ?? null;
              const isActive = running && i === active;
              return (
                <li
                  key={s.id}
                  className={`mtc__step ${isActive ? 'mtc__step--on' : ''} ${
                    verdict ? `mtc__step--${verdict}` : ''
                  }`}
                >
                  <button
                    type="button"
                    className="mtc__step-btn"
                    aria-pressed={i === active}
                    onClick={() => !running && setActive(i)}
                    disabled={running}
                  >
                    <span className="mtc__step-reg">{s.reg}</span>
                    <span className="mtc__step-name">{s.name}</span>
                    <span className="mtc__step-verdict">
                      {verdict ? verdict.toUpperCase() : isActive ? 'READ' : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <AnimatePresence>
            {!running && Object.keys(results).length === plan.length && (
              <motion.div
                className="mtc__report"
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease }}
              >
                {(() => {
                  const failed = Object.values(results).filter((v) => v === 'fail').length;
                  return failed === 0
                    ? 'Station report: PASS, all 5 steps within limits'
                    : `Station report: FAIL, ${failed} of ${plan.length} steps over limit`;
                })()}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={runPlan} disabled={running}>
          {running ? 'Running plan…' : 'Run plan'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={running}>
          Reset
        </button>
        <span className="demo__hint">
          {fault === 'none'
            ? `clean run ~${CLEAN_CPS.toLocaleString()} cmd/s`
            : `fault run ~${FAULT_CPS.toLocaleString()} cmd/s`}
        </span>
      </div>
    </div>
  );
}
