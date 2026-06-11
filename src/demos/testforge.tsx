import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './testforge.css';

// testforge proposes candidate pytest cases for a target function, then compiles
// and runs each under pytest in an isolated subprocess with a wall-clock
// timeout. Candidates that error, time out, or fail are discarded; a candidate
// that passes and fails across repeated runs is flagged flaky instead of kept.
// Kept tests extend the coverage map; the gap report ranks the worst-covered
// function first. On a local run (5 rounds, 3 candidates per round) the
// bundled bench measured about 6 candidates per second.

const ROUNDS = 5;
const PER_ROUND = 3;
const CANDIDATES = ROUNDS * PER_ROUND; // 15
const RATE = 6; // candidates per second, measured

type Verdict = 'kept' | 'failed' | 'flaky';

type Candidate = {
  id: number;
  round: number;
  name: string;
  verdict: Verdict;
  reason: string;
  // Source lines this candidate exercises when kept (indices into LINES).
  covers: number[];
};

// The target function under test, shown as a coverage map. Each entry is a line
// of source; `branch` marks the two arms of the single conditional.
const LINES: { text: string; branch?: 'then' | 'else' }[] = [
  { text: 'def classify(n):' },
  { text: '    if n < 0:', branch: undefined },
  { text: '        return "neg"', branch: 'then' },
  { text: '    if n == 0:' },
  { text: '        return "zero"', branch: 'then' },
  { text: '    return "pos"', branch: 'else' },
];

// Scripted candidate stream. Each kept candidate covers specific lines so the
// map fills in believably; two are discarded, one is flagged flaky.
const SCRIPT: Omit<Candidate, 'round'>[] = [
  { id: 1, name: 'test_positive', verdict: 'kept', reason: 'passed', covers: [0, 1, 3, 5] },
  { id: 2, name: 'test_zero', verdict: 'kept', reason: 'passed', covers: [0, 1, 3, 4] },
  { id: 3, name: 'test_none_input', verdict: 'failed', reason: 'TypeError, discarded', covers: [] },
  { id: 4, name: 'test_negative', verdict: 'kept', reason: 'passed', covers: [0, 1, 2] },
  { id: 5, name: 'test_large', verdict: 'kept', reason: 'passed', covers: [0, 1, 3, 5] },
  { id: 6, name: 'test_sleep_timing', verdict: 'flaky', reason: 'flaky across runs', covers: [] },
  { id: 7, name: 'test_float_pos', verdict: 'kept', reason: 'passed', covers: [0, 1, 3, 5] },
  { id: 8, name: 'test_bad_assert', verdict: 'failed', reason: 'AssertionError, discarded', covers: [] },
  { id: 9, name: 'test_neg_edge', verdict: 'kept', reason: 'passed', covers: [0, 1, 2] },
  { id: 10, name: 'test_zero_again', verdict: 'kept', reason: 'passed', covers: [0, 1, 3, 4] },
  { id: 11, name: 'test_timeout_loop', verdict: 'failed', reason: 'timed out, discarded', covers: [] },
  { id: 12, name: 'test_pos_chain', verdict: 'kept', reason: 'passed', covers: [0, 1, 3, 5] },
  { id: 13, name: 'test_neg_two', verdict: 'kept', reason: 'passed', covers: [0, 1, 2] },
  { id: 14, name: 'test_zero_repr', verdict: 'kept', reason: 'passed', covers: [0, 1, 3, 4] },
  { id: 15, name: 'test_pos_repr', verdict: 'kept', reason: 'passed', covers: [0, 1, 3, 5] },
];

const ease = [0.22, 1, 0.36, 1] as const;
const stepMs = Math.round(1000 / RATE); // ~167ms per candidate at 6/sec

export default function TestforgeDemo() {
  const reduce = useReducedMotion();
  const [processed, setProcessed] = useState(0); // candidates resolved so far
  const [inGate, setInGate] = useState<number | null>(null); // id currently in sandbox
  const [running, setRunning] = useState(false);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const resolved = SCRIPT.slice(0, processed);
  const covered = new Set<number>();
  resolved.forEach((c) => {
    if (c.verdict === 'kept') c.covers.forEach((l) => covered.add(l));
  });
  const kept = resolved.filter((c) => c.verdict === 'kept').length;
  const failed = resolved.filter((c) => c.verdict === 'failed').length;
  const flaky = resolved.filter((c) => c.verdict === 'flaky').length;

  // Uncovered code lines (exclude the def header from the gap, like a report).
  const codeLines = LINES.map((_, i) => i).filter((i) => i > 0);
  const uncovered = codeLines.filter((i) => !covered.has(i));
  const branchLines = LINES.map((l, i) => ({ l, i })).filter((x) => x.l.branch);
  const branchesCovered = branchLines.filter((x) => covered.has(x.i)).length;
  const allDone = processed >= CANDIDATES;

  const reset = useCallback(() => {
    clearTimers();
    setProcessed(0);
    setInGate(null);
    setRunning(false);
  }, [clearTimers]);

  const advance = useCallback(
    (i: number) => {
      if (i >= CANDIDATES) {
        setInGate(null);
        setRunning(false);
        return;
      }
      setInGate(SCRIPT[i].id);
      const settle = window.setTimeout(
        () => {
          setProcessed(i + 1);
          setInGate(null);
          const next = window.setTimeout(() => advance(i + 1), stepMs * 0.4);
          timers.current.push(next);
        },
        stepMs * 0.6,
      );
      timers.current.push(settle);
    },
    [],
  );

  const run = useCallback(() => {
    if (running) return;
    clearTimers();
    setProcessed(0);
    setInGate(null);
    if (reduce) {
      setProcessed(CANDIDATES);
      return;
    }
    setRunning(true);
    const t = window.setTimeout(() => advance(0), 60);
    timers.current.push(t);
  }, [running, reduce, clearTimers, advance]);

  const current = inGate ? SCRIPT.find((c) => c.id === inGate) : null;

  return (
    <div className="demo" aria-label="testforge candidate test demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Propose, prove, measure the gap</h3>
      <p className="demo__lede">
        Run {ROUNDS} rounds of {PER_ROUND} candidates. Each candidate passes
        through a sandbox that compiles and runs it under pytest in a separate
        subprocess. It is kept on a pass, discarded on a failure or timeout, or
        flagged flaky when it passes and fails across runs. Kept tests fill in
        the coverage map; uncovered lines and branches stay highlighted.
      </p>

      <div className="tf__stage">
        <div className="tf__gate-col">
          <div className="tf__gate-head">sandbox gate</div>
          <div className={`tf__gate ${current ? 'tf__gate--busy' : ''}`}>
            <AnimatePresence mode="wait">
              {current ? (
                <motion.div
                  key={current.id}
                  className="tf__gate-item"
                  initial={{ opacity: 0, y: reduce ? 0 : 14, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: reduce ? 0 : 0.18, ease }}
                >
                  <span className="tf__gate-name">{current.name}</span>
                  <span className="tf__gate-run">compiling · pytest run…</span>
                </motion.div>
              ) : (
                <motion.div
                  key="idle"
                  className="tf__gate-idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  {allDone ? 'all candidates resolved' : 'awaiting candidates'}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <ul className="tf__stream" aria-label="candidate verdicts">
            <AnimatePresence initial={false}>
              {resolved
                .slice()
                .reverse()
                .map((c) => (
                  <motion.li
                    key={c.id}
                    className={`tf__cand tf__cand--${c.verdict}`}
                    initial={{ opacity: 0, x: reduce ? 0 : -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: reduce ? 0 : 0.22, ease }}
                  >
                    <span className="tf__cand-dot" />
                    <span className="tf__cand-name">{c.name}</span>
                    <span className="tf__cand-reason">{c.reason}</span>
                    <span className="tf__cand-verdict">{c.verdict}</span>
                  </motion.li>
                ))}
            </AnimatePresence>
            {resolved.length === 0 && (
              <li className="tf__stream-empty">No candidates yet.</li>
            )}
          </ul>
        </div>

        <div className="tf__cov-col">
          <div className="tf__cov-head">coverage map · classify()</div>
          <div className="tf__code" role="img" aria-label="coverage of target function">
            {LINES.map((ln, i) => {
              const isCovered = covered.has(i);
              const isUncovered = i > 0 && !isCovered;
              return (
                <div
                  key={i}
                  className={`tf__codeline ${
                    isCovered ? 'tf__codeline--hit' : ''
                  } ${isUncovered ? 'tf__codeline--miss' : ''}`}
                >
                  <span className="tf__gutter">{i + 1}</span>
                  <span className="tf__src">{ln.text}</span>
                  {ln.branch && (
                    <span className="tf__branch">
                      {isCovered ? 'branch hit' : 'branch missing'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="tf__gap">
            <div className="tf__gap-head">gap report · worst first</div>
            {uncovered.length === 0 && branchesCovered === branchLines.length ? (
              <div className="tf__gap-clear">classify(): no remaining gaps</div>
            ) : (
              <div className="tf__gap-row">
                <span className="tf__gap-fn">classify()</span>
                <span className="tf__gap-detail">
                  {uncovered.length} line{uncovered.length === 1 ? '' : 's'},{' '}
                  {branchLines.length - branchesCovered} branch
                  {branchLines.length - branchesCovered === 1 ? '' : 'es'} uncovered
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="tf__metrics">
        <div className="tf__metric">
          <span className="tf__metric-val">{kept}</span>
          <span className="tf__metric-label">kept</span>
        </div>
        <div className="tf__metric">
          <span className="tf__metric-val">{failed}</span>
          <span className="tf__metric-label">discarded</span>
        </div>
        <div className="tf__metric">
          <span className="tf__metric-val">{flaky}</span>
          <span className="tf__metric-label">flaky</span>
        </div>
        <div className="tf__metric tf__metric--rate">
          <span className="tf__metric-val">{RATE}</span>
          <span className="tf__metric-label">candidates / sec</span>
        </div>
      </div>

      <AnimatePresence>
        {allDone && (
          <motion.div
            className="tf__verdict"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            <span className="tf__verdict-head">Run complete</span>
            <span className="tf__verdict-text">
              {kept} of {CANDIDATES} candidates passed the sandbox and were kept,{' '}
              {failed} were discarded, and {flaky} was flagged flaky. Because the
              bundled provider is deterministic, the run is hermetic and
              repeatable at about {RATE} candidates per second.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Running…' : allDone ? 'Replay run' : 'Run rounds'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {processed} of {CANDIDATES} candidates resolved
        </span>
      </div>
    </div>
  );
}
