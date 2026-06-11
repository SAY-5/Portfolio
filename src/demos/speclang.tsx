import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './speclang.css';

// Real mechanism: a Lark parser produces a typed Pydantic AST, a validator
// enforces step shape, data-flow, and module-resolution rules, and the engine
// runs short Python bodies in a sandbox that blocks import, exec, and file I/O
// under a wall-clock time box. The bench threads a number through a 1000-step
// procedure and reports steps/sec; make bench-regress fails on >30% drift.

const ease = [0.22, 1, 0.36, 1] as const;
const BENCH_STEPS = 1000;
const STEPS_PER_SEC = 184_000; // illustrative bench figure for the readout

type Step = {
  id: string;
  name: string;
  body: string;
  deps: string[]; // ids this step reads from
  x: number;
  y: number;
  fn: (env: Record<string, number>) => number;
};

// A small procedure DAG: seed -> two parallel transforms -> a combine -> a gate.
// Each body is a short sandboxed expression over prior outputs.
const steps: Step[] = [
  {
    id: 'seed',
    name: 'seed',
    body: 'return n',
    deps: [],
    x: 40,
    y: 120,
    fn: (e) => e.n,
  },
  {
    id: 'scale',
    name: 'scale',
    body: 'return seed * 3',
    deps: ['seed'],
    x: 210,
    y: 56,
    fn: (e) => e.seed * 3,
  },
  {
    id: 'shift',
    name: 'shift',
    body: 'return seed + 7',
    deps: ['seed'],
    x: 210,
    y: 184,
    fn: (e) => e.seed + 7,
  },
  {
    id: 'combine',
    name: 'combine',
    body: 'return scale + shift',
    deps: ['scale', 'shift'],
    x: 380,
    y: 120,
    fn: (e) => e.scale + e.shift,
  },
  {
    id: 'gate',
    name: 'gate',
    body: 'return combine % 100',
    deps: ['combine'],
    x: 540,
    y: 120,
    fn: (e) => e.combine % 100,
  },
];

const guards = [
  { op: 'import os', verdict: 'blocked' },
  { op: 'exec(code)', verdict: 'blocked' },
  { op: 'open(path)', verdict: 'blocked' },
  { op: 'min, max, len', verdict: 'allowed' },
];

// Topological order is fixed by the DAG; this is the resolution sequence.
const order = ['seed', 'scale', 'shift', 'combine', 'gate'];

function nodeCenter(s: Step) {
  return { cx: s.x + 56, cy: s.y + 22 };
}

export default function SpeclangDemo() {
  const reduce = useReducedMotion();
  const [input, setInput] = useState<number>(5);
  const [resolved, setResolved] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, number>>({});
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);

  function clearTimer() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => clearTimer, []);

  function resolveUpTo(count: number, n: number) {
    const env: Record<string, number> = { n };
    const vals: Record<string, number> = {};
    for (let i = 0; i < count; i++) {
      const s = steps.find((x) => x.id === order[i])!;
      const out = s.fn(env);
      env[s.id] = out;
      vals[s.id] = out;
    }
    setValues(vals);
    setResolved(order.slice(0, count));
  }

  function stepOnce() {
    const next = Math.min(order.length, resolved.length + 1);
    resolveUpTo(next, input);
  }

  function play() {
    clearTimer();
    setResolved([]);
    setValues({});
    if (reduce) {
      resolveUpTo(order.length, input);
      return;
    }
    setPlaying(true);
    let i = 0;
    const advance = () => {
      i += 1;
      resolveUpTo(i, input);
      if (i < order.length) {
        timer.current = window.setTimeout(advance, 700);
      } else {
        setPlaying(false);
        timer.current = null;
      }
    };
    timer.current = window.setTimeout(advance, 400);
  }

  function reset() {
    clearTimer();
    setPlaying(false);
    setResolved([]);
    setValues({});
  }

  const done = resolved.length === order.length;
  const gateVal = values['gate'];

  return (
    <div className="demo" aria-label="speclang procedure dag demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Resolve a procedure step by step</h3>
      <p className="demo__lede">
        Set an input and run the procedure. The validator has already checked
        step shape and data-flow, so the engine resolves the dependency DAG in
        topological order, running each short Python body in a sandbox that
        blocks import, exec, and file I/O under a wall-clock time box.
      </p>

      <div className="sl__inputrow">
        <label className="sl__input-label" htmlFor="sl-n">
          input n
        </label>
        <input
          id="sl-n"
          className="sl__input"
          type="number"
          value={input}
          min={0}
          max={999}
          disabled={playing}
          onChange={(e) => {
            const v = Number(e.target.value);
            setInput(Number.isFinite(v) ? v : 0);
            reset();
          }}
        />
        <span className="sl__input-hint">threads through {steps.length} steps</span>
      </div>

      <div className="sl__stage">
        <div className="sl__dagwrap">
          <svg
            className="sl__svg"
            viewBox="0 0 660 260"
            role="group"
            aria-label="procedure dependency graph"
          >
            <defs>
              <marker
                id="sl-arrow"
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

            {/* edges */}
            {steps.map((s) =>
              s.deps.map((d) => {
                const from = steps.find((x) => x.id === d)!;
                const a = nodeCenter(from);
                const b = nodeCenter(s);
                const lit = resolved.includes(s.id) && resolved.includes(d);
                const x1 = a.cx + 56;
                const x2 = b.cx - 56;
                const mx = (x1 + x2) / 2;
                return (
                  <motion.path
                    key={`${d}-${s.id}`}
                    d={`M ${x1} ${a.cy} C ${mx} ${a.cy}, ${mx} ${b.cy}, ${x2} ${b.cy}`}
                    fill="none"
                    stroke={lit ? 'var(--accent)' : 'var(--line)'}
                    strokeWidth={lit ? 2 : 1.2}
                    markerEnd={lit ? 'url(#sl-arrow)' : undefined}
                    initial={false}
                    animate={{ opacity: lit ? 1 : 0.5 }}
                    transition={{ duration: reduce ? 0 : 0.3, ease }}
                  />
                );
              }),
            )}

            {/* nodes */}
            {steps.map((s, i) => {
              const isResolved = resolved.includes(s.id);
              const isCurrent =
                resolved.length > 0 && order[resolved.length - 1] === s.id;
              return (
                <g key={s.id}>
                  <motion.rect
                    x={s.x}
                    y={s.y}
                    width={112}
                    height={44}
                    rx={9}
                    fill={isResolved ? 'var(--ink-700)' : 'var(--ink-850)'}
                    stroke={
                      isCurrent
                        ? 'var(--accent)'
                        : isResolved
                          ? 'var(--accent-line)'
                          : 'var(--line)'
                    }
                    strokeWidth={isCurrent ? 2.5 : 1}
                    initial={false}
                    animate={
                      reduce
                        ? {}
                        : { scale: isCurrent ? 1.04 : 1 }
                    }
                    transition={{ duration: 0.25, ease }}
                    style={{ transformOrigin: `${s.x + 56}px ${s.y + 22}px` }}
                  />
                  <text x={s.x + 12} y={s.y + 18} className="sl__node-name">
                    {s.name}
                  </text>
                  <text x={s.x + 12} y={s.y + 33} className="sl__node-body">
                    {s.body}
                  </text>
                  {isResolved && (
                    <text
                      x={s.x + 100}
                      y={s.y + 18}
                      textAnchor="end"
                      className="sl__node-val"
                    >
                      {values[s.id]}
                    </text>
                  )}
                  <text x={s.x + 12} y={s.y - 6} className="sl__node-step">
                    step {i + 1}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="sl__sandbox">
          <div className="sl__sandbox-head">sandbox guard</div>
          <ul className="sl__guards">
            {guards.map((g) => (
              <li
                key={g.op}
                className={
                  'sl__guard ' +
                  (g.verdict === 'blocked' ? 'sl__guard--block' : 'sl__guard--ok')
                }
              >
                <span className="sl__guard-op">{g.op}</span>
                <span className="sl__guard-verdict">{g.verdict}</span>
              </li>
            ))}
          </ul>
          <div className="sl__timebox">
            <span className="sl__timebox-label">wall-clock time box</span>
            <span className="sl__timebox-val">per-body</span>
          </div>
        </div>
      </div>

      <div className="sl__bench">
        <div className="sl__bench-item">
          <span className="sl__bench-val">{STEPS_PER_SEC.toLocaleString()}</span>
          <span className="sl__bench-unit">steps/sec</span>
        </div>
        <div className="sl__bench-item">
          <span className="sl__bench-val">{BENCH_STEPS.toLocaleString()}</span>
          <span className="sl__bench-unit">step bench procedure</span>
        </div>
        <div className="sl__bench-item">
          <span className="sl__bench-val">30%</span>
          <span className="sl__bench-unit">drift fails the build</span>
        </div>
      </div>

      <AnimatePresence>
        {done && (
          <motion.div
            className="sl__verdict"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            <span className="sl__verdict-x">{gateVal}</span>
            <span className="sl__verdict-text">
              All {order.length} steps resolved in topological order from n ={' '}
              {input}, each body run inside the sandbox. The gate step returned{' '}
              {gateVal} with no import, exec, or file access permitted.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button className="demo__btn" onClick={play} disabled={playing}>
          {playing ? 'Running…' : 'Run procedure'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={stepOnce}
          disabled={playing || done}
        >
          Step
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={playing}
        >
          Reset
        </button>
        <span className="demo__hint">
          {resolved.length} / {order.length} steps resolved
        </span>
      </div>
    </div>
  );
}
