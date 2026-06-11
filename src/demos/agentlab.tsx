import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './agentlab.css';

// Real mechanism: a suite of coding tasks runs against a mix of models. The
// async runner fills the matrix with global and per-provider concurrency, so
// cells land out of order as each (task, agent) pair finishes. Each cell is a
// rubric or test-runner score in [0,1]. Results land in a SQLite store with
// gzipped trajectories that two runs can be diffed against. Six scorers ship:
// regex_match, string_equals, ast_equals, diff_size, pytest, and rubric.
// 44 tests pass.
const SCORERS = 6;
const TESTS = 44;

type Agent = { id: string; label: string; sub: string };
type Task = { id: string; label: string; scorer: string };

const agents: Agent[] = [
  { id: 'g5', label: 'gpt-5', sub: 'direct' },
  { id: 'g5m', label: 'gpt-5-mini', sub: 'direct' },
  { id: 'opus', label: 'opus', sub: 'react' },
];

const tasks: Task[] = [
  { id: 'extract', label: 'extract_method', scorer: 'pytest' },
  { id: 'rename', label: 'rename_symbol', scorer: 'ast_equals' },
  { id: 'dedupe', label: 'dedupe_total', scorer: 'diff_size' },
  { id: 'parse', label: 'parse_args', scorer: 'rubric' },
];

// Run A and Run B scores per task/agent, in [0,1]. Run B is a later sweep, so
// the diff view animates the per-cell deltas between the two runs.
const RUN_A: Record<string, Record<string, number>> = {
  extract: { g5: 1.0, g5m: 0.75, opus: 1.0 },
  rename: { g5: 1.0, g5m: 1.0, opus: 0.5 },
  dedupe: { g5: 0.8, g5m: 0.6, opus: 0.9 },
  parse: { g5: 0.7, g5m: 0.4, opus: 0.85 },
};
const RUN_B: Record<string, Record<string, number>> = {
  extract: { g5: 1.0, g5m: 1.0, opus: 1.0 },
  rename: { g5: 1.0, g5m: 1.0, opus: 0.75 },
  dedupe: { g5: 0.9, g5m: 0.55, opus: 0.9 },
  parse: { g5: 0.85, g5m: 0.6, opus: 0.8 },
};

const TOTAL_CELLS = tasks.length * agents.length;

// Fill order is the runner's completion order, intentionally not row-major, to
// show concurrency landing cells out of order.
const FILL_ORDER: { t: string; a: string }[] = [
  { t: 'extract', a: 'g5' },
  { t: 'rename', a: 'g5m' },
  { t: 'extract', a: 'opus' },
  { t: 'dedupe', a: 'g5' },
  { t: 'parse', a: 'g5m' },
  { t: 'rename', a: 'g5' },
  { t: 'extract', a: 'g5m' },
  { t: 'parse', a: 'opus' },
  { t: 'dedupe', a: 'opus' },
  { t: 'rename', a: 'opus' },
  { t: 'parse', a: 'g5' },
  { t: 'dedupe', a: 'g5m' },
];

const ease = [0.22, 1, 0.36, 1] as const;

// Map a score in [0,1] to an accent-tinted heat color.
function heat(score: number): string {
  const a = 0.12 + score * 0.6;
  return `rgba(255, 91, 41, ${a.toFixed(3)})`;
}

type View = 'run' | 'diff';

export default function AgentlabDemo() {
  const reduce = useReducedMotion();
  const [view, setView] = useState<View>('run');
  const [filled, setFilled] = useState(0);
  const [running, setRunning] = useState(false);
  const timer = useRef<number | null>(null);

  function clearTimer() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => clearTimer, []);

  function run() {
    if (running) return;
    clearTimer();
    setView('run');
    setFilled(0);
    setRunning(true);

    if (reduce) {
      setFilled(TOTAL_CELLS);
      setRunning(false);
      return;
    }
    let n = 0;
    const tick = () => {
      n += 1;
      setFilled(n);
      if (n < TOTAL_CELLS) {
        timer.current = window.setTimeout(tick, 260);
      } else {
        setRunning(false);
      }
    };
    timer.current = window.setTimeout(tick, 200);
  }

  function reset() {
    clearTimer();
    setFilled(0);
    setRunning(false);
    setView('run');
  }

  function isFilled(t: string, a: string): boolean {
    const idx = FILL_ORDER.findIndex((c) => c.t === t && c.a === a);
    return idx < filled;
  }

  const allFilled = filled >= TOTAL_CELLS;

  function showDiff() {
    if (running) return;
    clearTimer();
    setFilled(TOTAL_CELLS);
    setView('diff');
  }

  const gridTemplate = `150px repeat(${agents.length}, 1fr)`;

  return (
    <div className="demo" aria-label="agentlab score heatmap demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Task-by-agent score heatmap</h3>
      <p className="demo__lede">
        The async runner fills the matrix as each task-agent pair finishes, so
        cells land out of order under per-provider concurrency. Each cell is a
        scorer result in zero to one. Switch to the diff view to see per-cell
        deltas between two runs read back from the store.
      </p>

      <div className="al__stage">
        <div className="al__toolbar">
          <div className="al__tabs" role="tablist" aria-label="view">
            <button
              role="tab"
              aria-selected={view === 'run'}
              className={`al__tab${view === 'run' ? ' al__tab--on' : ''}`}
              onClick={() => setView('run')}
            >
              run scores
            </button>
            <button
              role="tab"
              aria-selected={view === 'diff'}
              className={`al__tab${view === 'diff' ? ' al__tab--on' : ''}`}
              onClick={showDiff}
            >
              run A to B diff
            </button>
          </div>
          <span className="al__progress">
            {Math.min(filled, TOTAL_CELLS)} / {TOTAL_CELLS} cells
          </span>
        </div>

        <div className="al__grid-wrap">
          <div className="al__grid" style={{ gridTemplateColumns: gridTemplate }}>
            <div className="al__corner">task \ agent</div>
            {agents.map((ag) => (
              <div key={ag.id} className="al__col-head">
                {ag.label}
                <span className="al__col-sub">{ag.sub}</span>
              </div>
            ))}

            {tasks.map((tk) => (
              <Row key={tk.id}>
                <div className="al__row-head">
                  {tk.label}
                  <span className="al__row-sub">{tk.scorer}</span>
                </div>
                {agents.map((ag) => {
                  const a = RUN_A[tk.id][ag.id];
                  const b = RUN_B[tk.id][ag.id];
                  const filledCell = isFilled(tk.id, ag.id) || view === 'diff';
                  const score = view === 'diff' ? b : a;
                  const delta = +(b - a).toFixed(2);
                  return (
                    <motion.div
                      key={ag.id}
                      className="al__cell"
                      style={{
                        background: filledCell ? heat(score) : 'var(--ink-850)',
                        borderColor: filledCell
                          ? 'var(--accent-line)'
                          : 'var(--line)',
                      }}
                      initial={false}
                      animate={
                        filledCell && !reduce
                          ? { scale: [0.82, 1] }
                          : { scale: 1 }
                      }
                      transition={{ duration: reduce ? 0 : 0.3, ease }}
                    >
                      {filledCell ? (
                        <>
                          <span>{score.toFixed(2)}</span>
                          {view === 'diff' && (
                            <span
                              className={`al__cell-delta al__cell-delta--${
                                delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
                              }`}
                            >
                              {delta > 0 ? '+' : ''}
                              {delta.toFixed(2)}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="al__cell-pending">…</span>
                      )}
                    </motion.div>
                  );
                })}
              </Row>
            ))}
          </div>
        </div>

        <div className="al__legend">
          <div className="al__legend-scale">
            <span className="al__legend-swatch" style={{ background: heat(0) }} />
            <span className="al__legend-swatch" style={{ background: heat(0.5) }} />
            <span className="al__legend-swatch" style={{ background: heat(1) }} />
            <span>score 0 to 1</span>
          </div>
          {view === 'diff' && (
            <span>
              <span style={{ color: '#4fd08a' }}>+</span> gain ·{' '}
              <span style={{ color: 'var(--accent)' }}>−</span> regression vs run A
            </span>
          )}
        </div>

        <AnimatePresence>
          {(allFilled || view === 'diff') && (
            <motion.div
              className="al__meta"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <div className="al__meta-card">
                <div className="al__meta-val">{SCORERS}</div>
                <div className="al__meta-label">
                  scorers: regex, equals, ast, diff_size, pytest, rubric
                </div>
              </div>
              <div className="al__meta-card">
                <div className="al__meta-val">SQLite</div>
                <div className="al__meta-label">
                  store with gzipped trajectories, diffable between runs
                </div>
              </div>
              <div className="al__meta-card">
                <div className="al__meta-val">{TESTS}</div>
                <div className="al__meta-label">tests passing</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Running…' : 'Run suite'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {agents.length} agents x {tasks.length} tasks under concurrency
        </span>
      </div>
    </div>
  );
}

// Subgrid row wrapper so each task row spans the full grid width.
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'contents' }}>{children}</div>;
}
