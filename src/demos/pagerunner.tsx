import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './pagerunner.css';

// Real project facts: PageRunner drives Playwright browsers through tool-using
// agent loops with hard step, token, wall-clock, and cost budgets, and supports
// deterministic replay against captured DOM snapshots. The golden-flow suite of
// 10 flows runs at 1.00 success rate, 5.7 average steps to success, and 1.00
// replay determinism against a fake provider. Deterministic replay re-runs an
// old failure against cached DOM and reports a determinism score in [0,1].

type Step = { tool: string; arg: string; tokens: number; cost: number };

// One golden flow: a six-step browser run that ends in success.
const flow: Step[] = [
  { tool: 'navigate', arg: '/login', tokens: 180, cost: 0.0009 },
  { tool: 'fill', arg: 'email field', tokens: 140, cost: 0.0007 },
  { tool: 'fill', arg: 'password field', tokens: 130, cost: 0.0006 },
  { tool: 'click', arg: 'submit', tokens: 120, cost: 0.0006 },
  { tool: 'wait_for', arg: 'dashboard', tokens: 110, cost: 0.0005 },
  { tool: 'extract', arg: 'account name', tokens: 160, cost: 0.0008 },
];

// Hard budgets the dispatcher enforces. The flow stays comfortably inside them.
const BUDGET = {
  steps: 8,
  tokens: 1200,
  cost: 0.005,
};

const ease = [0.22, 1, 0.36, 1] as const;
const STEP_MS = 620;

type RunState = {
  index: number; // how many steps have executed
  tokens: number;
  cost: number;
  running: boolean;
  done: boolean;
};

const initial: RunState = { index: 0, tokens: 0, cost: 0, running: false, done: false };

export default function PagerunnerDemo() {
  const reduce = useReducedMotion();
  const [run, setRun] = useState<RunState>(initial);
  // Replay records the tool sequence the live run produced, then re-derives it
  // from cached DOM. A match at every position gives determinism 1.00.
  const [replayIndex, setReplayIndex] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const timer = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  function start() {
    if (run.running) return;
    clearTimer();
    setReplayIndex(0);
    setReplaying(false);

    if (reduce) {
      const tokens = flow.reduce((a, s) => a + s.tokens, 0);
      const cost = flow.reduce((a, s) => a + s.cost, 0);
      setRun({ index: flow.length, tokens, cost, running: false, done: true });
      setReplayIndex(flow.length);
      return;
    }

    setRun({ ...initial, running: true });
    timer.current = window.setInterval(() => {
      setRun((prev) => {
        const next = prev.index + 1;
        const step = flow[prev.index];
        const tokens = prev.tokens + (step?.tokens ?? 0);
        const cost = prev.cost + (step?.cost ?? 0);
        if (next >= flow.length) {
          clearTimer();
          return { index: flow.length, tokens, cost, running: false, done: true };
        }
        return { index: next, tokens, cost, running: true, done: false };
      });
    }, STEP_MS);
  }

  function startReplay() {
    if (!run.done || replaying) return;
    if (reduce) {
      setReplayIndex(flow.length);
      return;
    }
    setReplaying(true);
    setReplayIndex(0);
    let i = 0;
    timer.current = window.setInterval(() => {
      i += 1;
      setReplayIndex(i);
      if (i >= flow.length) {
        clearTimer();
        setReplaying(false);
      }
    }, STEP_MS);
  }

  function reset() {
    clearTimer();
    setRun(initial);
    setReplayIndex(0);
    setReplaying(false);
  }

  const stepsUsed = run.index;
  const matched = Math.min(replayIndex, run.done ? flow.length : 0);
  const determinism = run.done ? matched / flow.length : 0;

  return (
    <div className="demo" aria-label="pagerunner agent loop demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Bounded agent loop, then deterministic replay</h3>
      <p className="demo__lede">
        Run a six-step browser flow inside hard step, token, and cost budgets,
        then replay it against cached DOM and watch the step sequence match frame
        for frame.
      </p>

      <div className="pr__budgets">
        <Budget
          name="steps"
          used={stepsUsed}
          max={BUDGET.steps}
          render={(v) => `${v}`}
          reduce={reduce}
        />
        <Budget
          name="tokens"
          used={run.tokens}
          max={BUDGET.tokens}
          render={(v) => `${Math.round(v)}`}
          reduce={reduce}
        />
        <Budget
          name="cost"
          used={run.cost}
          max={BUDGET.cost}
          render={(v) => `$${v.toFixed(4)}`}
          reduce={reduce}
        />
      </div>

      <div className="pr__split">
        <Track
          title="Live run"
          sub="tool-using loop"
          steps={flow}
          active={run.index}
          highlight="accent"
          reduce={reduce}
        />
        <Track
          title="Deterministic replay"
          sub="cached DOM"
          steps={flow}
          active={run.done ? replayIndex : 0}
          compareTo={flow}
          highlight="green"
          reduce={reduce}
        />
      </div>

      <AnimatePresence>
        {run.done && (
          <motion.div
            className="pr__verdict"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            <div className="pr__verdict-row">
              <span className="pr__verdict-x">{determinism.toFixed(2)}</span>
              <span className="pr__verdict-label">replay determinism</span>
            </div>
            <p className="pr__verdict-text">
              Flow finished in {flow.length} steps, inside every budget. The
              golden-flow suite of 10 flows runs at 1.00 success rate, 5.7
              average steps to success, and 1.00 replay determinism against a
              fake provider.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button className="demo__btn" onClick={start} disabled={run.running}>
          {run.running ? 'Running…' : 'Run flow'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={startReplay}
          disabled={!run.done || replaying}
        >
          {replaying ? 'Replaying…' : 'Replay'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
      </div>
    </div>
  );
}

function Budget(props: {
  name: string;
  used: number;
  max: number;
  render: (v: number) => string;
  reduce: boolean | null;
}) {
  const { name, used, max, render, reduce } = props;
  const pct = Math.min(100, (used / max) * 100);
  return (
    <div className="pr__budget">
      <div className="pr__budget-head">
        <span className="pr__budget-name">{name}</span>
        <span className="pr__budget-val">
          {render(used)} <span className="pr__budget-max">/ {render(max)}</span>
        </span>
      </div>
      <div className="pr__budget-track" role="img" aria-label={`${name} budget ${Math.round(pct)} percent used`}>
        <motion.span
          className="pr__budget-fill"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: reduce ? 0 : 0.4, ease }}
        />
      </div>
    </div>
  );
}

function Track(props: {
  title: string;
  sub: string;
  steps: Step[];
  active: number;
  compareTo?: Step[];
  highlight: 'accent' | 'green';
  reduce: boolean | null;
}) {
  const { title, sub, steps, active, compareTo, highlight, reduce } = props;
  return (
    <div className={'pr__track pr__track--' + highlight}>
      <div className="pr__track-head">
        <span className="pr__track-title">{title}</span>
        <span className="pr__track-sub">{sub}</span>
      </div>
      <ol className="pr__steps">
        {steps.map((s, i) => {
          const reached = i < active;
          const current = i === active - 1;
          const matches = compareTo ? compareTo[i]?.tool === s.tool : true;
          return (
            <motion.li
              key={`${s.tool}-${i}`}
              className={
                'pr__step' +
                (reached ? ' pr__step--on' : '') +
                (current ? ' pr__step--cur' : '') +
                (reached && compareTo && matches ? ' pr__step--match' : '')
              }
              initial={false}
              animate={{ opacity: reached ? 1 : 0.4 }}
              transition={{ duration: reduce ? 0 : 0.25 }}
            >
              <span className="pr__step-n">{i + 1}</span>
              <span className="pr__step-tool">{s.tool}</span>
              <span className="pr__step-arg">{s.arg}</span>
              {reached && compareTo && (
                <span className="pr__step-chk" aria-hidden="true">
                  {matches ? 'match' : 'diff'}
                </span>
              )}
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
