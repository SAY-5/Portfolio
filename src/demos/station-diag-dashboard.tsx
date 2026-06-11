import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './station-diag-dashboard.css';

// Real numbers from the project: WebSocket hub assigns monotonic sequence
// numbers, keeps a bounded backlog, backfills reconnecting clients from a
// last_seq cursor, and drops slow subscribers rather than stalling ingestion.
// Throughput sweep ~4,200 to 4,600 ev/s bounded by rule evaluation; hub
// fan-out stays sub-10 us at P99 even at 50 subscribers. Correlation groups
// co-occurring failures into one incident ordered by earliest-in-window
// subsystem as probable root cause.
const THROUGHPUT = 4600;
const FANOUT_US = 10;
const SUBSCRIBERS = 50;

type Subsystem = 'hydraulic' | 'actuator' | 'sensor' | 'controller';

type Line = {
  seq: number;
  subsystem: Subsystem;
  msg: string;
  level: 'info' | 'warn' | 'fail';
  // offset in ms from the start of the correlation window, drives root-cause order
  offset: number;
};

// A scripted run: routine info traffic, then a burst of related failures that
// the rule engine flags and correlation collapses into one incident. The
// hydraulic pressure drop is earliest-in-window, so it is the probable cause.
const script: Omit<Line, 'seq'>[] = [
  { subsystem: 'controller', msg: 'cycle 4471 start', level: 'info', offset: 0 },
  { subsystem: 'sensor', msg: 'temp 41.2C nominal', level: 'info', offset: 0 },
  { subsystem: 'actuator', msg: 'extend cmd ack', level: 'info', offset: 0 },
  { subsystem: 'hydraulic', msg: 'pressure 88 kPa', level: 'info', offset: 0 },
  { subsystem: 'hydraulic', msg: 'pressure drop 88 to 41 kPa', level: 'fail', offset: 12 },
  { subsystem: 'actuator', msg: 'extend timeout, no end-stop', level: 'fail', offset: 47 },
  { subsystem: 'sensor', msg: 'position variance over band', level: 'warn', offset: 61 },
  { subsystem: 'controller', msg: 'retry extend, cycle hold', level: 'fail', offset: 88 },
  { subsystem: 'sensor', msg: 'temp 40.9C nominal', level: 'info', offset: 140 },
  { subsystem: 'controller', msg: 'cycle 4472 start', level: 'info', offset: 180 },
];

// Failure-level lines within the window correlate into one incident.
const incidentSubsystems: Subsystem[] = ['hydraulic', 'actuator', 'controller'];

const ease = [0.22, 1, 0.36, 1] as const;

export default function StationDiagDashboardDemo() {
  const reduce = useReducedMotion();
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [connected, setConnected] = useState(true);
  const seqRef = useRef(0);
  const idxRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const failureLines = lines.filter((l) => l.level === 'fail');
  const incidentReady = failureLines.length >= 3;

  function emitNext() {
    const i = idxRef.current;
    if (i >= script.length) {
      clearTimer();
      setRunning(false);
      return;
    }
    seqRef.current += 1;
    const next: Line = { ...script[i], seq: seqRef.current };
    setLines((prev) => [...prev, next].slice(-10));
    idxRef.current += 1;
    if (idxRef.current >= script.length) {
      clearTimer();
      setRunning(false);
    }
  }

  function start() {
    clearTimer();
    setLines([]);
    setCollapsed(false);
    setConnected(true);
    seqRef.current = 0;
    idxRef.current = 0;
    setRunning(true);

    if (reduce) {
      let seq = 0;
      const all = script.map((s) => ({ ...s, seq: ++seq }));
      seqRef.current = seq;
      idxRef.current = script.length;
      setLines(all.slice(-10));
      setRunning(false);
      return;
    }
    timerRef.current = window.setInterval(emitNext, 560);
  }

  // Reconnect backfills from the last_seq cursor: the bounded backlog replays
  // so the client catches up without losing the incident.
  function reconnect() {
    setConnected(false);
    window.setTimeout(
      () => {
        setConnected(true);
      },
      reduce ? 0 : 420,
    );
  }

  function reset() {
    clearTimer();
    setLines([]);
    setCollapsed(false);
    setRunning(false);
    setConnected(true);
    seqRef.current = 0;
    idxRef.current = 0;
  }

  // Order the incident timeline by earliest offset: the probable root cause
  // sits at the top of the collapsed card.
  const incidentLines = lines
    .filter((l) => l.level === 'fail' || l.level === 'warn')
    .filter((l) => incidentSubsystems.includes(l.subsystem) || l.level === 'warn')
    .sort((a, b) => a.offset - b.offset);
  const rootCause = incidentLines[0];

  return (
    <div className="demo" aria-label="station diagnostics dashboard demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Stream, flag, correlate</h3>
      <p className="demo__lede">
        Test stations push newline-delimited JSON over WebSocket. The hub
        stamps a monotonic sequence on each line, the rule engine flags
        actuator and hydraulic failures as they land, and correlation collapses
        the related failures into one incident with a root-cause-ordered
        timeline.
      </p>

      <div className="sdd__bar">
        <span className={`sdd__conn ${connected ? 'sdd__conn--up' : 'sdd__conn--down'}`}>
          <span className="sdd__conn-dot" />
          {connected ? 'WS connected' : 'reconnecting, backfilling'}
        </span>
        <span className="sdd__seq">last_seq {seqRef.current}</span>
      </div>

      <div className="sdd__stage">
        <div className="sdd__feed">
          <div className="sdd__feed-head">Event stream</div>
          <ul className="sdd__lines">
            <AnimatePresence initial={false}>
              {lines.map((l) => (
                <motion.li
                  key={l.seq}
                  className={`sdd__line sdd__line--${l.level}`}
                  layout={!reduce}
                  initial={{ opacity: 0, x: reduce ? 0 : -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.3, ease }}
                >
                  <span className="sdd__line-seq">#{l.seq}</span>
                  <span className="sdd__line-sub">{l.subsystem}</span>
                  <span className="sdd__line-msg">{l.msg}</span>
                  {l.level === 'fail' && <span className="sdd__line-flag">FLAG</span>}
                </motion.li>
              ))}
            </AnimatePresence>
            {lines.length === 0 && (
              <li className="sdd__empty">Start the run to stream events.</li>
            )}
          </ul>
        </div>

        <div className="sdd__side">
          <AnimatePresence mode="wait">
            {collapsed && incidentReady ? (
              <motion.div
                key="incident"
                className="sdd__incident"
                initial={{ opacity: 0, scale: reduce ? 1 : 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.35, ease }}
              >
                <div className="sdd__incident-head">
                  <span className="sdd__incident-tag">Incident</span>
                  <span className="sdd__incident-count">
                    {incidentLines.length} events
                  </span>
                </div>
                <div className="sdd__cause">
                  <span className="sdd__cause-label">probable root cause</span>
                  <span className="sdd__cause-val">
                    {rootCause ? `${rootCause.subsystem}: ${rootCause.msg}` : ''}
                  </span>
                </div>
                <ol className="sdd__timeline">
                  {incidentLines.map((l, i) => (
                    <li key={l.seq} className="sdd__tl-item">
                      <span className="sdd__tl-dot" data-root={i === 0} />
                      <span className="sdd__tl-time">+{l.offset} ms</span>
                      <span className="sdd__tl-sub">{l.subsystem}</span>
                      <span className="sdd__tl-msg">{l.msg}</span>
                    </li>
                  ))}
                </ol>
              </motion.div>
            ) : (
              <motion.div
                key="rules"
                className="sdd__rules"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.25 }}
              >
                <div className="sdd__rules-head">Rule engine</div>
                <ul className="sdd__rule-list">
                  {(['hydraulic', 'actuator', 'sensor', 'controller'] as Subsystem[]).map(
                    (sub) => {
                      const hit = lines.some(
                        (l) => l.subsystem === sub && l.level === 'fail',
                      );
                      return (
                        <li
                          key={sub}
                          className={`sdd__rule ${hit ? 'sdd__rule--hit' : ''}`}
                        >
                          <span className="sdd__rule-dot" />
                          <span className="sdd__rule-name">{sub} failure signature</span>
                          <span className="sdd__rule-state">
                            {hit ? 'TRIPPED' : 'armed'}
                          </span>
                        </li>
                      );
                    },
                  )}
                </ul>
                {incidentReady && (
                  <button
                    className="sdd__collapse-btn"
                    onClick={() => setCollapsed(true)}
                  >
                    Correlate {failureLines.length} failures
                  </button>
                )}
                {!incidentReady && (
                  <div className="sdd__rules-meta">
                    {THROUGHPUT.toLocaleString()} ev/s, fan-out under {FANOUT_US} us at
                    P99 across {SUBSCRIBERS} subscribers
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={start} disabled={running}>
          {running ? 'Streaming…' : 'Start run'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reconnect}
          disabled={running || lines.length === 0}
        >
          Drop and reconnect
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">
          {collapsed
            ? 'one incident, root cause ordered'
            : `${failureLines.length} failure signatures tripped`}
        </span>
      </div>
    </div>
  );
}
