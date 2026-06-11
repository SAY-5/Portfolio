import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './the-matrix.css';

// The Matrix decomposes a task into a DAG, spawns worker agents in PTY
// sessions, and streams their output over SignalR. A separate watchdog
// process polls health, and on a crash-loop it rolls the agent back to a
// git-tagged checkpoint. Stats are the project's real test counts.

type NodeState = 'idle' | 'running' | 'ok' | 'crash' | 'rolled';

type Node = {
  id: string;
  label: string;
  sub: string;
  x: number;
  y: number;
  // The worker that crash-loops in this run (drives the watchdog path).
  faulty?: boolean;
};

const NODES: Node[] = [
  { id: 'root', label: 'operator', sub: 'route + plan', x: 60, y: 150 },
  { id: 'w1', label: 'agent-api', sub: 'pty session', x: 250, y: 60 },
  { id: 'w2', label: 'agent-ui', sub: 'pty session', x: 250, y: 150, faulty: true },
  { id: 'w3', label: 'agent-test', sub: 'pty session', x: 250, y: 240 },
  { id: 'merge', label: 'merge', sub: 'collect', x: 440, y: 150 },
];

const EDGES: [string, string][] = [
  ['root', 'w1'],
  ['root', 'w2'],
  ['root', 'w3'],
  ['w1', 'merge'],
  ['w2', 'merge'],
  ['w3', 'merge'],
];

type TermLine = { id: number; who: string; text: string; kind?: 'err' | 'ok' };

const STATS = [
  { val: '1700+', unit: 'tests total' },
  { val: '1350+', unit: 'xUnit unit tests' },
  { val: '343', unit: 'frontend tests' },
];

const ease = [0.22, 1, 0.36, 1] as const;

export default function TheMatrixDemo() {
  const reduce = useReducedMotion();
  const [states, setStates] = useState<Record<string, NodeState>>(
    () => Object.fromEntries(NODES.map((n) => [n.id, 'idle'])),
  );
  const [lines, setLines] = useState<TermLine[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'running' | 'alarm' | 'rolled'>(
    'idle',
  );
  const timers = useRef<number[]>([]);
  const lineId = useRef(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines]);

  const push = useCallback((who: string, text: string, kind?: 'err' | 'ok') => {
    lineId.current += 1;
    const id = lineId.current;
    setLines((prev) => [...prev, { id, who, text, kind }].slice(-9));
  }, []);

  function setNode(id: string, s: NodeState) {
    setStates((prev) => ({ ...prev, [id]: s }));
  }

  function reset() {
    clearTimers();
    setStates(Object.fromEntries(NODES.map((n) => [n.id, 'idle'])));
    setLines([]);
    setStreaming(false);
    setPhase('idle');
  }

  function run() {
    clearTimers();
    setStates(Object.fromEntries(NODES.map((n) => [n.id, 'idle'])));
    setLines([]);
    setPhase('running');
    setStreaming(true);

    if (reduce) {
      setStates({ root: 'ok', w1: 'ok', w2: 'rolled', w3: 'ok', merge: 'ok' });
      setStreaming(false);
      setPhase('rolled');
      push('operator', 'decomposed task into 3 workers', 'ok');
      push('watchdog', 'agent-ui crash-loop, rolled back to tag v0.4.1', 'ok');
      return;
    }

    const at = (ms: number, fn: () => void) =>
      timers.current.push(window.setTimeout(fn, ms));

    setNode('root', 'running');
    push('operator', 'decompose: build feature -> 3 subtasks');

    at(550, () => {
      setNode('root', 'ok');
      ['w1', 'w2', 'w3'].forEach((id) => setNode(id, 'running'));
      push('operator', 'spawn pty: agent-api, agent-ui, agent-test');
    });

    at(1100, () => push('agent-api', 'GET /sessions 200 ok'));
    at(1500, () => push('agent-test', 'xUnit: 42 passed'));
    at(1900, () => {
      setNode('w1', 'ok');
      setNode('w3', 'ok');
      push('agent-api', 'patch applied', 'ok');
    });

    // agent-ui crash-loops, watchdog detects it.
    at(2300, () => push('agent-ui', 'panic: hook order changed', 'err'));
    at(2700, () => push('agent-ui', 'restart 1 of 3 ... panic', 'err'));
    at(3100, () => {
      setNode('w2', 'crash');
      push('agent-ui', 'restart 3 of 3 ... panic', 'err');
    });
    at(3400, () => {
      setPhase('alarm');
      push('watchdog', 'crash-loop detected on agent-ui', 'err');
    });

    // watchdog rolls back to the last git-tagged checkpoint.
    at(4000, () => {
      setNode('w2', 'rolled');
      push('watchdog', 'git reset --hard v0.4.1', 'ok');
    });
    at(4400, () => {
      setNode('merge', 'running');
      push('watchdog', 'agent-ui restored to tag v0.4.1', 'ok');
    });
    at(4900, () => {
      setNode('merge', 'ok');
      setStreaming(false);
      setPhase('rolled');
      push('operator', 'merge complete, run stable', 'ok');
    });
  }

  const wdClass =
    phase === 'alarm'
      ? 'mx__watchdog--alarm'
      : phase === 'rolled'
        ? 'mx__watchdog--rolled'
        : '';

  return (
    <div className="demo" aria-label="the matrix agent orchestration demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Decompose, stream, recover</h3>
      <p className="demo__lede">
        Run a task to watch the operator decompose it into a worker DAG and spawn
        PTY agents whose output streams over SignalR. One worker crash-loops, the
        watchdog flags it, and rolls the agent back to a git-tagged checkpoint.
      </p>

      <div className="mx__stage">
        <div className="mx__graph">
          <svg
            className="mx__svg"
            viewBox="0 0 540 300"
            role="group"
            aria-label="agent task DAG"
          >
            <defs>
              <marker
                id="mx-arrow"
                viewBox="0 0 8 8"
                refX="6"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill="var(--line)" />
              </marker>
            </defs>

            {EDGES.map(([from, to]) => {
              const a = NODES.find((n) => n.id === from)!;
              const b = NODES.find((n) => n.id === to)!;
              const active =
                states[from] !== 'idle' && states[to] !== 'idle';
              return (
                <motion.path
                  key={`${from}-${to}`}
                  d={`M ${a.x + 78} ${a.y} C ${a.x + 130} ${a.y}, ${b.x - 52} ${b.y}, ${b.x - 4} ${b.y}`}
                  fill="none"
                  stroke={active ? 'var(--accent)' : 'var(--line)'}
                  strokeWidth={active ? 1.6 : 1.2}
                  strokeOpacity={active ? 0.7 : 0.5}
                  markerEnd="url(#mx-arrow)"
                  initial={false}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: reduce ? 0 : 0.4, ease }}
                />
              );
            })}

            {NODES.map((n) => {
              const st = states[n.id];
              const stroke =
                st === 'crash'
                  ? '#ff5f57'
                  : st === 'ok' || st === 'rolled'
                    ? 'rgba(79, 208, 138, 0.7)'
                    : st === 'running'
                      ? 'var(--accent)'
                      : 'var(--line)';
              const fill =
                st === 'running'
                  ? 'var(--accent-glow)'
                  : st === 'idle'
                    ? 'var(--ink-850)'
                    : 'var(--ink-700)';
              const stateLabel =
                st === 'rolled'
                  ? 'rolled back'
                  : st === 'crash'
                    ? 'crash-loop'
                    : st === 'ok'
                      ? 'done'
                      : st === 'running'
                        ? 'running'
                        : 'idle';
              const stateColor =
                st === 'crash'
                  ? '#ff5f57'
                  : st === 'ok'
                    ? '#4fd08a'
                    : st === 'rolled'
                      ? '#4fd08a'
                      : st === 'running'
                        ? 'var(--accent)'
                        : 'var(--paper-faint)';
              return (
                <motion.g
                  key={n.id}
                  initial={false}
                  animate={
                    st === 'crash' && !reduce
                      ? { x: [0, -2, 2, -2, 0] }
                      : { x: 0 }
                  }
                  transition={{ duration: 0.3, repeat: st === 'crash' ? 2 : 0 }}
                >
                  <rect
                    className="mx__node-box"
                    x={n.x - 4}
                    y={n.y - 24}
                    width={82}
                    height={48}
                    rx={9}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={st === 'idle' ? 1 : 1.8}
                  />
                  <text x={n.x + 37} y={n.y - 6} textAnchor="middle" className="mx__node-label">
                    {n.label}
                  </text>
                  <text x={n.x + 37} y={n.y + 6} textAnchor="middle" className="mx__node-sub">
                    {n.sub}
                  </text>
                  <text
                    x={n.x + 37}
                    y={n.y + 18}
                    textAnchor="middle"
                    className="mx__node-state"
                    fill={stateColor}
                  >
                    {stateLabel}
                  </text>
                </motion.g>
              );
            })}
          </svg>
        </div>

        <div className="mx__side">
          <div className="mx__term" aria-label="streamed agent output">
            <div className="mx__term-bar">
              <span className="mx__term-dot" aria-hidden />
              <span className="mx__term-dot" aria-hidden />
              <span className="mx__term-dot" aria-hidden />
              <span className="mx__term-name">pty stream</span>
              <span className="mx__term-stream">
                {streaming ? 'signalr live' : 'idle'}
              </span>
            </div>
            <div className="mx__term-body" ref={bodyRef} aria-live="polite">
              {lines.length === 0 ? (
                <span className="mx__term-empty">
                  Run the task to stream agent output.
                </span>
              ) : (
                <AnimatePresence initial={false}>
                  {lines.map((l) => (
                    <motion.div
                      key={l.id}
                      className={`mx__term-line ${l.kind ? `mx__term-line--${l.kind}` : ''}`}
                      initial={{ opacity: reduce ? 1 : 0, x: reduce ? 0 : -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: reduce ? 0 : 0.22, ease }}
                    >
                      <b>{l.who}</b>
                      <span>{l.text}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
              {streaming && <span className="mx__caret" aria-hidden />}
            </div>
          </div>

          <div className={`mx__watchdog ${wdClass}`} aria-label="watchdog status">
            <div className="mx__watchdog-head">
              <span className="mx__watchdog-pulse" aria-hidden />
              <span>watchdog</span>
              <span className="mx__watchdog-status">
                {phase === 'alarm'
                  ? 'crash-loop'
                  : phase === 'rolled'
                    ? 'recovered'
                    : phase === 'running'
                      ? 'polling'
                      : 'standby'}
              </span>
            </div>
            <div className="mx__watchdog-text">
              {phase === 'alarm' ? (
                <>
                  Health poll on <b>agent-ui</b> failed 3 times. Triggering
                  git-based rollback.
                </>
              ) : phase === 'rolled' ? (
                <>
                  <b>agent-ui</b> rolled back to its last good checkpoint and the
                  run completed.
                </>
              ) : (
                <>Polls each agent for health and rolls back on crash-loops.</>
              )}
            </div>
            {(phase === 'rolled' || phase === 'alarm') && (
              <span className="mx__tag">git tag: v0.4.1</span>
            )}
          </div>
        </div>
      </div>

      <div className="mx__stats">
        {STATS.map((s) => (
          <div className="mx__stat" key={s.unit}>
            <div className="mx__stat-val">{s.val}</div>
            <div className="mx__stat-unit">{s.unit}</div>
          </div>
        ))}
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={streaming}>
          {streaming ? 'Running…' : 'Run task'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={streaming}
        >
          Reset
        </button>
        <span className="demo__hint">
          {NODES.length} nodes, 1 watchdog, git-tagged rollback
        </span>
      </div>
    </div>
  );
}
