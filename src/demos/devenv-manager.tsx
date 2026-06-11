import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './devenv-manager.css';

// Real numbers from the chaos test: 5 sessions provisioned, the manager was
// SIGKILLed mid-flight, the containers kept running, and on restart the reaper
// reclaimed every one within 26 seconds with orphans_remaining = 0. Identity is
// durable in the Docker daemon via labels, so a restarted manager rebuilds its
// session table from those labels. The reaper sweeps every 30s.
const SESSION_COUNT = 5;
const RECLAIM_SECONDS = 26;
const SWEEP_SECONDS = 30;
const VOLUME_RETENTION_HOURS = 24;

type Phase = 'idle' | 'killed' | 'restart' | 'reaped';

type Session = {
  id: string;
  label: string;
  ttl: number; // seconds remaining on the container TTL
  pid: number; // PID label the orphan reaper keys on
};

const initialSessions: Session[] = [
  { id: 'a1f3', label: 'go-1.22', ttl: 612, pid: 20481 },
  { id: 'b7c2', label: 'node-20', ttl: 540, pid: 20517 },
  { id: 'c4e9', label: 'py-3.12', ttl: 488, pid: 20536 },
  { id: 'd2a8', label: 'rust-1.78', ttl: 421, pid: 20559 },
  { id: 'e9b1', label: 'go-1.22', ttl: 377, pid: 20574 },
];

const ease = [0.22, 1, 0.36, 1] as const;

function fmt(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const bootLines = [
  '$ devenv up --shell go-1.22',
  'pulling template go-1.22 ... cached',
  'creating container devenv-a1f3 ...',
  'labels: session=a1f3 pid=20481 ttl=612',
  'attaching pty (xterm 80x24) ...',
  'go version go1.22.0 linux/amd64',
  'session ready. streaming over websocket.',
];

export default function DevenvManagerDemo() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [sessions, setSessions] = useState<Session[]>(initialSessions);
  const [reaped, setReaped] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [bootShown, setBootShown] = useState(0);
  const [cursorOn, setCursorOn] = useState(true);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }

  useEffect(() => clearTimers, []);

  // TTL countdown ticks while the manager is alive (idle phase).
  useEffect(() => {
    if (phase !== 'idle') return;
    const iv = window.setInterval(() => {
      setSessions((prev) =>
        prev.map((s) => ({ ...s, ttl: Math.max(0, s.ttl - 1) })),
      );
    }, 1000);
    return () => clearInterval(iv);
  }, [phase]);

  // Boot log reveal and blinking cursor.
  useEffect(() => {
    if (reduce) {
      setBootShown(bootLines.length);
      return;
    }
    setBootShown(0);
    const iv = window.setInterval(() => {
      setBootShown((n) => (n < bootLines.length ? n + 1 : n));
    }, 360);
    return () => clearInterval(iv);
  }, [reduce]);

  useEffect(() => {
    if (reduce) return;
    const iv = window.setInterval(() => setCursorOn((c) => !c), 520);
    return () => clearInterval(iv);
  }, [reduce]);

  function reset() {
    clearTimers();
    setPhase('idle');
    setSessions(initialSessions);
    setReaped([]);
    setElapsed(0);
  }

  function killManager() {
    if (phase !== 'idle') return;
    clearTimers();
    setReaped([]);
    setElapsed(0);
    setPhase('killed');

    if (reduce) {
      setPhase('restart');
      setReaped(initialSessions.map((s) => s.id));
      setElapsed(RECLAIM_SECONDS);
      setPhase('reaped');
      return;
    }

    // The manager process dies, but the labeled containers keep running.
    timers.current.push(
      window.setTimeout(() => setPhase('restart'), 900),
    );

    // On restart the reaper rebuilds the table from labels and reclaims each
    // orphaned container one by one, finishing inside the reclaim window.
    const stepGap = 520;
    initialSessions.forEach((s, i) => {
      timers.current.push(
        window.setTimeout(
          () => {
            setReaped((prev) => [...prev, s.id]);
            const frac = (i + 1) / initialSessions.length;
            setElapsed(Math.round(frac * RECLAIM_SECONDS));
          },
          1500 + i * stepGap,
        ),
      );
    });

    timers.current.push(
      window.setTimeout(
        () => {
          setElapsed(RECLAIM_SECONDS);
          setPhase('reaped');
        },
        1500 + initialSessions.length * stepGap + 200,
      ),
    );
  }

  const managerDown = phase === 'killed' || phase === 'restart';
  const orphansRemaining =
    phase === 'reaped' ? 0 : SESSION_COUNT - reaped.length;

  const statusText =
    phase === 'idle'
      ? `${SESSION_COUNT} sessions live, TTLs counting down`
      : phase === 'killed'
        ? 'manager SIGKILLed, containers still running'
        : phase === 'restart'
          ? 'manager restarting, rebuilding table from labels'
          : `reclaimed ${SESSION_COUNT} of ${SESSION_COUNT}, orphans_remaining = 0`;

  return (
    <div className="demo" aria-label="devenv-manager chaos recovery demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Kill the manager, keep the containers</h3>
      <p className="demo__lede">
        Each session is a fresh container with a PTY shell streamed over a
        WebSocket, and container identity lives in Docker labels. SIGKILL the
        manager mid-flight: the containers survive, and on restart the reaper
        rebuilds its table from labels and reclaims every one.
      </p>

      <div className="dv__stage">
        <div className="dv__left">
          <div className="dv__term" role="group" aria-label="container terminal">
            <div className="dv__term-bar">
              <span className="dv__term-dot" />
              <span className="dv__term-dot" />
              <span className="dv__term-dot" />
              <span className="dv__term-title">devenv-a1f3 :: go-1.22</span>
              <span
                className={
                  managerDown
                    ? 'dv__term-link dv__term-link--down'
                    : 'dv__term-link'
                }
              >
                {managerDown ? 'ws: reconnecting' : 'ws: live'}
              </span>
            </div>
            <div className="dv__term-body">
              {bootLines.slice(0, bootShown).map((line, i) => (
                <div
                  key={i}
                  className={
                    line.startsWith('$') ? 'dv__term-cmd' : 'dv__term-out'
                  }
                >
                  {line}
                </div>
              ))}
              {bootShown >= bootLines.length && (
                <div className="dv__term-cmd">
                  ${' '}
                  <span
                    className="dv__cursor"
                    style={{ opacity: cursorOn ? 1 : 0 }}
                    aria-hidden="true"
                  />
                </div>
              )}
            </div>
          </div>

          <div
            className={
              phase === 'reaped'
                ? 'dv__counter dv__counter--ok'
                : managerDown
                  ? 'dv__counter dv__counter--warn'
                  : 'dv__counter'
            }
            role="status"
            aria-live="polite"
          >
            <div className="dv__counter-row">
              <span className="dv__counter-key">orphans_remaining</span>
              <span className="dv__counter-val">{orphansRemaining}</span>
            </div>
            <div className="dv__counter-row">
              <span className="dv__counter-key">reaper elapsed</span>
              <span className="dv__counter-val">{elapsed}s</span>
            </div>
            <div className="dv__counter-meta">{statusText}</div>
          </div>
        </div>

        <div className="dv__right">
          <div className="dv__panel-head">
            <span>session table</span>
            <span className="dv__panel-meta">
              {phase === 'restart' || phase === 'reaped'
                ? 'rebuilt from Docker labels'
                : `${SWEEP_SECONDS}s reaper sweep`}
            </span>
          </div>
          <div className="dv__tiles">
            {sessions.map((s) => {
              const isReaped = reaped.includes(s.id);
              return (
                <motion.div
                  key={s.id}
                  className={
                    isReaped
                      ? 'dv__tile dv__tile--reaped'
                      : managerDown
                        ? 'dv__tile dv__tile--orphan'
                        : 'dv__tile'
                  }
                  animate={
                    reduce
                      ? {}
                      : isReaped
                        ? { opacity: 0.55, scale: 0.98 }
                        : { opacity: 1, scale: 1 }
                  }
                  transition={{ duration: 0.35, ease }}
                >
                  <div className="dv__tile-top">
                    <span className="dv__tile-id">devenv-{s.id}</span>
                    <span className="dv__tile-img">{s.label}</span>
                  </div>
                  <div className="dv__tile-bottom">
                    <span className="dv__tile-pid">pid {s.pid}</span>
                    {isReaped ? (
                      <span className="dv__tile-state dv__tile-state--reaped">
                        reclaimed
                      </span>
                    ) : managerDown ? (
                      <span className="dv__tile-state dv__tile-state--orphan">
                        orphan
                      </span>
                    ) : (
                      <span className="dv__tile-ttl">ttl {fmt(s.ttl)}</span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>

          <AnimatePresence>
            {phase === 'reaped' && (
              <motion.div
                className="dv__verdict"
                initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease }}
              >
                <span className="dv__verdict-head">
                  {SESSION_COUNT} reclaimed in {RECLAIM_SECONDS}s
                </span>
                <span className="dv__verdict-text">
                  Server SIGKILLed mid-flight, containers survived, and the
                  reaper reclaimed every one within {RECLAIM_SECONDS} seconds
                  with orphans_remaining = 0. Named volumes survive reaping and
                  reattach within a {VOLUME_RETENTION_HOURS}h window.
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={killManager}
          disabled={phase !== 'idle'}
        >
          {phase === 'idle' ? 'SIGKILL the manager' : 'Recovering…'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={phase === 'killed' || phase === 'restart'}
        >
          Reset
        </button>
        <span className="demo__hint">
          {phase === 'idle'
            ? 'containers outlive the manager process'
            : statusText}
        </span>
      </div>
    </div>
  );
}
