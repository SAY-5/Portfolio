import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './defecttracer.css';

// Real numbers from the project. The rule-based classifier replays a crash
// trace, parses the backtrace frame by frame skipping libc frames, and routes
// the trace into one of seven root-cause classes. The 60-issue corpus is gated
// at >= 95% accuracy in CI; the remaining 5% is left for human triage.

const ease = [0.22, 1, 0.36, 1] as const;

const CLASSES = [
  'null_deref',
  'heap_corruption',
  'stack_smash',
  'use_after_free',
  'double_free',
  'divide_by_zero',
  'assert_failure',
] as const;
type Class = (typeof CLASSES)[number];

type Frame = { fn: string; loc: string; libc: boolean };
type Trace = {
  id: string;
  signal: string;
  frames: Frame[];
  cls: Class;
  why: string;
};

// A small set of canonical traces, one routing to several of the seven classes.
const TRACES: Trace[] = [
  {
    id: 'issue-2041',
    signal: 'SIGSEGV',
    frames: [
      { fn: 'raise', loc: 'libc.so.6', libc: true },
      { fn: 'abort', loc: 'libc.so.6', libc: true },
      { fn: 'parse_node', loc: 'parser.c:218', libc: false },
      { fn: 'walk_tree', loc: 'parser.c:061', libc: false },
      { fn: 'main', loc: 'cli.c:044', libc: false },
    ],
    cls: 'null_deref',
    why: 'SIGSEGV at a zero address read in the first non-libc frame',
  },
  {
    id: 'issue-2055',
    signal: 'SIGABRT',
    frames: [
      { fn: '__libc_free', loc: 'libc.so.6', libc: true },
      { fn: 'malloc_consolidate', loc: 'libc.so.6', libc: true },
      { fn: 'release_buf', loc: 'pool.c:132', libc: false },
      { fn: 'free_pool', loc: 'pool.c:090', libc: false },
    ],
    cls: 'double_free',
    why: 'SIGABRT raised by the allocator on a second free of one chunk',
  },
  {
    id: 'issue-2068',
    signal: 'SIGABRT',
    frames: [
      { fn: '__stack_chk_fail', loc: 'libc.so.6', libc: true },
      { fn: 'copy_header', loc: 'codec.c:077', libc: false },
      { fn: 'decode', loc: 'codec.c:201', libc: false },
    ],
    cls: 'stack_smash',
    why: '__stack_chk_fail in the trace marks a stack canary overwrite',
  },
  {
    id: 'issue-2090',
    signal: 'SIGFPE',
    frames: [
      { fn: 'compute_rate', loc: 'metrics.c:054', libc: false },
      { fn: 'flush', loc: 'metrics.c:120', libc: false },
      { fn: 'main', loc: 'cli.c:044', libc: false },
    ],
    cls: 'divide_by_zero',
    why: 'SIGFPE with no libc prologue points at an integer divide by zero',
  },
];

type Phase = 'idle' | 'scanning' | 'routing' | 'done';

export default function DefecttracerDemo() {
  const reduce = useReducedMotion();
  const [traceIdx, setTraceIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [cursor, setCursor] = useState(-1); // index of frame being scanned
  const [solved, setSolved] = useState(0); // corpus issues auto-classified
  const timers = useRef<number[]>([]);

  const trace = TRACES[traceIdx];

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function selectTrace(i: number) {
    if (phase === 'scanning' || phase === 'routing') return;
    clearTimers();
    setTraceIdx(i);
    setPhase('idle');
    setCursor(-1);
  }

  function reset() {
    clearTimers();
    setPhase('idle');
    setCursor(-1);
    setSolved(0);
  }

  function classify() {
    if (phase === 'scanning' || phase === 'routing') return;
    clearTimers();
    setCursor(-1);
    setPhase('scanning');

    if (reduce) {
      setCursor(trace.frames.length - 1);
      setPhase('done');
      setSolved((s) => Math.min(57, s + 1));
      return;
    }

    const step = 420;
    trace.frames.forEach((_, i) => {
      timers.current.push(window.setTimeout(() => setCursor(i), step * (i + 1)));
    });
    const afterScan = step * (trace.frames.length + 1);
    timers.current.push(window.setTimeout(() => setPhase('routing'), afterScan));
    timers.current.push(
      window.setTimeout(() => {
        setPhase('done');
        setSolved((s) => Math.min(57, s + 1));
      }, afterScan + 520),
    );
  }

  const firstAppFrame = trace.frames.findIndex((f) => !f.libc);
  // 57 of 60 issues classified is 95%, the CI gate.
  const accuracy = solved > 0 ? Math.round((solved / 60) * 100) : 0;
  const busy = phase === 'scanning' || phase === 'routing';

  return (
    <div className="demo" aria-label="defecttracer crash classification demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Crash to root cause</h3>
      <p className="demo__lede">
        Pick a crash, then classify it. The backtrace is scanned frame by frame,
        libc frames are skipped, and the trace routes into one of seven
        root-cause buckets. Each run ticks the corpus accuracy meter toward the
        95% CI gate.
      </p>

      <div className="dt__picker" role="group" aria-label="select a crash trace">
        {TRACES.map((t, i) => (
          <button
            key={t.id}
            className={'dt__pick' + (i === traceIdx ? ' dt__pick--on' : '')}
            onClick={() => selectTrace(i)}
            aria-pressed={i === traceIdx}
            disabled={busy}
          >
            <span className="dt__pick-id">{t.id}</span>
            <span className="dt__pick-sig">{t.signal}</span>
          </button>
        ))}
      </div>

      <div className="dt__stage">
        <div className="dt__trace" aria-label="backtrace frames">
          <div className="dt__trace-head">
            <span>backtrace</span>
            <span className="dt__signal">{trace.signal}</span>
          </div>
          <ul className="dt__frames">
            {trace.frames.map((f, i) => {
              const scanned = cursor >= i;
              const isCursor = cursor === i && busy;
              const skipped = f.libc && scanned;
              const anchor = !f.libc && i === firstAppFrame;
              return (
                <li
                  key={f.fn + i}
                  className={
                    'dt__frame' +
                    (scanned ? ' dt__frame--scanned' : '') +
                    (skipped ? ' dt__frame--skip' : '') +
                    (isCursor ? ' dt__frame--cursor' : '') +
                    (anchor && scanned ? ' dt__frame--anchor' : '')
                  }
                >
                  <span className="dt__frame-no">#{i}</span>
                  <span className="dt__frame-fn">{f.fn}</span>
                  <span className="dt__frame-loc">{f.loc}</span>
                  <span className="dt__frame-tag">
                    {scanned ? (f.libc ? 'libc skip' : anchor ? 'anchor' : 'app') : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="dt__buckets" aria-label="root cause buckets">
          {CLASSES.map((c) => {
            const hit = phase === 'done' && c === trace.cls;
            const aiming = phase === 'routing' && c === trace.cls;
            return (
              <div
                key={c}
                className={
                  'dt__bucket' +
                  (hit ? ' dt__bucket--hit' : '') +
                  (aiming ? ' dt__bucket--aim' : '')
                }
              >
                <span className="dt__bucket-name">{c}</span>
                <AnimatePresence>
                  {hit && (
                    <motion.span
                      key={`dot-${c}`}
                      className="dt__bucket-dot"
                      initial={{ scale: reduce ? 1 : 0 }}
                      animate={{ scale: 1 }}
                      transition={{ duration: reduce ? 0 : 0.35, ease }}
                      aria-hidden="true"
                    />
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>

      <div className="dt__meterwrap">
        <div className="dt__meter-head">
          <span className="dt__meter-label">corpus accuracy</span>
          <span className="dt__meter-val">
            {solved}/60 <span className="dt__meter-pct">{accuracy}%</span>
          </span>
        </div>
        <div className="dt__meter" role="img" aria-label={`${accuracy} percent classified`}>
          <motion.div
            className="dt__meter-fill"
            animate={{ width: `${accuracy}%` }}
            transition={{ duration: reduce ? 0 : 0.5, ease }}
          />
          <div className="dt__meter-gate" style={{ left: '95%' }} aria-hidden="true">
            <span>95% gate</span>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {phase === 'done' && (
          <motion.div
            key="verdict"
            className="dt__verdict"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            <span className="dt__verdict-head">{trace.cls}</span>
            <span className="dt__verdict-text">
              {trace.why}. The classifier is rule-based, so the same trace yields
              the same class on every CI run with zero inference cost, across 13
              Python tests in the trace, classify, and repro packages.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button className="demo__btn" onClick={classify} disabled={busy}>
          {busy ? 'Classifying...' : 'Classify crash'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={busy}
        >
          Reset
        </button>
        <span className="demo__hint">7 classes, rule-based, reproducible</span>
      </div>
    </div>
  );
}
