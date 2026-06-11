import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './edalauncher.css';

// The launcher configures a Job (a typed Pydantic model) against a target,
// streams its log over SSE step by step, then diffs two runs on the same target.

type Tool = 'Cadence' | 'Synopsys';
const TOOLS: Tool[] = ['Cadence', 'Synopsys'];
const TARGETS = ['alu_top', 'fifo_ctrl', 'dma_engine'];

type StepName = 'elaborate' | 'compile' | 'simulate' | 'report';
const STEPS: StepName[] = ['elaborate', 'compile', 'simulate', 'report'];

type LogLine = { ts: string; msg: string; step: StepName };

// A scripted SSE log: one or more lines per step, as the runner emits them.
const LOG_SCRIPT: LogLine[] = [
  { ts: '00:00', msg: 'job accepted, target alu_top', step: 'elaborate' },
  { ts: '00:01', msg: 'elaborate: resolving 142 cells', step: 'elaborate' },
  { ts: '00:03', msg: 'compile: 0 errors, 2 warnings', step: 'compile' },
  { ts: '00:05', msg: 'simulate: 1280 vectors applied', step: 'simulate' },
  { ts: '00:08', msg: 'simulate: coverage closing', step: 'simulate' },
  { ts: '00:10', msg: 'report: metrics written', step: 'report' },
  { ts: '00:10', msg: 'job complete', step: 'report' },
];

type Metric = { name: string; baseline: number; current: number; unit: string; lowerBetter: boolean };

// Regression diff: run B against baseline run A on the same target.
const METRICS: Metric[] = [
  { name: 'sim runtime', baseline: 9.4, current: 11.8, unit: 's', lowerBetter: true },
  { name: 'coverage', baseline: 96.2, current: 96.2, unit: '%', lowerBetter: false },
  { name: 'cell count', baseline: 142, current: 142, unit: '', lowerBetter: true },
  { name: 'peak memory', baseline: 512, current: 540, unit: 'MB', lowerBetter: true },
  { name: 'warnings', baseline: 1, current: 2, unit: '', lowerBetter: true },
];

const ease = [0.22, 1, 0.36, 1] as const;

function deltaInfo(m: Metric) {
  const diff = +(m.current - m.baseline).toFixed(2);
  const drift = Math.abs(diff) > 1e-9;
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const sign = diff > 0 ? '+' : '';
  return { diff, drift, dir, label: drift ? `${sign}${diff}${m.unit}` : 'no change' };
}

export default function EdalauncherDemo() {
  const reduce = useReducedMotion();
  const [view, setView] = useState<'run' | 'diff'>('run');
  const [tool, setTool] = useState<Tool>('Cadence');
  const [target, setTarget] = useState(TARGETS[0]);
  const [emitted, setEmitted] = useState(0);
  const [running, setRunning] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const lines = LOG_SCRIPT.slice(0, emitted);
  const lastStep = lines.length ? lines[lines.length - 1].step : null;
  const lastStepIdx = lastStep ? STEPS.indexOf(lastStep) : -1;
  const complete = emitted >= LOG_SCRIPT.length;
  const progress = Math.round((emitted / LOG_SCRIPT.length) * 100);

  function stepState(s: StepName): 'idle' | 'running' | 'done' {
    const idx = STEPS.indexOf(s);
    if (idx < lastStepIdx) return 'done';
    if (idx === lastStepIdx) return complete ? 'done' : 'running';
    return 'idle';
  }

  function launch() {
    if (running) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    setEmitted(0);
    setRunning(true);
    if (reduce) {
      setEmitted(LOG_SCRIPT.length);
      setRunning(false);
      return;
    }
    let i = 0;
    const step = () => {
      i += 1;
      setEmitted(i);
      if (i >= LOG_SCRIPT.length) {
        setRunning(false);
        timer.current = null;
        return;
      }
      timer.current = window.setTimeout(step, 520);
    };
    timer.current = window.setTimeout(step, 400);
  }

  const driftCount = METRICS.filter((m) => deltaInfo(m).drift).length;

  return (
    <div className="demo" aria-label="edalauncher run and diff demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Launch a run, then diff the metrics</h3>
      <p className="demo__lede">
        Configure a tool flow against a target and launch it. The run log streams
        in live over SSE, step by step. Switch to the regression view to diff two
        runs on the same target, where the metrics that drifted are highlighted.
      </p>

      <div className="eda__tabs" role="tablist" aria-label="view">
        <button
          role="tab"
          aria-selected={view === 'run'}
          className={`eda__tab ${view === 'run' ? 'eda__tab--on' : ''}`}
          onClick={() => setView('run')}
        >
          Launch and stream
        </button>
        <button
          role="tab"
          aria-selected={view === 'diff'}
          className={`eda__tab ${view === 'diff' ? 'eda__tab--on' : ''}`}
          onClick={() => setView('diff')}
        >
          Regression diff
        </button>
      </div>

      {view === 'run' ? (
        <div>
          <div className="eda__config">
            <div className="eda__field">
              <span className="eda__field-label">Tool</span>
              <div className="eda__seg" role="group" aria-label="tool">
                {TOOLS.map((t) => (
                  <button
                    key={t}
                    className={`eda__chip ${tool === t ? 'eda__chip--on' : ''}`}
                    aria-pressed={tool === t}
                    onClick={() => !running && setTool(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="eda__field">
              <span className="eda__field-label">Target</span>
              <div className="eda__seg" role="group" aria-label="target">
                {TARGETS.map((t) => (
                  <button
                    key={t}
                    className={`eda__chip ${target === t ? 'eda__chip--on' : ''}`}
                    aria-pressed={target === t}
                    onClick={() => !running && setTarget(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="eda__field">
              <span className="eda__field-label">Job</span>
              <div className="eda__seg">
                <span className="eda__chip eda__chip--on">
                  {tool.toLowerCase()}:{target}
                </span>
              </div>
            </div>
          </div>

          <div
            className="eda__progress"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <motion.div
              className="eda__progress-bar"
              animate={{ width: `${progress}%` }}
              transition={{ duration: reduce ? 0 : 0.4, ease }}
            />
          </div>

          <div className="eda__steps">
            {STEPS.map((s) => (
              <span key={s} className="eda__step" data-state={stepState(s)}>
                <span className="eda__step-dot" />
                {s}
              </span>
            ))}
          </div>

          <div className="eda__console">
            <div className="eda__console-head">
              run log
              {running && (
                <span className="eda__console-live">
                  <motion.span
                    className="eda__console-pulse"
                    animate={reduce ? {} : { opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  />
                  sse open
                </span>
              )}
            </div>
            <ul className="eda__log">
              {lines.length === 0 && (
                <li className="eda__log-empty">Launch a run to stream its log.</li>
              )}
              <AnimatePresence initial={false}>
                {lines.map((l, i) => (
                  <motion.li
                    key={i}
                    className="eda__log-line"
                    initial={{ opacity: 0, x: reduce ? 0 : -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: reduce ? 0 : 0.24, ease }}
                  >
                    <span className="eda__log-ts">{l.ts}</span>
                    <span className="eda__log-msg">
                      {l.msg.split(/(\d[\d.]*)/g).map((part, j) =>
                        /^\d[\d.]*$/.test(part) ? <b key={j}>{part}</b> : part,
                      )}
                    </span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>

          <div className="demo__controls">
            <button className="demo__btn" onClick={launch} disabled={running}>
              {running ? 'Running...' : complete ? 'Run again' : 'Launch run'}
            </button>
            <span className="demo__hint">
              {complete ? 'job complete' : running ? 'streaming over sse' : 'idle'}
            </span>
          </div>
        </div>
      ) : (
        <div>
          <div className="eda__diff-head">
            <span>metric</span>
            <span>run a (baseline)</span>
            <span>run b</span>
            <span>drift</span>
          </div>
          {METRICS.map((m, i) => {
            const d = deltaInfo(m);
            return (
              <motion.div
                key={m.name}
                className="eda__diff-row"
                data-drift={d.drift}
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : i * 0.05, ease }}
              >
                <span className="eda__diff-metric">{m.name}</span>
                <span className="eda__diff-base">
                  {m.baseline}
                  {m.unit}
                </span>
                <span className="eda__diff-cur">
                  {m.current}
                  {m.unit}
                </span>
                <span className="eda__diff-delta" data-dir={d.drift ? d.dir : 'flat'}>
                  {d.label}
                </span>
              </motion.div>
            );
          })}
          <div className="eda__verdict">
            <span className="eda__verdict-head">{driftCount} metrics drifted</span>
            <span className="eda__verdict-text">
              Diffing run B against the baseline on {target} surfaces only the
              metrics that moved, so a regression is caught before it ships. The
              API, store, streaming, and diff are covered by 12 tests.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
