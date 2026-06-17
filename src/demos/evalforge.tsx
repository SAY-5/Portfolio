import { useId, useState } from 'react';
import '../styles/demo.css';
import './evalforge.css';
import { SCORERS, scorerById, type RunResult } from './evalforge/types';
import { useStore } from './evalforge/state';
import {
  addCase,
  deleteCase,
  resetAll,
  run,
  setScorer,
  setTolerance,
  updateCase,
} from './evalforge/store';

// In-browser case evaluation harness. Define cases (input + expected), paste a
// candidate output per case, pick a scorer and tolerance, then run. The suite,
// the last run, and a short run history persist in localStorage. Scoring is the
// deterministic engine over the entered values: no network call, no eval.
// The regex scorer compiles its pattern safely in a try/catch in the engine.

function pct(n: number): number {
  return Math.round(n * 100);
}

// A compact gauge for the overall pass rate.
function Scorecard({ run: r }: { run: RunResult }) {
  const rate = pct(r.passRate);
  const scorer = scorerById(r.scorer);
  return (
    <div className="ef-card glass ef-scorecard" aria-label="overall pass rate">
      <div
        className="ef-gauge"
        role="img"
        aria-label={`pass rate ${rate} percent, ${r.passed} of ${r.total} cases passed`}
        style={{ ['--ef-rate' as string]: `${rate}` }}
      >
        <div className="ef-gauge__val">
          <span className="ef-gauge__num">{rate}</span>
          <span className="ef-gauge__unit">%</span>
        </div>
      </div>
      <dl className="ef-scorecard__meta">
        <div>
          <dt>Passed</dt>
          <dd>
            {r.passed} / {r.total}
          </dd>
        </div>
        <div>
          <dt>Scorer</dt>
          <dd>{scorer.name}</dd>
        </div>
        {scorer.usesTolerance && (
          <div>
            <dt>Tolerance</dt>
            <dd>±{r.tolerance}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

// Inline expected-vs-actual diff: a character-level common-prefix and
// common-suffix split, so the differing middle stands out without a heavy diff
// library. Purely presentational.
function Diff({ expected, actual }: { expected: string; actual: string }) {
  if (expected === actual) {
    return (
      <div className="ef-diff is-same">
        <span className="ef-diff__row">
          <span className="ef-diff__tag">both</span>
          <span className="ef-diff__text">{actual || '(empty)'}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="ef-diff">
      <span className="ef-diff__row">
        <span className="ef-diff__tag">expected</span>
        <span className="ef-diff__text">
          {highlight(expected, actual, 'exp')}
        </span>
      </span>
      <span className="ef-diff__row">
        <span className="ef-diff__tag">actual</span>
        <span className="ef-diff__text">
          {highlight(actual, expected, 'act')}
        </span>
      </span>
    </div>
  );
}

// Wrap the differing middle segment of `a` (relative to `b`) in a mark.
function highlight(a: string, b: string, key: string) {
  if (a.length === 0) {
    return <span className="ef-diff__empty">(empty)</span>;
  }
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const head = a.slice(0, start);
  const mid = a.slice(start, endA);
  const tail = a.slice(endA);
  return (
    <>
      {head && <span key={`${key}-h`}>{head}</span>}
      {mid && (
        <mark key={`${key}-m`} className="ef-diff__mark">
          {mid}
        </mark>
      )}
      {tail && <span key={`${key}-t`}>{tail}</span>}
    </>
  );
}

// One run-history trend strip, oldest on the left, newest on the right.
function Trend({
  history,
}: {
  history: { at: number; passRate: number; passed: number; total: number }[];
}) {
  if (history.length === 0) {
    return (
      <p className="ef-trend__empty">
        No runs yet. Run the suite to start a trend.
      </p>
    );
  }
  const ordered = [...history].reverse();
  return (
    <ol
      className="ef-trend"
      aria-label="recent run pass rates, oldest to newest"
    >
      {ordered.map((h, i) => {
        const rate = pct(h.passRate);
        const latest = i === ordered.length - 1;
        return (
          <li
            key={h.at}
            className={`ef-trend__bar${latest ? ' is-latest' : ''}`}
            title={`${rate}% (${h.passed}/${h.total})`}
          >
            <span
              className="ef-trend__fill"
              style={{ ['--ef-h' as string]: `${rate}` }}
            />
            <span className="ef-trend__label">{rate}%</span>
          </li>
        );
      })}
    </ol>
  );
}

export default function EvalforgeDemo() {
  const { suite, lastRun, history } = useStore();
  const baseId = useId();
  // Snapshot the wall clock into state at trigger time so render stays pure:
  // the engine and store accept the snapshot as a parameter rather than reading
  // the clock themselves.
  const [, setLastAt] = useState(0);

  const scorer = scorerById(suite.scorer);
  // Map last-run results by case id for quick lookup in the editor rows.
  const resultById = new Map((lastRun?.results ?? []).map((r) => [r.id, r]));

  function onRun() {
    const at = Date.now();
    setLastAt(at);
    run(at);
  }

  function onReset() {
    resetAll();
    setLastAt(0);
  }

  return (
    <div className="demo" aria-label="evalforge case evaluation harness">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Score candidate outputs against a suite</h3>
      <p className="demo__lede">
        Define cases with an input and an expected value, paste a candidate
        output into each, pick a scorer, and run. The harness scores every case
        deterministically and reports a pass-rate scorecard, per-case diffs, and
        a trend across recent runs. Everything runs in your browser and persists
        locally.
      </p>

      <div className="ef-grid">
        <section className="ef-card glass" aria-labelledby={`${baseId}-suite`}>
          <header className="ef-card__head">
            <h4 id={`${baseId}-suite`} className="ef-card__title">
              Suite editor
            </h4>
            <span className="ef-card__count">
              {suite.cases.length} case{suite.cases.length === 1 ? '' : 's'}
            </span>
          </header>

          <div className="ef-controls">
            <label className="ef-field">
              <span className="ef-field__label">Scorer</span>
              <select
                className="ef-select"
                value={suite.scorer}
                onChange={(e) =>
                  setScorer(e.target.value as typeof suite.scorer)
                }
              >
                {SCORERS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            {scorer.usesTolerance && (
              <label className="ef-field ef-field--narrow">
                <span className="ef-field__label">Tolerance ±</span>
                <input
                  className="ef-input"
                  type="number"
                  min={0}
                  step="0.1"
                  value={suite.tolerance}
                  onChange={(e) => setTolerance(Number(e.target.value))}
                />
              </label>
            )}
          </div>
          <p className="ef-controls__blurb">{scorer.blurb}</p>

          <ul className="ef-cases">
            {suite.cases.map((c) => {
              const res = resultById.get(c.id);
              const status = res ? (res.pass ? 'pass' : 'fail') : 'idle';
              return (
                <li key={c.id} className={`ef-caserow is-${status}`}>
                  <div className="ef-caserow__head">
                    <span className="ef-caserow__id">{c.id}</span>
                    {res && (
                      <span className={`ef-pill is-${status}`}>
                        {res.pass ? 'pass' : 'fail'}
                      </span>
                    )}
                    <button
                      type="button"
                      className="ef-iconbtn"
                      onClick={() => deleteCase(c.id)}
                      aria-label={`Delete case ${c.id}`}
                    >
                      Delete
                    </button>
                  </div>
                  <label className="ef-cell">
                    <span className="ef-cell__label">Input</span>
                    <input
                      className="ef-input"
                      type="text"
                      value={c.input}
                      placeholder="what the case exercises"
                      onChange={(e) =>
                        updateCase(c.id, { input: e.target.value })
                      }
                    />
                  </label>
                  <div className="ef-cell-pair">
                    <label className="ef-cell">
                      <span className="ef-cell__label">
                        Expected
                        {suite.scorer === 'regex' ? ' (pattern)' : ''}
                      </span>
                      <input
                        className="ef-input mono"
                        type="text"
                        value={c.expected}
                        placeholder={
                          suite.scorer === 'regex'
                            ? 'regex pattern'
                            : 'expected value'
                        }
                        onChange={(e) =>
                          updateCase(c.id, { expected: e.target.value })
                        }
                      />
                    </label>
                    <label className="ef-cell">
                      <span className="ef-cell__label">Actual output</span>
                      <input
                        className="ef-input mono"
                        type="text"
                        value={c.actual}
                        placeholder="paste candidate output"
                        onChange={(e) =>
                          updateCase(c.id, { actual: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  {res && (
                    <div className="ef-caserow__result">
                      <Diff expected={c.expected} actual={c.actual} />
                      <span className="ef-caserow__detail">
                        {res.detail} · score {res.score.toFixed(2)}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="demo__controls">
            <button className="demo__btn" type="button" onClick={onRun}>
              Run suite
            </button>
            <button
              className="demo__btn demo__btn--ghost"
              type="button"
              onClick={() => addCase()}
            >
              Add case
            </button>
            <button
              className="demo__btn demo__btn--ghost"
              type="button"
              onClick={onReset}
            >
              Reset
            </button>
          </div>
        </section>

        <aside className="ef-side">
          {lastRun ? (
            <Scorecard run={lastRun} />
          ) : (
            <div className="ef-card glass ef-scorecard ef-scorecard--idle">
              <p className="ef-idle">Run the suite to see the scorecard.</p>
            </div>
          )}

          <section
            className="ef-card glass"
            aria-labelledby={`${baseId}-trend`}
          >
            <header className="ef-card__head">
              <h4 id={`${baseId}-trend`} className="ef-card__title">
                Run history
              </h4>
              <span className="ef-card__count">
                {history.length} run{history.length === 1 ? '' : 's'}
              </span>
            </header>
            <Trend history={history} />
          </section>
        </aside>
      </div>

      <p className="demo__hint" aria-live="polite">
        {lastRun
          ? `${lastRun.passed} of ${lastRun.total} cases passed with ${scorer.name.toLowerCase()}`
          : 'no run yet'}
      </p>
    </div>
  );
}
