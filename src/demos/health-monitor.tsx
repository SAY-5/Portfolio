import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './health-monitor.css';

// The recovery trigger is three CONSECUTIVE failures, not a rate window. The
// streak counter resets to zero on any passing check, so a hook only fires
// when a service is genuinely down right now. Each firing writes a durable
// audit row with endpoint, action kind, args, exit code, and duration.
const TRIGGER = 3;
const SLOTS = 18; // visible checks in the rolling timeline

type Hook = 'bash' | 'systemctl' | 'noop';

type Endpoint = {
  id: string;
  name: string;
  kind: 'HTTP' | 'TCP';
  target: string;
  hook: Hook;
  command: string;
};

const ENDPOINTS: Endpoint[] = [
  {
    id: 'api',
    name: 'api',
    kind: 'HTTP',
    target: 'GET https://api.internal/healthz',
    hook: 'bash',
    command: './hooks/restart-api.sh',
  },
  {
    id: 'db',
    name: 'postgres',
    kind: 'TCP',
    target: 'tcp db.internal:5432',
    hook: 'systemctl',
    command: 'systemctl restart postgresql',
  },
  {
    id: 'cache',
    name: 'redis',
    kind: 'TCP',
    target: 'tcp cache.internal:6379',
    hook: 'noop',
    command: 'noop (observe only)',
  },
];

type Check = 'up' | 'down';

type Audit = {
  id: number;
  endpoint: string;
  hook: Hook;
  args: string;
  exit: number;
  ms: number;
  ts: string;
};

type EpState = {
  history: Check[];
  streak: number; // consecutive failures
  checks: number;
  fails: number;
  latency: number; // last response latency in ms
  firing: boolean;
};

function blankState(): Record<string, EpState> {
  const m: Record<string, EpState> = {};
  for (const e of ENDPOINTS) {
    m[e.id] = {
      history: [],
      streak: 0,
      checks: 0,
      fails: 0,
      latency: 0,
      firing: false,
    };
  }
  return m;
}

// Per-endpoint probability that a single check fails. The default health is
// good; "Force outage" raises one endpoint's failure rate so the streak can
// climb to the trigger.
const BASE_FAIL = 0.04;

const ease = [0.22, 1, 0.36, 1] as const;

export default function HealthMonitorDemo() {
  const reduce = useReducedMotion();
  const [states, setStates] = useState<Record<string, EpState>>(blankState);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [running, setRunning] = useState(false);
  const [outage, setOutage] = useState<string | null>(null);
  const tickRef = useRef<number | null>(null);
  const auditId = useRef(0);
  const outageRef = useRef<string | null>(null);
  useEffect(() => {
    outageRef.current = outage;
  }, [outage]);

  function stop() {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  useEffect(() => stop, []);

  function pushAudit(e: Endpoint) {
    auditId.current += 1;
    const ms = e.hook === 'noop' ? 0 : 40 + Math.round(Math.random() * 220);
    const exit = e.hook === 'noop' ? 0 : 0;
    const now = new Date();
    const ts = now.toTimeString().slice(0, 8);
    setAudit((prev) =>
      [
        {
          id: auditId.current,
          endpoint: e.name,
          hook: e.hook,
          args: e.command,
          exit,
          ms,
          ts,
        },
        ...prev,
      ].slice(0, 6),
    );
  }

  function runOneRound(prev: Record<string, EpState>) {
    const next: Record<string, EpState> = {};
    for (const e of ENDPOINTS) {
      const s = prev[e.id];
      const failRate = outageRef.current === e.id ? 0.85 : BASE_FAIL;
      const failed = Math.random() < failRate;
      const result: Check = failed ? 'down' : 'up';
      let streak = failed ? s.streak + 1 : 0;
      let firing = false;
      // Fire the recovery hook exactly when the streak reaches the trigger,
      // then reset the counter (the hook has acted).
      if (streak >= TRIGGER) {
        firing = true;
        streak = 0;
        pushAudit(e);
      }
      const latency = failed
        ? 0
        : 20 + Math.round(Math.random() * 90);
      next[e.id] = {
        history: [...s.history, result].slice(-SLOTS),
        streak,
        checks: s.checks + 1,
        fails: s.fails + (failed ? 1 : 0),
        latency,
        firing,
      };
    }
    return next;
  }

  function step() {
    setStates((prev) => runOneRound(prev));
  }

  function play() {
    if (running) return;
    setRunning(true);
    if (reduce) {
      // Reduced motion: advance several rounds at once, no interval animation.
      setStates((prev) => {
        let acc = prev;
        for (let i = 0; i < 6; i += 1) acc = runOneRound(acc);
        return acc;
      });
      setRunning(false);
      return;
    }
    tickRef.current = window.setInterval(step, 900);
  }

  function pause() {
    stop();
    setRunning(false);
  }

  function reset() {
    stop();
    setRunning(false);
    setOutage(null);
    setStates(blankState());
    setAudit([]);
  }

  function toggleOutage(id: string) {
    setOutage((cur) => (cur === id ? null : id));
  }

  return (
    <div className="demo" aria-label="health-monitor recovery trigger demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Three strikes, then recover</h3>
      <p className="demo__lede">
        Each endpoint is polled on a rolling timeline. The streak counts only
        consecutive failures and resets to zero on any passing check, so a
        recovery hook fires only when a service is down right now. Force an
        outage to push a streak to {TRIGGER} and watch the hook write an audit
        row.
      </p>

      <div className="hm__stage">
        <div className="hm__endpoints">
          {ENDPOINTS.map((e) => {
            const s = states[e.id];
            const last = s.history[s.history.length - 1];
            const isOut = outage === e.id;
            const uptime =
              s.checks > 0
                ? (((s.checks - s.fails) / s.checks) * 100).toFixed(1)
                : '100.0';
            return (
              <div
                key={e.id}
                className={`hm__ep${s.firing ? ' hm__ep--firing' : ''}`}
              >
                <div className="hm__ep-head">
                  <span
                    className={`hm__ep-dot hm__ep-dot--${
                      s.checks === 0 ? 'idle' : last === 'up' ? 'up' : 'down'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="hm__ep-name">{e.name}</span>
                  <span className="hm__ep-kind">{e.kind}</span>
                  <span className="hm__ep-target">{e.target}</span>
                </div>

                <div
                  className="hm__timeline"
                  role="img"
                  aria-label={`${e.name} last ${s.history.length} checks`}
                >
                  {Array.from({ length: SLOTS }).map((_, i) => {
                    const offset = SLOTS - s.history.length;
                    const v = i >= offset ? s.history[i - offset] : null;
                    return (
                      <motion.span
                        key={i}
                        className={`hm__slot hm__slot--${
                          v === 'up' ? 'up' : v === 'down' ? 'down' : 'empty'
                        }`}
                        initial={false}
                        animate={
                          reduce
                            ? {}
                            : {
                                scale:
                                  i === SLOTS - 1 && v ? [0.6, 1] : 1,
                              }
                        }
                        transition={{ duration: 0.3, ease }}
                      />
                    );
                  })}
                </div>

                <div className="hm__ep-foot">
                  <div className="hm__streak" aria-live="polite">
                    <span className="hm__streak-label">fail streak</span>
                    <span className="hm__streak-pips">
                      {Array.from({ length: TRIGGER }).map((_, i) => (
                        <span
                          key={i}
                          className={`hm__pip${
                            i < s.streak ? ' hm__pip--on' : ''
                          }`}
                        />
                      ))}
                    </span>
                    <span className="hm__streak-num">
                      {s.streak}/{TRIGGER}
                    </span>
                  </div>
                  <div className="hm__ep-metrics">
                    <span>{uptime}% up</span>
                    <span>{s.latency > 0 ? `${s.latency}ms` : 'down'}</span>
                    <button
                      type="button"
                      className={`hm__outage${isOut ? ' hm__outage--on' : ''}`}
                      onClick={() => toggleOutage(e.id)}
                      aria-pressed={isOut}
                    >
                      {isOut ? 'outage on' : 'force outage'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="hm__audit">
          <div className="hm__audit-head">
            <span>recovery_audit</span>
            <span className="hm__audit-sub">durable SQLite rows</span>
          </div>
          <div className="hm__audit-cols">
            <span>endpoint</span>
            <span>action</span>
            <span>exit</span>
            <span>ms</span>
          </div>
          <ul className="hm__audit-list">
            <AnimatePresence initial={false}>
              {audit.length === 0 && (
                <motion.li
                  key="empty"
                  className="hm__audit-empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  no recovery fired yet
                </motion.li>
              )}
              {audit.map((a) => (
                <motion.li
                  key={a.id}
                  className="hm__audit-row"
                  initial={{ opacity: 0, x: reduce ? 0 : -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.32, ease }}
                >
                  <span className="hm__audit-ep">{a.endpoint}</span>
                  <span className="hm__audit-act">
                    <span className={`hm__hook hm__hook--${a.hook}`}>
                      {a.hook}
                    </span>
                    {a.args}
                  </span>
                  <span className="hm__audit-exit">{a.exit}</span>
                  <span className="hm__audit-ms">{a.ms}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      </div>

      <div className="demo__controls">
        {running ? (
          <button type="button" className="demo__btn" onClick={pause}>
            Pause
          </button>
        ) : (
          <button type="button" className="demo__btn" onClick={play}>
            Play
          </button>
        )}
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={step}
          disabled={running}
        >
          Step check
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={reset}
        >
          Reset
        </button>
        <span className="demo__hint">
          {outage
            ? `outage forced on ${
                ENDPOINTS.find((e) => e.id === outage)?.name
              }`
            : 'all endpoints healthy'}
        </span>
      </div>
    </div>
  );
}
