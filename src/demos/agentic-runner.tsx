import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import './agentic-runner.css';

// The runner walks a plan -> select -> invoke -> validate loop. When a tool
// output fails its Pydantic schema, the validator emits a typed FailureReason
// that feeds back into the planner, which re-plans and swaps a tool instead of
// retrying the same call. Four hard budgets (steps, replans, cost, wall-clock)
// turn exhaustion into an honest abort. Numbers below are from the committed
// 20-goal baseline.
const BUDGETS = {
  steps: 12,
  replans: 3,
  cost: 0.006, // dollars
  wall: 8000, // ms
};

// Baseline figures shown in the verdict.
const BASE = {
  success: 0.95,
  abort: 0.05,
  replan: 0.1,
  avgSteps: 4.1,
  avgCost: 0.00268,
};

type Phase = 'plan' | 'select' | 'invoke' | 'validate' | 'replan' | 'done';

type StepLog = {
  n: number;
  phase: Phase;
  tool: string;
  note: string;
  failure?: string;
};

// A scripted run that exercises one validation failure and one replan, the way
// the real loop swaps a tool on OUTPUT_SCHEMA_MISMATCH.
const TOOLS_FIRST = ['parse_goal', 'web_fetch', 'extract_fields'];
const TOOLS_SWAP = ['parse_goal', 'query_db', 'extract_fields', 'calculate'];

type Frame = {
  phase: Phase;
  tool: string;
  note: string;
  failure?: string;
  cost: number;
  ms: number;
  replan?: boolean;
};

const SCRIPT: Frame[] = [
  { phase: 'plan', tool: 'planner', note: 'decompose goal into 3 subtasks', cost: 0.0003, ms: 420 },
  { phase: 'select', tool: 'parse_goal', note: 'pick tool for subtask 1', cost: 0.0002, ms: 300 },
  { phase: 'invoke', tool: 'parse_goal', note: 'returns typed GoalSpec', cost: 0.0004, ms: 560 },
  { phase: 'validate', tool: 'parse_goal', note: 'schema ok', cost: 0.0001, ms: 180 },
  { phase: 'select', tool: 'web_fetch', note: 'pick tool for subtask 2', cost: 0.0002, ms: 300 },
  { phase: 'invoke', tool: 'web_fetch', note: 'returns untyped blob', cost: 0.0006, ms: 720 },
  {
    phase: 'validate',
    tool: 'web_fetch',
    note: 'output does not match schema',
    failure: 'OUTPUT_SCHEMA_MISMATCH',
    cost: 0.0001,
    ms: 180,
  },
  {
    phase: 'replan',
    tool: 'planner',
    note: 'swap web_fetch for query_db (SELECT-only) and re-plan',
    cost: 0.0004,
    ms: 500,
    replan: true,
  },
  { phase: 'select', tool: 'query_db', note: 'pick query_db for subtask 2', cost: 0.0002, ms: 300 },
  { phase: 'invoke', tool: 'query_db', note: 'returns typed rows', cost: 0.0004, ms: 540 },
  { phase: 'validate', tool: 'query_db', note: 'schema ok', cost: 0.0001, ms: 180 },
  { phase: 'select', tool: 'extract_fields', note: 'pick tool for subtask 3', cost: 0.0002, ms: 300 },
  { phase: 'invoke', tool: 'extract_fields', note: 'returns typed Result', cost: 0.0003, ms: 480 },
  { phase: 'validate', tool: 'extract_fields', note: 'schema ok, goal satisfied', cost: 0.0001, ms: 200 },
  { phase: 'done', tool: 'runner', note: 'goal satisfied within all budgets', cost: 0, ms: 0 },
];

const PHASES: Phase[] = ['plan', 'select', 'invoke', 'validate', 'replan'];
const PHASE_LABEL: Record<Phase, string> = {
  plan: 'plan',
  select: 'select',
  invoke: 'invoke',
  validate: 'validate',
  replan: 're-plan',
  done: 'done',
};

const ease = [0.22, 1, 0.36, 1] as const;

function clampPct(n: number, max: number) {
  return Math.min(100, Math.round((n / max) * 100));
}

export default function AgenticRunnerDemo() {
  const reduce = useReducedMotion();
  const [idx, setIdx] = useState(-1);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<StepLog[]>([]);
  const [usedSteps, setUsedSteps] = useState(0);
  const [usedReplans, setUsedReplans] = useState(0);
  const [usedCost, setUsedCost] = useState(0);
  const [usedWall, setUsedWall] = useState(0);
  const [tools, setTools] = useState<string[]>(TOOLS_FIRST);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function stop() {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }
  useEffect(() => stop, []);

  function reset() {
    stop();
    setIdx(-1);
    setRunning(false);
    setLog([]);
    setUsedSteps(0);
    setUsedReplans(0);
    setUsedCost(0);
    setUsedWall(0);
    setTools(TOOLS_FIRST);
  }

  function applyFrame(i: number) {
    const f = SCRIPT[i];
    setIdx(i);
    if (f.phase === 'done') {
      setRunning(false);
      return;
    }
    setUsedCost((c) => +(c + f.cost).toFixed(5));
    setUsedWall((w) => w + f.ms);
    if (f.phase !== 'replan') setUsedSteps((s) => s + 1);
    if (f.replan) {
      setUsedReplans((r) => r + 1);
      setTools(TOOLS_SWAP);
    }
    setLog((prev) => [
      {
        n: prev.length + 1,
        phase: f.phase,
        tool: f.tool,
        note: f.note,
        failure: f.failure,
      },
      ...prev,
    ]);
  }

  function step() {
    if (running) return;
    const next = idx + 1;
    if (next >= SCRIPT.length) return;
    applyFrame(next);
  }

  function play() {
    if (running) return;
    reset();
    setRunning(true);
    let i = 0;
    const advance = () => {
      applyFrame(i);
      const f = SCRIPT[i];
      i += 1;
      if (f.phase === 'done' || i >= SCRIPT.length) {
        setRunning(false);
        return;
      }
      timer.current = setTimeout(advance, reduce ? 0 : 760);
    };
    if (reduce) {
      // Collapse to the final state instantly but still functional.
      for (let k = 0; k < SCRIPT.length; k++) applyFrame(k);
      setRunning(false);
      return;
    }
    advance();
  }

  const current = idx >= 0 ? SCRIPT[idx] : null;
  const activePhase = current?.phase ?? null;
  const isDone = current?.phase === 'done';
  const lastFailure = log.find((l) => l.failure)?.failure;

  const meters = [
    { key: 'steps', label: 'steps', used: usedSteps, max: BUDGETS.steps, fmt: (v: number) => String(v) },
    { key: 'replans', label: 'replans', used: usedReplans, max: BUDGETS.replans, fmt: (v: number) => String(v) },
    { key: 'cost', label: 'cost', used: usedCost, max: BUDGETS.cost, fmt: (v: number) => `$${v.toFixed(4)}` },
    { key: 'wall', label: 'wall-clock', used: usedWall, max: BUDGETS.wall, fmt: (v: number) => `${(v / 1000).toFixed(1)}s` },
  ];

  return (
    <div className="demo agr" aria-label="agentic runner replan loop demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Re-plan on validation failure</h3>
      <p className="demo__lede">
        Step or play the plan, select, invoke, validate loop on one goal. When a
        tool output fails its schema the validator emits a typed FailureReason,
        and the planner re-plans and swaps the tool rather than retrying. Four
        hard budgets tick toward their caps.
      </p>

      <div className="agr__stage">
        <ol className="agr__loop" aria-label="loop phases">
          {PHASES.map((p) => {
            const on = activePhase === p;
            const isReplan = p === 'replan';
            return (
              <li
                key={p}
                className={`agr__phase${on ? ' agr__phase--on' : ''}${
                  isReplan ? ' agr__phase--replan' : ''
                }`}
                aria-current={on ? 'step' : undefined}
              >
                <span className="agr__phase-name">{PHASE_LABEL[p]}</span>
                {isReplan && on && <span className="agr__phase-flag">swap</span>}
              </li>
            );
          })}
        </ol>

        <div className="agr__cols">
          <div className="agr__panel">
            <div className="agr__panel-head">tools available</div>
            <ul className="agr__tools">
              <AnimatePresence initial={false}>
                {tools.map((t) => {
                  const isActive = current?.tool === t && !isDone;
                  const failed =
                    activePhase === 'validate' &&
                    current?.failure &&
                    current?.tool === t;
                  return (
                    <motion.li
                      key={t}
                      layout={!reduce}
                      className={`agr__tool${isActive ? ' agr__tool--on' : ''}${
                        failed ? ' agr__tool--fail' : ''
                      }`}
                      initial={{ opacity: 0, x: reduce ? 0 : -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: reduce ? 0 : 0.25, ease }}
                    >
                      <span className="agr__tool-dot" />
                      <span className="agr__tool-name">{t}</span>
                      {failed && <span className="agr__tool-tag">rejected</span>}
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </div>

          <div className="agr__panel">
            <div className="agr__panel-head">trace</div>
            <ul className="agr__trace">
              {log.length === 0 && (
                <li className="agr__trace-empty">
                  press step or play to start the loop
                </li>
              )}
              <AnimatePresence initial={false}>
                {log.slice(0, 7).map((l) => (
                  <motion.li
                    key={l.n}
                    className={`agr__trace-line agr__trace-line--${l.phase}${
                      l.failure ? ' agr__trace-line--fail' : ''
                    }`}
                    initial={{ opacity: 0, y: reduce ? 0 : -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduce ? 0 : 0.22, ease }}
                  >
                    <span className="agr__trace-phase">{PHASE_LABEL[l.phase]}</span>
                    <span className="agr__trace-note">
                      {l.note}
                      {l.failure && (
                        <span className="agr__trace-reason"> {l.failure}</span>
                      )}
                    </span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        </div>

        <div className="agr__meters">
          {meters.map((m) => {
            const pct = clampPct(m.used, m.max);
            const hot = pct >= 75;
            return (
              <div key={m.key} className="agr__meter">
                <div className="agr__meter-top">
                  <span className="agr__meter-label">{m.label}</span>
                  <span className="agr__meter-val">
                    {m.fmt(m.used)}
                    <span className="agr__meter-cap"> / {m.fmt(m.max)}</span>
                  </span>
                </div>
                <div className="agr__meter-track">
                  <motion.div
                    className={`agr__meter-fill${hot ? ' agr__meter-fill--hot' : ''}`}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: reduce ? 0 : 0.4, ease }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <AnimatePresence>
          {isDone && (
            <motion.div
              className="agr__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="agr__verdict-head">goal satisfied</span>
              <span className="agr__verdict-text">
                One {lastFailure ?? 'OUTPUT_SCHEMA_MISMATCH'} triggered a single
                re-plan and tool swap. Baseline over 20 goals: {BASE.success}{' '}
                success, {BASE.abort} honest abort, {BASE.replan} replan rate,{' '}
                {BASE.avgSteps} avg steps, ${BASE.avgCost.toFixed(6)} avg cost
                per goal.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={play} disabled={running}>
          {running ? 'Running…' : 'Play run'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={step}
          disabled={running || idx >= SCRIPT.length - 1}
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
          typed FailureReason feeds the planner, not a retry
        </span>
      </div>
    </div>
  );
}
