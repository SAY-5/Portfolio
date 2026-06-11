import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './hilbench.css';

// Real numbers from the project: a throughput benchmark of 200 scenarios of 50
// steps each (10000 steps) measured a best-of-seven of about 1.03 million steps
// per second. The simulated DUT is a motor-controller state machine and a step
// fails on a wrong value or a response later than its max_latency_ms budget.
const STEPS_PER_SEC = 1_030_000;
const FLAKE_RUNS = 7; // flake detection runs a step N times against a fresh transport

type MState = 'IDLE' | 'ARMED' | 'RUNNING' | 'FAULT';
const STATES: MState[] = ['IDLE', 'ARMED', 'RUNNING', 'FAULT'];

type Step = {
  cmd: string;
  expect: string;
  from: MState;
  to: MState;
  budget: number; // max_latency_ms
  // base latency the simulated transport returns for this step
  latency: number;
  // a straddling step alternates around its budget across runs
  straddles?: boolean;
};

// A YAML scenario: each step issues a command, expects a value, and carries a
// timing budget. The "spin_up" step straddles its 4 ms budget, so it gets
// retried on the timing breach and ends up classified flaky.
const SCENARIO: Step[] = [
  { cmd: 'arm', expect: 'ARMED', from: 'IDLE', to: 'ARMED', budget: 3, latency: 1.6 },
  { cmd: 'spin_up', expect: 'RUNNING', from: 'ARMED', to: 'RUNNING', budget: 4, latency: 3.7, straddles: true },
  { cmd: 'set_rpm 1200', expect: 'OK', from: 'RUNNING', to: 'RUNNING', budget: 2, latency: 1.1 },
  { cmd: 'read_temp', expect: '< 80', from: 'RUNNING', to: 'RUNNING', budget: 2, latency: 0.9 },
  { cmd: 'estop', expect: 'IDLE', from: 'RUNNING', to: 'IDLE', budget: 5, latency: 2.4 },
];

type Verdict = 'pass' | 'fail' | 'retry';
type RunRow = { idx: number; latency: number; verdict: Verdict };

const ease = [0.22, 1, 0.36, 1] as const;

// A straddling step alternates slow/fast across runs, matching the project test
// that injects an alternating latency sequence to prove flake classification.
function latencyForRun(step: Step, run: number): number {
  if (!step.straddles) return step.latency;
  return run % 2 === 0 ? step.budget + 0.8 : step.budget - 0.9;
}

export default function HilbenchDemo() {
  const reduce = useReducedMotion();
  const [stepIdx, setStepIdx] = useState(0);
  const [machine, setMachine] = useState<MState>('IDLE');
  const [running, setRunning] = useState(false);
  const [flakeRows, setFlakeRows] = useState<RunRow[]>([]);
  const [flaking, setFlaking] = useState(false);
  const timers = useRef<number[]>([]);

  const step = SCENARIO[stepIdx];

  function clearTimers() {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function reset() {
    clearTimers();
    setStepIdx(0);
    setMachine('IDLE');
    setRunning(false);
    setFlakeRows([]);
    setFlaking(false);
  }

  function stepThrough() {
    if (running || flaking) return;
    const next = SCENARIO[stepIdx];
    setMachine(next.to);
    setStepIdx((i) => (i + 1) % SCENARIO.length);
  }

  // Run flake detection on the straddling step: N runs against a fresh
  // transport, each timing-breach retried once, then classified.
  function detectFlake() {
    if (flaking) return;
    clearTimers();
    setFlaking(true);
    setFlakeRows([]);
    const target = SCENARIO[1]; // spin_up, the straddling step
    setStepIdx(1);
    setMachine('ARMED');

    const rows: RunRow[] = [];
    for (let r = 0; r < FLAKE_RUNS; r++) {
      const lat = latencyForRun(target, r);
      const breach = lat > target.budget;
      rows.push({ idx: r, latency: lat, verdict: breach ? 'retry' : 'pass' });
    }

    if (reduce) {
      setFlakeRows(rows);
      setMachine('RUNNING');
      setFlaking(false);
      return;
    }

    rows.forEach((row, i) => {
      timers.current.push(
        window.setTimeout(() => {
          setFlakeRows((prev) => [...prev, row]);
          if (i === rows.length - 1) {
            setMachine('RUNNING');
            setFlaking(false);
          }
        }, 360 * (i + 1)),
      );
    });
  }

  const passes = flakeRows.filter((r) => r.verdict === 'pass').length;
  const breaches = flakeRows.filter((r) => r.verdict === 'retry').length;
  const classification =
    flakeRows.length < FLAKE_RUNS
      ? null
      : passes === FLAKE_RUNS
        ? 'stable pass'
        : breaches === FLAKE_RUNS
          ? 'stable fail'
          : 'flaky';

  const maxBar = Math.max(...SCENARIO.map((s) => Math.max(s.budget, s.latency))) + 1.5;

  return (
    <div className="demo" aria-label="hilbench scenario demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Drive the scenario, catch the flake</h3>
      <p className="demo__lede">
        Step the motor-controller state machine through a YAML scenario. Each
        step plots its latency against its timing budget. Run flake detection on
        the step that straddles its budget to see it retried on the breach and
        classified across {FLAKE_RUNS} fresh runs.
      </p>

      <div className="hb__stage">
        <div className="hb__machine" role="img" aria-label={`state machine, current state ${machine}`}>
          {STATES.map((s) => {
            const isCur = s === machine;
            const isFault = s === 'FAULT';
            return (
              <div
                key={s}
                className={`hb__node ${isCur ? 'hb__node--on' : ''} ${isFault ? 'hb__node--fault' : ''}`}
              >
                <span className="hb__node-label">{s}</span>
                {isCur && (
                  <motion.span
                    className="hb__node-pulse"
                    layoutId={reduce ? undefined : 'hb-pulse'}
                    aria-hidden="true"
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="hb__current" aria-live="polite">
          <span className="hb__current-label">step</span>
          <code className="hb__current-cmd">{step.cmd}</code>
          <span className="hb__current-arrow" aria-hidden="true">expects</span>
          <code className="hb__current-expect">{step.expect}</code>
          <span className="hb__current-budget">budget {step.budget} ms</span>
        </div>

        <div className="hb__bars" aria-label="per step latency against budget">
          {SCENARIO.map((s, i) => {
            const over = s.latency > s.budget;
            const isCur = i === stepIdx;
            return (
              <div key={i} className={`hb__bar-row ${isCur ? 'hb__bar-row--cur' : ''}`}>
                <span className="hb__bar-name">{s.cmd}</span>
                <div className="hb__bar-track">
                  <span
                    className="hb__bar-budget"
                    style={{ left: `${(s.budget / maxBar) * 100}%` }}
                    aria-hidden="true"
                  />
                  <motion.span
                    className={`hb__bar-fill ${over ? 'hb__bar-fill--over' : ''}`}
                    initial={{ width: reduce ? `${(s.latency / maxBar) * 100}%` : 0 }}
                    animate={{ width: `${(s.latency / maxBar) * 100}%` }}
                    transition={{ duration: reduce ? 0 : 0.5, delay: reduce ? 0 : i * 0.05, ease }}
                  />
                </div>
                <span className={`hb__bar-ms ${over ? 'hb__bar-ms--over' : ''}`}>
                  {s.latency.toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>

        <AnimatePresence>
          {flakeRows.length > 0 && (
            <motion.div
              className="hb__flake"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.4, ease }}
            >
              <div className="hb__flake-head">
                flake detection: spin_up, {FLAKE_RUNS} runs, budget 4 ms
              </div>
              <div className="hb__flake-runs">
                {flakeRows.map((r) => (
                  <motion.span
                    key={r.idx}
                    className={`hb__run hb__run--${r.verdict}`}
                    initial={{ scale: reduce ? 1 : 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: reduce ? 0 : 0.25, ease }}
                    title={`run ${r.idx + 1}: ${r.latency.toFixed(1)} ms`}
                  >
                    {r.latency.toFixed(1)}
                  </motion.span>
                ))}
              </div>
              {classification && (
                <div className={`hb__verdict hb__verdict--${classification.replace(' ', '-')}`}>
                  <span className="hb__verdict-tag">{classification}</span>
                  <span className="hb__verdict-text">
                    {breaches} of {FLAKE_RUNS} runs breached the 4 ms budget, so the
                    step is intermittent. A wrong value would never be retried; only
                    a timing breach is.
                  </span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="hb__metrics">
        <div className="hb__metric">
          <span className="hb__metric-val">{(STEPS_PER_SEC / 1_000_000).toFixed(2)}M</span>
          <span className="hb__metric-unit">steps / sec, best of seven</span>
        </div>
        <div className="hb__metric">
          <span className="hb__metric-val">10,000</span>
          <span className="hb__metric-unit">steps (200 scenarios x 50)</span>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={stepThrough} disabled={flaking}>
          Step
        </button>
        <button className="demo__btn" onClick={detectFlake} disabled={flaking}>
          {flaking ? 'Detecting…' : 'Detect flake'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={flaking}>
          Reset
        </button>
        <span className="demo__hint">
          state: {machine}
        </span>
      </div>
    </div>
  );
}
