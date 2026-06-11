import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './datapipe.css';

// DataPipe: containerized steps run in dependency order with topological
// scheduling, failed steps retry with exponential backoff and a transient-error
// classifier, and a checkpoint-and-resume run reruns only from the first failed
// step. Edges are inferred from step input references; the run state lives in
// Postgres so every execution is reconstructable.

type Node = {
  id: string;
  label: string;
  // the step inputs that reference upstream outputs (edges are inferred here)
  inputs: string[];
  x: number;
  y: number;
};

// extract -> (clean, geocode) -> join -> load. Edges inferred from inputs.
const NODES: Node[] = [
  { id: 'extract', label: 'extract', inputs: [], x: 60, y: 130 },
  { id: 'clean', label: 'clean', inputs: ['extract'], x: 220, y: 60 },
  { id: 'geocode', label: 'geocode', inputs: ['extract'], x: 220, y: 200 },
  { id: 'join', label: 'join', inputs: ['clean', 'geocode'], x: 380, y: 130 },
  { id: 'load', label: 'load', inputs: ['join'], x: 540, y: 130 },
];

// Topological order over the inferred edges. geocode is the step that fails
// once on a transient error, then succeeds on retry.
const ORDER = ['extract', 'clean', 'geocode', 'join', 'load'];
const FLAKY = 'geocode';

// Exponential backoff schedule the scheduler uses between attempts (ms).
const BACKOFF_MS = [200, 400, 800];

type NodeState = 'pending' | 'running' | 'retry' | 'done' | 'skipped';

type Mode = 'fresh' | 'resume';

type Attempt = { node: string; n: number; backoff: number | null; ok: boolean };

const NODE_W = 96;
const NODE_H = 44;
const ease = [0.22, 1, 0.36, 1] as const;

export default function DatapipeDemo() {
  const reduce = useReducedMotion();
  const [states, setStates] = useState<Record<string, NodeState>>(
    () => Object.fromEntries(NODES.map((n) => [n.id, 'pending'])),
  );
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [failedAt, setFailedAt] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const after = useCallback(
    (ms: number, fn: () => void) => {
      const t = window.setTimeout(fn, reduce ? 0 : ms);
      timers.current.push(t);
    },
    [reduce],
  );

  function reset(keepFailed: boolean) {
    clearTimers();
    setRunning(false);
    setDone(false);
    setAttempts([]);
    if (!keepFailed) setFailedAt(null);
    setStates(Object.fromEntries(NODES.map((n) => [n.id, 'pending'])));
  }

  // Fresh run: walk topological order, the flaky step fails its first attempt
  // (transient classifier), backs off, retries, then completes the rest.
  function runFresh() {
    if (running) return;
    reset(false);
    setMode('fresh');
    setRunning(true);
    setDone(false);

    let t = 300;
    const step = 620;

    ORDER.forEach((id) => {
      const isFlaky = id === FLAKY;
      after(t, () => setState(id, 'running'));
      if (isFlaky) {
        // first attempt fails, classified transient
        after(t + step, () => {
          setState(id, 'retry');
          addAttempt(id, 1, null, false);
        });
        const back = BACKOFF_MS[0];
        after(t + step + 120, () => addAttempt(id, 2, back, false));
        // retry after backoff, succeeds
        after(t + step + back + step, () => {
          setState(id, 'done');
          markAttemptOk(id, 2);
        });
        t += step + back + step;
      } else {
        after(t + step, () => {
          setState(id, 'done');
          addAttempt(id, 1, null, true);
        });
        t += step;
      }
    });

    after(t + 300, () => {
      setRunning(false);
      setDone(true);
    });
  }

  // Force-fail run: stops at the first failed step so the resume run can show
  // checkpoint-and-resume behavior.
  function runUntilFail() {
    if (running) return;
    reset(false);
    setMode('fresh');
    setRunning(true);
    setDone(false);

    let t = 300;
    const step = 620;
    for (const id of ORDER) {
      if (id === FLAKY) {
        after(t, () => setState(id, 'running'));
        after(t + step, () => {
          setState(id, 'retry');
          addAttempt(id, 1, null, false);
          addAttempt(id, 2, BACKOFF_MS[0], false);
          addAttempt(id, 3, BACKOFF_MS[1], false);
          setFailedAt(id);
          setRunning(false);
        });
        break;
      }
      after(t, () => setState(id, 'running'));
      after(t + step, () => {
        setState(id, 'done');
        addAttempt(id, 1, null, true);
      });
      t += step;
    }
  }

  // Resume run: only steps from the first failed step onward rerun; everything
  // before it is read back from the Postgres audit trail, not recomputed.
  function runResume() {
    if (running || !failedAt) return;
    clearTimers();
    setMode('resume');
    setRunning(true);
    setDone(false);
    setAttempts([]);

    const failIdx = ORDER.indexOf(failedAt);
    const next: Record<string, NodeState> = {};
    ORDER.forEach((id, i) => {
      next[id] = i < failIdx ? 'done' : 'pending';
    });
    setStates(next);

    const resumeList = ORDER.slice(failIdx);
    let t = 300;
    const step = 620;
    resumeList.forEach((id) => {
      after(t, () => setState(id, 'running'));
      after(t + step, () => {
        setState(id, 'done');
        addAttempt(id, 1, null, true);
      });
      t += step;
    });
    after(t + 300, () => {
      setRunning(false);
      setDone(true);
      setFailedAt(null);
    });
  }

  function setState(id: string, s: NodeState) {
    setStates((prev) => ({ ...prev, [id]: s }));
  }
  function addAttempt(node: string, n: number, backoff: number | null, ok: boolean) {
    setAttempts((prev) => [...prev, { node, n, backoff, ok }]);
  }
  function markAttemptOk(node: string, n: number) {
    setAttempts((prev) =>
      prev.map((a) => (a.node === node && a.n === n ? { ...a, ok: true } : a)),
    );
  }

  const edges = NODES.flatMap((n) =>
    n.inputs.map((from) => ({ from, to: n.id })),
  );
  const failIdx = failedAt ? ORDER.indexOf(failedAt) : -1;

  return (
    <div className="demo" aria-label="datapipe DAG execution demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Run the DAG, retry, resume from the failure</h3>
      <p className="demo__lede">
        Steps run in topological order over edges inferred from their inputs. The
        geocode step hits a transient error and retries with exponential backoff.
        Fail it, then resume to rerun only the steps after the first failure.
      </p>

      <div className="dp__graph">
        <svg
          className="dp__svg"
          viewBox="0 0 636 280"
          role="group"
          aria-label="workflow dependency graph"
        >
          <defs>
            <marker
              id="dp-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 Z" fill="var(--line)" />
            </marker>
          </defs>

          {edges.map((e) => {
            const a = NODES.find((n) => n.id === e.from)!;
            const b = NODES.find((n) => n.id === e.to)!;
            const active =
              states[e.from] === 'done' &&
              (states[e.to] === 'running' || states[e.to] === 'done');
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const mx = (x1 + x2) / 2;
            return (
              <motion.path
                key={`${e.from}-${e.to}`}
                d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2 - 4} ${y2}`}
                fill="none"
                stroke={active ? 'var(--accent)' : 'var(--line)'}
                strokeWidth={active ? 2 : 1.2}
                strokeOpacity={active ? 0.9 : 0.5}
                markerEnd="url(#dp-arrow)"
                animate={{ pathLength: 1 }}
                transition={{ duration: reduce ? 0 : 0.3, ease }}
              />
            );
          })}

          {NODES.map((n) => {
            const s = states[n.id];
            return (
              <g key={n.id} className={`dp__node dp__node--${s}`}>
                <motion.rect
                  x={n.x}
                  y={n.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={10}
                  animate={
                    s === 'running' && !reduce
                      ? { opacity: [0.7, 1, 0.7] }
                      : { opacity: 1 }
                  }
                  transition={
                    s === 'running'
                      ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' }
                      : { duration: 0.2 }
                  }
                />
                <text
                  x={n.x + NODE_W / 2}
                  y={n.y + 19}
                  textAnchor="middle"
                  className="dp__node-label"
                >
                  {n.label}
                </text>
                <text
                  x={n.x + NODE_W / 2}
                  y={n.y + 33}
                  textAnchor="middle"
                  className="dp__node-state"
                >
                  {s}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="dp__panels">
        <div className="dp__attempts">
          <div className="dp__panel-head">step attempts</div>
          <ul className="dp__attempt-list">
            <AnimatePresence initial={false}>
              {attempts.map((a, i) => (
                <motion.li
                  key={`${a.node}-${a.n}-${i}`}
                  className={`dp__attempt${a.ok ? ' dp__attempt--ok' : ' dp__attempt--fail'}`}
                  initial={{ opacity: 0, x: reduce ? 0 : -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, ease }}
                >
                  <span className="dp__attempt-node">{a.node}</span>
                  <span className="dp__attempt-n">attempt {a.n}</span>
                  <span className="dp__attempt-meta">
                    {a.ok
                      ? 'ok'
                      : a.backoff != null
                        ? `transient, backoff ${a.backoff}ms`
                        : 'transient error'}
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
            {attempts.length === 0 && (
              <li className="dp__attempt-empty">no attempts yet</li>
            )}
          </ul>
        </div>

        <div className="dp__meta">
          <div className="dp__panel-head">run</div>
          <div className="dp__meta-row">
            <span className="dp__meta-k">mode</span>
            <span className="dp__meta-v">{mode ?? 'idle'}</span>
          </div>
          <div className="dp__meta-row">
            <span className="dp__meta-k">backoff</span>
            <span className="dp__meta-v">
              {BACKOFF_MS.map((b) => `${b}ms`).join(' / ')}
            </span>
          </div>
          <div className="dp__meta-row">
            <span className="dp__meta-k">first failure</span>
            <span className="dp__meta-v">{failedAt ?? '-'}</span>
          </div>
          {failIdx >= 0 && !running && (
            <div className="dp__resume-note">
              resume reruns {ORDER.length - failIdx} of {ORDER.length} steps;{' '}
              {failIdx} replayed from the Postgres audit trail
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {done && (
          <motion.div
            className="dp__verdict"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            <span className="dp__verdict-head">
              {mode === 'resume' ? 'resumed from the failure' : 'run complete'}
            </span>
            <span className="dp__verdict-text">
              {mode === 'resume'
                ? 'Only the steps after the first failure reran. Completed upstream steps were read back from the audit trail rather than recomputed.'
                : 'The flaky step failed once on a transient error, backed off, retried, and the run finished in topological order.'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button className="demo__btn" onClick={runFresh} disabled={running}>
          {running && mode === 'fresh' ? 'Running…' : 'Run with retry'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={runUntilFail}
          disabled={running}
        >
          Force fail
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={runResume}
          disabled={running || !failedAt}
        >
          Resume
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => reset(false)}
          disabled={running}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
