import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './agentflow.css';

// AgentFlow runs a workflow as a dependency DAG of named steps. Each step runs
// under a retry-with-backoff policy, routes its model call across registered
// providers with fallback, validates the output against a declared schema, and
// records a per-step trace. The scenario below is scripted from those real
// runtime guarantees: one step needs a retry, one fails its primary provider
// and falls back, so the viewer sees routing, retry, and tracing in motion.

type StepId = 'ingest' | 'extract' | 'classify' | 'enrich' | 'compose';
type Status = 'pending' | 'running' | 'retry' | 'ok' | 'failover';

type Provider = { name: string; outcome: 'ok' | 'invalid' | 'down' };

type StepDef = {
  id: StepId;
  label: string;
  deps: StepId[];
  x: number;
  y: number;
  // Providers tried in priority order; the runtime falls back on failure or an
  // output that fails schema validation.
  providers: Provider[];
  // Attempts under the retry policy before the (final) provider succeeds.
  attempts: number;
};

const STEPS: StepDef[] = [
  {
    id: 'ingest',
    label: 'ingest',
    deps: [],
    x: 70,
    y: 150,
    providers: [{ name: 'local', outcome: 'ok' }],
    attempts: 1,
  },
  {
    id: 'extract',
    label: 'extract',
    deps: ['ingest'],
    x: 220,
    y: 70,
    providers: [{ name: 'primary', outcome: 'ok' }],
    attempts: 2,
  },
  {
    id: 'classify',
    label: 'classify',
    deps: ['ingest'],
    x: 220,
    y: 230,
    providers: [
      { name: 'primary', outcome: 'invalid' },
      { name: 'backup', outcome: 'ok' },
    ],
    attempts: 1,
  },
  {
    id: 'enrich',
    label: 'enrich',
    deps: ['extract', 'classify'],
    x: 380,
    y: 150,
    providers: [{ name: 'primary', outcome: 'ok' }],
    attempts: 1,
  },
  {
    id: 'compose',
    label: 'compose',
    deps: ['enrich'],
    x: 530,
    y: 150,
    providers: [{ name: 'primary', outcome: 'ok' }],
    attempts: 1,
  },
];

// Backoff sleeper is injected so runs are deterministic; these are the backoff
// waits a retried attempt reports, in milliseconds.
const BACKOFF_MS = [0, 200, 400];

type TraceRow = {
  id: StepId;
  status: 'ok' | 'failover';
  attempts: number;
  provider: string;
  durationMs: number;
  errors: string[];
};

const order: StepId[] = ['ingest', 'extract', 'classify', 'enrich', 'compose'];

const stepIndex = (id: StepId) => order.indexOf(id);

const ease = [0.22, 1, 0.36, 1] as const;

export default function AgentflowDemo() {
  const reduce = useReducedMotion();
  const [status, setStatus] = useState<Record<StepId, Status>>(() =>
    Object.fromEntries(order.map((id) => [id, 'pending'])) as Record<StepId, Status>,
  );
  const [trace, setTrace] = useState<TraceRow[]>([]);
  const [cursor, setCursor] = useState(0); // how many steps have completed
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState<StepId | null>(null);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    setStatus(
      Object.fromEntries(order.map((id) => [id, 'pending'])) as Record<StepId, Status>,
    );
    setTrace([]);
    setCursor(0);
    setActive(null);
    setRunning(false);
  }, [clearTimers]);

  // Build the finished trace row for a step from its scripted definition.
  const traceFor = useCallback((def: StepDef): TraceRow => {
    const failed = def.providers.findIndex((p) => p.outcome === 'ok');
    const provider = def.providers[failed]?.name ?? def.providers[0].name;
    const errors: string[] = [];
    def.providers.forEach((p, i) => {
      if (i < failed) {
        errors.push(
          p.outcome === 'invalid'
            ? `${p.name}: schema violation`
            : `${p.name}: unavailable`,
        );
      }
    });
    for (let a = 1; a < def.attempts; a += 1) {
      errors.push(`${provider}: timeout, backoff ${BACKOFF_MS[a]}ms`);
    }
    const baseMs = 120;
    const durationMs =
      baseMs * def.attempts +
      failed * 90 +
      BACKOFF_MS.slice(1, def.attempts).reduce((a, b) => a + b, 0);
    return {
      id: def.id,
      status: failed > 0 ? 'failover' : 'ok',
      attempts: def.attempts,
      provider,
      durationMs,
      errors,
    };
  }, []);

  const completeAll = useCallback(() => {
    clearTimers();
    setStatus(
      Object.fromEntries(
        STEPS.map((s) => [
          s.id,
          s.providers.some((p) => p.outcome !== 'ok') ? 'failover' : 'ok',
        ]),
      ) as Record<StepId, Status>,
    );
    setTrace(STEPS.map(traceFor));
    setCursor(order.length);
    setActive(null);
    setRunning(false);
  }, [clearTimers, traceFor]);

  // Holds the latest runStep so the auto-advance timeout can recurse without
  // referencing the callback before it is declared.
  const runStepRef = useRef<(idx: number, auto: boolean) => void>(() => {});

  // Run a single step's animated lifecycle, then advance the cursor.
  const runStep = useCallback(
    (idx: number, auto: boolean) => {
      if (idx >= order.length) {
        setRunning(false);
        setActive(null);
        return;
      }
      const def = STEPS[idx];
      const hasFailover = def.providers.some((p) => p.outcome !== 'ok');
      const hasRetry = def.attempts > 1;
      setActive(def.id);
      setStatus((s) => ({ ...s, [def.id]: 'running' }));

      const seq: Array<[number, () => void]> = [];
      let t = 360;
      if (hasRetry) {
        seq.push([t, () => setStatus((s) => ({ ...s, [def.id]: 'retry' }))]);
        t += 420;
        seq.push([t, () => setStatus((s) => ({ ...s, [def.id]: 'running' }))]);
        t += 360;
      }
      if (hasFailover) {
        seq.push([t, () => setStatus((s) => ({ ...s, [def.id]: 'failover' }))]);
        t += 360;
      }
      seq.push([
        t,
        () => {
          setStatus((s) => ({
            ...s,
            [def.id]: hasFailover ? 'failover' : 'ok',
          }));
          setTrace((tr) => [...tr, traceFor(def)]);
          setCursor(idx + 1);
          setActive(null);
          if (auto) {
            const nx = window.setTimeout(() => runStepRef.current(idx + 1, true), 320);
            timers.current.push(nx);
          } else {
            setRunning(false);
          }
        },
      ]);

      seq.forEach(([delay, fn]) => {
        timers.current.push(window.setTimeout(fn, delay));
      });
    },
    [traceFor],
  );

  useEffect(() => {
    runStepRef.current = runStep;
  }, [runStep]);

  const play = useCallback(() => {
    if (running) return;
    reset();
    if (reduce) {
      completeAll();
      return;
    }
    setRunning(true);
    const start = window.setTimeout(() => runStep(0, true), 60);
    timers.current.push(start);
  }, [running, reset, reduce, completeAll, runStep]);

  const stepOnce = useCallback(() => {
    if (running || cursor >= order.length) return;
    if (reduce) {
      const def = STEPS[cursor];
      setStatus((s) => ({
        ...s,
        [def.id]: def.providers.some((p) => p.outcome !== 'ok') ? 'failover' : 'ok',
      }));
      setTrace((tr) => [...tr, traceFor(def)]);
      setCursor(cursor + 1);
      return;
    }
    setRunning(true);
    runStep(cursor, false);
  }, [running, cursor, reduce, traceFor, runStep]);

  const allDone = cursor >= order.length;
  const failovers = trace.filter((r) => r.status === 'failover').length;
  const totalAttempts = trace.reduce((a, r) => a + r.attempts, 0);

  return (
    <div className="demo" aria-label="AgentFlow workflow runtime demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Run the workflow DAG</h3>
      <p className="demo__lede">
        Step or play the run. Steps fire in dependency order. One needs a retry
        with backoff, and classify fails schema validation on its primary
        provider and routes to the backup. The trace fills in per step with
        status, attempts, provider, and timing.
      </p>

      <div className="af__stage">
        <div className="af__graph">
          <svg
            className="af__svg"
            viewBox="0 0 620 300"
            role="group"
            aria-label="workflow dependency graph"
          >
            <defs>
              <marker
                id="af-arrow"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill="var(--line)" />
              </marker>
              <marker
                id="af-arrow-on"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill="var(--accent)" />
              </marker>
            </defs>

            {/* dependency edges */}
            {STEPS.flatMap((s) =>
              s.deps.map((d) => {
                const from = STEPS.find((n) => n.id === d)!;
                const lit = cursor > stepIndex(d) && cursor > stepIndex(s.id) - 1;
                const flowing = active === s.id && cursor > stepIndex(d);
                return (
                  <motion.path
                    key={`${d}-${s.id}`}
                    d={`M ${from.x + 52} ${from.y} C ${from.x + 110} ${from.y}, ${
                      s.x - 58
                    } ${s.y}, ${s.x - 52} ${s.y}`}
                    fill="none"
                    stroke={lit || flowing ? 'var(--accent)' : 'var(--line)'}
                    strokeWidth={flowing ? 2.2 : 1.4}
                    strokeOpacity={lit || flowing ? 0.85 : 0.5}
                    markerEnd={
                      lit || flowing ? 'url(#af-arrow-on)' : 'url(#af-arrow)'
                    }
                    animate={
                      flowing && !reduce
                        ? { strokeDashoffset: [12, 0] }
                        : { strokeDashoffset: 0 }
                    }
                    strokeDasharray={flowing ? '6 6' : '0'}
                    transition={{ duration: 0.5, repeat: flowing ? Infinity : 0 }}
                  />
                );
              }),
            )}

            {/* step nodes */}
            {STEPS.map((s) => {
              const st = status[s.id];
              const ready = cursor === stepIndex(s.id) && !running && !allDone;
              return (
                <g key={s.id} className={`af__node af__node--${st}`}>
                  <motion.rect
                    x={s.x - 52}
                    y={s.y - 26}
                    width={104}
                    height={52}
                    rx={11}
                    className="af__node-box"
                    animate={
                      st === 'running' && !reduce
                        ? { scale: [1, 1.04, 1] }
                        : st === 'retry' && !reduce
                          ? { scale: [1, 1.08, 1] }
                          : { scale: 1 }
                    }
                    style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                    transition={{
                      duration: st === 'retry' ? 0.42 : 0.8,
                      repeat: st === 'running' || st === 'retry' ? Infinity : 0,
                    }}
                  />
                  <text
                    x={s.x}
                    y={s.y - 4}
                    textAnchor="middle"
                    className="af__node-label"
                  >
                    {s.label}
                  </text>
                  <text
                    x={s.x}
                    y={s.y + 12}
                    textAnchor="middle"
                    className="af__node-state"
                  >
                    {st === 'pending'
                      ? ready
                        ? 'next'
                        : 'queued'
                      : st === 'running'
                        ? 'running'
                        : st === 'retry'
                          ? 'backoff'
                          : st === 'failover'
                            ? 'failover'
                            : 'ok'}
                  </text>
                </g>
              );
            })}

            {/* provider fan-out for the active failover step */}
            <AnimatePresence>
              {active &&
                STEPS.find((s) => s.id === active)!.providers.length > 1 &&
                status[active] === 'failover' && (
                  <motion.g
                    key="fanout"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    {STEPS.find((s) => s.id === active)!.providers.map((p, i) => {
                      const node = STEPS.find((s) => s.id === active)!;
                      const py = node.y - 14 + i * 28;
                      const ok = p.outcome === 'ok';
                      return (
                        <g key={p.name}>
                          <line
                            x1={node.x + 52}
                            y1={node.y}
                            x2={node.x + 84}
                            y2={py}
                            stroke={ok ? 'var(--accent)' : 'var(--paper-faint)'}
                            strokeWidth={1.2}
                            strokeDasharray={ok ? '0' : '3 3'}
                          />
                          <text
                            x={node.x + 90}
                            y={py + 3}
                            className="af__prov"
                            fill={ok ? 'var(--accent)' : 'var(--paper-faint)'}
                          >
                            {p.name} {ok ? '' : 'x'}
                          </text>
                        </g>
                      );
                    })}
                  </motion.g>
                )}
            </AnimatePresence>
          </svg>
        </div>

        <div className="af__trace" aria-live="polite">
          <div className="af__trace-head">
            <span>per-step trace</span>
            <span className="af__trace-count">
              {trace.length} / {order.length}
            </span>
          </div>
          <ul className="af__trace-list">
            <AnimatePresence initial={false}>
              {trace.map((r) => (
                <motion.li
                  key={r.id}
                  className={`af__row af__row--${r.status}`}
                  initial={{ opacity: 0, x: reduce ? 0 : -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: reduce ? 0 : 0.3, ease }}
                >
                  <span className="af__row-name">{r.id}</span>
                  <span className="af__row-meta">
                    {r.attempts} attempt{r.attempts > 1 ? 's' : ''} ·{' '}
                    <b>{r.provider}</b> · {r.durationMs}ms
                  </span>
                  <span className={`af__row-badge af__row-badge--${r.status}`}>
                    {r.status}
                  </span>
                  {r.errors.length > 0 && (
                    <span className="af__row-errs">{r.errors.join('  ·  ')}</span>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
            {trace.length === 0 && (
              <li className="af__trace-empty">No steps recorded yet.</li>
            )}
          </ul>
        </div>

        <AnimatePresence>
          {allDone && (
            <motion.div
              className="af__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="af__verdict-head">Run complete</span>
              <span className="af__verdict-text">
                {order.length} steps resolved in dependency order over{' '}
                {totalAttempts} attempts, with {failovers} provider failover
                {failovers === 1 ? '' : 's'}. Every model output passed schema
                validation, and each step kept a trace of status, attempts,
                provider, and duration.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={play} disabled={running}>
          {running ? 'Running…' : allDone ? 'Replay' : 'Play run'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={stepOnce}
          disabled={running || allDone}
        >
          Step
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {allDone
            ? 'all steps resolved'
            : `${cursor} of ${order.length} steps done`}
        </span>
      </div>
    </div>
  );
}
