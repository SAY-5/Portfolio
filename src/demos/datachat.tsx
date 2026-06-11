import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './datachat.css';

// Real behavior from the project: a plain-English question streams generated
// Python token by token, the code runs in a sandboxed subprocess against a
// seeded 10k-row demo_orders table, and the resulting Plotly chart renders
// inline. The default model is a mock so it runs with no API key.
const ROW_COUNT = 10000;

type Question = {
  id: string;
  prompt: string;
  code: string;
  // A small bar series the "run" produces, drawn as the inline chart.
  bars: { label: string; value: number }[];
  yLabel: string;
  caption: string;
};

const QUESTIONS: Question[] = [
  {
    id: 'region',
    prompt: 'revenue by region for the last quarter',
    code: [
      'df = orders[orders.ordered_at >= q_start]',
      "g = df.groupby('region').revenue.sum()",
      'g = g.sort_values(ascending=False)',
      "fig = px.bar(g, labels={'value': 'revenue'})",
    ].join('\n'),
    yLabel: 'revenue (k)',
    bars: [
      { label: 'West', value: 182 },
      { label: 'East', value: 154 },
      { label: 'South', value: 121 },
      { label: 'North', value: 97 },
    ],
    caption: 'Grouped 10k orders by region, summed revenue, sorted descending.',
  },
  {
    id: 'monthly',
    prompt: 'monthly order volume this year',
    code: [
      "df = orders.set_index('ordered_at')",
      "m = df.resample('M').order_id.count()",
      "fig = px.line(m, labels={'value': 'orders'})",
      'fig.update_traces(mode="lines+markers")',
    ].join('\n'),
    yLabel: 'orders',
    bars: [
      { label: 'Jan', value: 612 },
      { label: 'Feb', value: 705 },
      { label: 'Mar', value: 668 },
      { label: 'Apr', value: 784 },
      { label: 'May', value: 851 },
      { label: 'Jun', value: 903 },
    ],
    caption: 'Resampled timestamps to month buckets and counted order ids.',
  },
  {
    id: 'aov',
    prompt: 'average order value by channel',
    code: [
      "g = orders.groupby('channel').revenue.mean()",
      'g = g.round(2).sort_values()',
      "fig = px.bar(g, labels={'value': 'aov'})",
      "fig.update_layout(yaxis_title='avg order value')",
    ].join('\n'),
    yLabel: 'aov ($)',
    bars: [
      { label: 'Email', value: 41 },
      { label: 'Organic', value: 58 },
      { label: 'Paid', value: 73 },
      { label: 'Direct', value: 96 },
    ],
    caption: 'Averaged revenue per order grouped by acquisition channel.',
  },
];

const ease = [0.22, 1, 0.36, 1] as const;
type Phase = 'idle' | 'streaming' | 'running' | 'done';

export default function DatachatDemo() {
  const reduce = useReducedMotion();
  const [qid, setQid] = useState(QUESTIONS[0].id);
  const [phase, setPhase] = useState<Phase>('idle');
  const [shown, setShown] = useState(0); // chars of code streamed so far
  const timers = useRef<number[]>([]);

  const q = QUESTIONS.find((x) => x.id === qid)!;
  const maxBar = Math.max(...q.bars.map((b) => b.value));

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function selectQ(id: string) {
    if (phase === 'streaming' || phase === 'running') return;
    clearTimers();
    setQid(id);
    setPhase('idle');
    setShown(0);
  }

  function run() {
    if (phase === 'streaming' || phase === 'running') return;
    clearTimers();
    setShown(0);

    if (reduce) {
      setShown(q.code.length);
      setPhase('done');
      return;
    }

    setPhase('streaming');
    const perChar = 14; // token-by-token feel
    for (let i = 1; i <= q.code.length; i++) {
      timers.current.push(
        window.setTimeout(() => {
          setShown(i);
          if (i === q.code.length) {
            // hand off to the sandboxed run, then render the chart
            timers.current.push(
              window.setTimeout(() => setPhase('running'), 260),
            );
            timers.current.push(
              window.setTimeout(() => setPhase('done'), 1040),
            );
          }
        }, i * perChar),
      );
    }
  }

  function reset() {
    clearTimers();
    setPhase('idle');
    setShown(0);
  }

  const codeOut = q.code.slice(0, shown);
  const running = phase === 'streaming' || phase === 'running';
  const chartReady = phase === 'done';

  return (
    <div className="demo" aria-label="datachat code-and-chart demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Ask, stream, run, chart</h3>
      <p className="demo__lede">
        Pick a question. The model streams Python token by token, the code runs
        in a sandboxed subprocess against a seeded {ROW_COUNT.toLocaleString()}
        -row demo_orders table, and the Plotly chart renders inline.
      </p>

      <div className="dc__chips" role="group" aria-label="example questions">
        {QUESTIONS.map((x) => (
          <button
            key={x.id}
            className={`dc__chip${x.id === qid ? ' dc__chip--on' : ''}`}
            aria-pressed={x.id === qid}
            onClick={() => selectQ(x.id)}
            disabled={running}
          >
            {x.prompt}
          </button>
        ))}
      </div>

      <div className="dc__stage">
        <div className="dc__pane dc__pane--code">
          <div className="dc__pane-head">
            <span className="dc__dot" aria-hidden="true" />
            <span className="dc__pane-name">generated.py</span>
            <span className="dc__pane-state">
              {phase === 'idle' && 'waiting'}
              {phase === 'streaming' && 'streaming'}
              {phase === 'running' && 'sandboxed run'}
              {phase === 'done' && 'exit 0'}
            </span>
          </div>
          <pre className="dc__code" aria-live="polite">
            <code>
              {codeOut}
              {phase === 'streaming' && <span className="dc__caret" />}
            </code>
          </pre>
        </div>

        <div className="dc__pane dc__pane--canvas">
          <div className="dc__pane-head">
            <span className="dc__pane-name">{q.yLabel}</span>
            <span className="dc__pane-state">
              {chartReady ? 'rendered' : running ? 'pending' : 'idle'}
            </span>
          </div>
          <div className="dc__chart" role="img" aria-label={q.caption}>
            <AnimatePresence mode="wait">
              {chartReady ? (
                <motion.div
                  key={q.id}
                  className="dc__bars"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.25 }}
                >
                  {q.bars.map((b, i) => (
                    <div className="dc__bar-col" key={b.label}>
                      <div className="dc__bar-track">
                        <motion.div
                          className="dc__bar-fill"
                          initial={{ height: reduce ? `${(b.value / maxBar) * 100}%` : 0 }}
                          animate={{ height: `${(b.value / maxBar) * 100}%` }}
                          transition={{
                            duration: reduce ? 0 : 0.5,
                            delay: reduce ? 0 : i * 0.07,
                            ease,
                          }}
                        />
                      </div>
                      <span className="dc__bar-label">{b.label}</span>
                    </div>
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  key="placeholder"
                  className="dc__placeholder"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {running ? 'running in subprocess…' : 'chart renders after the run'}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <AnimatePresence>
            {chartReady && (
              <motion.p
                className="dc__caption"
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease }}
              >
                {q.caption}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {phase === 'streaming'
            ? 'Streaming…'
            : phase === 'running'
              ? 'Running…'
              : 'Ask DataChat'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">mock model, no API key needed</span>
      </div>
    </div>
  );
}
