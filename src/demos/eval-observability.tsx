import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './eval-observability.css';

// Real numbers from the project: the OTel span hierarchy is
// suite > category > example > llm_call, and the sample regression report
// flags summarization where the 7-day mean dropped 0.6188 to 0.3925
// (delta -22.63pp, p=0.0059). A category is flagged only when the mean
// drops more than 2 percentage points AND the t-test reaches significance.
const PRIOR_MEAN = 0.6188;
const RECENT_MEAN = 0.3925;
const DELTA_PP = -22.63;
const P_VALUE = 0.0059;
const ALPHA = 0.05;
const THRESHOLD_PP = 2;

const ease = [0.22, 1, 0.36, 1] as const;

type SpanNode = {
  id: string;
  label: string;
  kind: string;
  depth: number;
  ms: number;
};

// One representative path through the nested span tree of a single run.
const spans: SpanNode[] = [
  { id: 'suite', label: 'suite: nightly', kind: 'suite', depth: 0, ms: 8421 },
  { id: 'cat', label: 'category: summarization', kind: 'category', depth: 1, ms: 2840 },
  { id: 'ex', label: 'example: doc_0142', kind: 'example', depth: 2, ms: 612 },
  { id: 'call', label: 'llm_call: chat.completions', kind: 'llm_call', depth: 3, ms: 588 },
];

// A small bell curve sampled into bars, centered on a mean.
function curve(mean: number) {
  const bars: { x: number; h: number }[] = [];
  const sd = 0.13;
  for (let i = 0; i < 21; i++) {
    const x = i / 20; // 0..1 score
    const z = (x - mean) / sd;
    const h = Math.exp(-0.5 * z * z);
    bars.push({ x, h });
  }
  return bars;
}

const priorBars = curve(PRIOR_MEAN);
const recentBars = curve(RECENT_MEAN);

export default function EvalObservabilityDemo() {
  const reduce = useReducedMotion();
  // step: 0 idle, 1..spans.length tree expanding, then 'dist' compare, 'flag'
  const [revealed, setRevealed] = useState(0);
  const [stage, setStage] = useState<'idle' | 'tree' | 'dist' | 'flag'>('idle');
  const [running, setRunning] = useState(false);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    setRevealed(0);
    setStage('idle');
    setRunning(false);
  }, [clearTimers]);

  function run() {
    if (running) return;
    clearTimers();
    setRunning(true);
    setRevealed(0);
    setStage('tree');

    if (reduce) {
      setRevealed(spans.length);
      setStage('flag');
      setRunning(false);
      return;
    }

    // Expand the span tree one node at a time, then slide the two
    // distributions apart and trip the regression flag.
    spans.forEach((_, i) => {
      timers.current.push(
        window.setTimeout(() => setRevealed(i + 1), 380 * (i + 1)),
      );
    });
    const afterTree = 380 * spans.length + 250;
    timers.current.push(window.setTimeout(() => setStage('dist'), afterTree));
    timers.current.push(
      window.setTimeout(() => {
        setStage('flag');
        setRunning(false);
      }, afterTree + 1400),
    );
  }

  const showDist = stage === 'dist' || stage === 'flag';
  const flagged = stage === 'flag';

  return (
    <div className="demo" aria-label="eval-observability span tree and regression demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Spans in, regression out</h3>
      <p className="demo__lede">
        Run a suite to watch the OpenTelemetry span tree nest from suite down to
        the individual llm_call. The daily job then compares the recent 7-day
        score window against the prior window per category and flags one only
        when the mean drops past the threshold and the t-test reaches
        significance.
      </p>

      <div className="eo__stage">
        <div className="eo__tree" role="tree" aria-label="span hierarchy">
          <AnimatePresence>
            {spans.map((s, i) =>
              i < revealed ? (
                <motion.div
                  key={s.id}
                  role="treeitem"
                  aria-level={s.depth + 1}
                  className={`eo__span eo__span--${s.kind}`}
                  style={{ marginLeft: s.depth * 22 }}
                  initial={{ opacity: 0, x: reduce ? 0 : -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: reduce ? 0 : 0.32, ease }}
                >
                  <span className="eo__span-rail" aria-hidden="true" />
                  <span className="eo__span-kind">{s.kind}</span>
                  <span className="eo__span-label">{s.label}</span>
                  <span className="eo__span-ms">{s.ms} ms</span>
                </motion.div>
              ) : null,
            )}
          </AnimatePresence>
          {revealed === 0 && (
            <div className="eo__tree-empty">
              press Run to emit the span hierarchy
            </div>
          )}
          {revealed >= spans.length && (
            <motion.div
              className="eo__trace-id"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              trace_id 4ac9f1 threaded into every JSON log line
            </motion.div>
          )}
        </div>

        <div className="eo__dist">
          <div className="eo__dist-head">
            <span>category: summarization</span>
            <span className="eo__dist-axis">score 0.0 to 1.0</span>
          </div>
          <div className="eo__chart" aria-hidden="true">
            {/* significance / threshold marker between the two means */}
            <motion.div
              className="eo__threshold"
              animate={{
                left: showDist ? `${RECENT_MEAN * 100}%` : `${PRIOR_MEAN * 100}%`,
                opacity: showDist ? 1 : 0,
              }}
              transition={{ duration: reduce ? 0 : 1.1, ease }}
            />
            <div className="eo__bars">
              {priorBars.map((b, i) => (
                <div
                  key={`p${i}`}
                  className="eo__bar eo__bar--prior"
                  style={{ height: `${b.h * 100}%`, opacity: 0.85 }}
                />
              ))}
            </div>
            <motion.div
              className="eo__bars eo__bars--recent"
              animate={{ x: showDist ? '0%' : '0%', opacity: showDist ? 1 : 0 }}
              transition={{ duration: reduce ? 0 : 1.1, ease }}
            >
              {recentBars.map((b, i) => (
                <div
                  key={`r${i}`}
                  className="eo__bar eo__bar--recent"
                  style={{ height: `${b.h * 100}%` }}
                />
              ))}
            </motion.div>
          </div>
          <div className="eo__legend">
            <span className="eo__legend-item eo__legend-item--prior">
              prior 7d, mean {PRIOR_MEAN}
            </span>
            <span className="eo__legend-item eo__legend-item--recent">
              recent 7d, mean {RECENT_MEAN}
            </span>
          </div>
        </div>

        <div className="eo__pmeter">
          <div className="eo__pmeter-row">
            <span className="eo__pmeter-label">Welch two-sample t-test</span>
            <motion.span
              className={`eo__pmeter-val ${flagged ? 'eo__pmeter-val--sig' : ''}`}
              animate={flagged && !reduce ? { scale: [1, 1.08, 1] } : undefined}
              transition={{ duration: 0.35 }}
            >
              p = {showDist ? P_VALUE.toFixed(4) : '----'}
            </motion.span>
          </div>
          <div className="eo__pmeter-track">
            <span className="eo__pmeter-alpha" style={{ left: `${ALPHA * 100 * 4}%` }}>
              alpha {ALPHA}
            </span>
            <motion.span
              className="eo__pmeter-dot"
              animate={{ left: showDist ? `${P_VALUE * 100 * 4}%` : '60%' }}
              transition={{ duration: reduce ? 0 : 1.1, ease }}
            />
          </div>
        </div>

        <AnimatePresence>
          {flagged && (
            <motion.div
              className="eo__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="eo__verdict-head">Regression flagged</span>
              <span className="eo__verdict-text">
                summarization dropped {DELTA_PP}pp, past the {THRESHOLD_PP}pp
                threshold, with p = {P_VALUE} below alpha {ALPHA}. The report
                persists to Postgres. The pure-Python Welch test matches
                scipy.stats.ttest_ind to four decimal places.
              </span>
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
          flag rule: drop &gt; {THRESHOLD_PP}pp and p &lt; {ALPHA}
        </span>
      </div>
    </div>
  );
}
