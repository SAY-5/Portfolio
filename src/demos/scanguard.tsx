import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './scanguard.css';

// Real mechanism from scanguard: the orchestrator drives a motorized bed and
// polls SCPI position queries until the reading settles within 0.1mm of the
// target before it captures. Preflight runs four check types and never stops
// at the first failure, so every problem shows before one PASS/FAIL verdict.
const SETTLE_MM = 0.1; // capture window: |position - target| must be <= this
const TARGETS = [0, 12.5, 25, 37.5]; // bed positions in mm for a 4-step scan
const ease = [0.22, 1, 0.36, 1] as const;

type CheckState = 'pending' | 'pass' | 'fail' | 'stale';
type Check = {
  id: string;
  label: string;
  detail: string;
  // outcome the simulated instrument returns once the check runs
  outcome: Exclude<CheckState, 'pending'>;
};

// The four preflight check types, with one seeded fault so the report shows a
// mix. The engine runs all four regardless of earlier failures.
const CHECKS: Check[] = [
  {
    id: 'chan',
    label: 'detector channel range',
    detail: 'channels 0..63 within bounds',
    outcome: 'pass',
  },
  {
    id: 'calib',
    label: 'calibration file',
    detail: 'calib.json present and parseable',
    outcome: 'fail',
  },
  {
    id: 'selftest',
    label: 'device self test',
    detail: '*TST? returns 0',
    outcome: 'pass',
  },
  {
    id: 'disk',
    label: 'disk space',
    detail: 'free space above floor',
    outcome: 'stale',
  },
];

const STATE_LABEL: Record<CheckState, string> = {
  pending: 'queued',
  pass: 'pass',
  fail: 'fail',
  stale: 'stale',
};

export default function ScanguardDemo() {
  const reduce = useReducedMotion();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [checkStates, setCheckStates] = useState<CheckState[]>(
    CHECKS.map(() => 'pending'),
  );
  const [stepIdx, setStepIdx] = useState(0);
  const [position, setPosition] = useState(0); // current bed reading in mm
  const [settled, setSettled] = useState(false);
  const [polls, setPolls] = useState(0); // SCPI position queries this step
  const [captured, setCaptured] = useState<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const timers = useRef<number[]>([]);

  const target = TARGETS[stepIdx];
  const delta = Math.abs(position - target);
  const passCount = checkStates.filter((s) => s === 'pass').length;
  const verdictFail = checkStates.some((s) => s === 'fail');

  function clearAll() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }

  useEffect(() => clearAll, []);

  function reset() {
    clearAll();
    setRunning(false);
    setDone(false);
    setCheckStates(CHECKS.map(() => 'pending'));
    setStepIdx(0);
    setPosition(0);
    setSettled(false);
    setPolls(0);
    setCaptured([]);
  }

  // Drive the bed from a start reading toward a target, polling until the
  // reading is within SETTLE_MM, then resolve so the next step can begin.
  function driveTo(from: number, to: number, onSettle: () => void) {
    if (reduce) {
      setPosition(to);
      setSettled(true);
      setPolls(3);
      onSettle();
      return;
    }
    const duration = 900;
    const start = performance.now();
    let lastPoll = -1;
    setSettled(false);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      // overshoot slightly then settle, the way a real stage rings down
      const ring = Math.sin(t * Math.PI * 3) * (1 - t) * 0.6;
      const pos = from + (to - from) * eased + ring;
      setPosition(+pos.toFixed(3));
      const pollN = Math.floor(t * 6);
      if (pollN !== lastPoll) {
        lastPoll = pollN;
        setPolls((p) => p + 1);
      }
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setPosition(to);
        setSettled(true);
        rafRef.current = null;
        const id = window.setTimeout(onSettle, 360);
        timers.current.push(id);
      }
    };
    setPolls(0);
    rafRef.current = requestAnimationFrame(tick);
  }

  function runStep(idx: number) {
    if (idx >= TARGETS.length) {
      // bed sequence complete, run the preflight checks one by one
      runChecks(0);
      return;
    }
    setStepIdx(idx);
    const from = idx === 0 ? 0 : TARGETS[idx - 1];
    driveTo(from, TARGETS[idx], () => {
      setCaptured((c) => [...c, TARGETS[idx]]);
      const id = window.setTimeout(() => runStep(idx + 1), reduce ? 0 : 220);
      timers.current.push(id);
    });
  }

  function runChecks(i: number) {
    if (i >= CHECKS.length) {
      setRunning(false);
      setDone(true);
      return;
    }
    setCheckStates((prev) => {
      const next = [...prev];
      next[i] = CHECKS[i].outcome;
      return next;
    });
    const id = window.setTimeout(() => runChecks(i + 1), reduce ? 0 : 340);
    timers.current.push(id);
  }

  function run() {
    if (running) return;
    clearAll();
    setRunning(true);
    setDone(false);
    setCheckStates(CHECKS.map(() => 'pending'));
    setStepIdx(0);
    setPosition(0);
    setSettled(false);
    setPolls(0);
    setCaptured([]);
    runStep(0);
  }

  // bed track geometry
  const trackMin = 0;
  const trackMax = 37.5;
  const pct = (v: number) =>
    ((v - trackMin) / (trackMax - trackMin)) * 100;

  const bedRunning = running && captured.length < TARGETS.length;

  return (
    <div className="demo" aria-label="scanguard scanner control panel demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Bed settle and preflight</h3>
      <p className="demo__lede">
        Run the scan sequence. The bed steps through four positions while SCPI
        position queries poll until the reading is within {SETTLE_MM}mm of
        target, then it captures. Afterward the preflight engine runs all four
        check types and reports every result at once.
      </p>

      <div className="sg__stage">
        <div className="sg__panel">
          <div className="sg__panel-head">
            <span className="sg__panel-title">Motorized bed</span>
            <span
              className="sg__panel-state"
              data-settled={settled ? 'true' : 'false'}
            >
              {settled ? 'settled' : bedRunning ? 'moving' : 'idle'}
            </span>
          </div>

          <div className="sg__track" role="img" aria-label="bed position track">
            {TARGETS.map((t) => (
              <div
                key={t}
                className={
                  'sg__mark' +
                  (captured.includes(t) ? ' sg__mark--hit' : '') +
                  (t === target && bedRunning ? ' sg__mark--target' : '')
                }
                style={{ left: pct(t) + '%' } as CSSProperties}
              >
                <span className="sg__mark-tick" />
                <span className="sg__mark-label">{t}</span>
              </div>
            ))}
            {/* settle window around the live target while moving */}
            {bedRunning && (
              <div
                className="sg__window"
                style={
                  {
                    left: pct(target) + '%',
                    // window half-width scaled to track; visual only
                    width: '6%',
                  } as CSSProperties
                }
              />
            )}
            <motion.div
              className={'sg__bed' + (settled ? ' sg__bed--settled' : '')}
              style={{ left: pct(position) + '%' } as CSSProperties}
              animate={{}}
              transition={{ duration: 0 }}
            />
          </div>

          <div className="sg__readout">
            <div className="sg__metric">
              <span className="sg__metric-label">position</span>
              <span className="sg__metric-val">
                {position.toFixed(3)}
                <span className="sg__metric-unit">mm</span>
              </span>
            </div>
            <div className="sg__metric">
              <span className="sg__metric-label">target</span>
              <span className="sg__metric-val">
                {target.toFixed(1)}
                <span className="sg__metric-unit">mm</span>
              </span>
            </div>
            <div
              className={
                'sg__metric sg__metric--delta' +
                (delta <= SETTLE_MM ? ' sg__metric--in' : '')
              }
            >
              <span className="sg__metric-label">|delta|</span>
              <span className="sg__metric-val">
                {delta.toFixed(3)}
                <span className="sg__metric-unit">mm</span>
              </span>
            </div>
          </div>

          <div className="sg__scpi">
            <span className="sg__scpi-q">POSition?</span>
            <span className="sg__scpi-a">
              {bedRunning || settled ? position.toFixed(3) : '--'}
            </span>
            <span className="sg__scpi-polls">
              {polls > 0 ? `${polls} polls` : 'wait and confirm'}
            </span>
          </div>
        </div>

        <div className="sg__panel">
          <div className="sg__panel-head">
            <span className="sg__panel-title">Preflight checklist</span>
            <span className="sg__panel-state">{passCount} of 4 pass</span>
          </div>
          <ul className="sg__checks">
            {CHECKS.map((c, i) => {
              const st = checkStates[i];
              return (
                <motion.li
                  key={c.id}
                  className={`sg__check sg__check--${st}`}
                  initial={false}
                  animate={
                    st !== 'pending' && !reduce
                      ? { scale: [1, 1.015, 1] }
                      : { scale: 1 }
                  }
                  transition={{ duration: 0.32, ease }}
                >
                  <span className="sg__check-dot" aria-hidden="true" />
                  <span className="sg__check-body">
                    <span className="sg__check-label">{c.label}</span>
                    <span className="sg__check-detail">{c.detail}</span>
                  </span>
                  <span className="sg__check-state">{STATE_LABEL[st]}</span>
                </motion.li>
              );
            })}
          </ul>
        </div>

        <AnimatePresence>
          {done && (
            <motion.div
              className={
                'sg__verdict' + (verdictFail ? ' sg__verdict--fail' : '')
              }
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="sg__verdict-head">
                {verdictFail ? 'FAIL' : 'PASS'}
              </span>
              <span className="sg__verdict-text">
                All four checks ran before the verdict. {passCount} passed, the
                calibration file failed, and disk space read stale. The bed
                captured at every position only after settling within{' '}
                {SETTLE_MM}mm, so no setup-state false failures.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Running…' : 'Run scan sequence'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {captured.length}/4 positions captured
        </span>
      </div>
    </div>
  );
}
