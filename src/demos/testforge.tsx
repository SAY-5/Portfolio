import { useMemo, useState } from 'react';
import '../styles/demo.css';
import './testforge.css';
import { useStore } from './testforge/state';
import {
  addCase,
  deleteCase,
  recordRun,
  resetAll,
  selectSuite,
  simulateRun,
  updateCase,
} from './testforge/store';
import {
  flakyCases,
  lastStatus,
  passRateTrend,
  slowestCases,
  suiteHealth,
} from './testforge/engine';
import type { CaseStatus, TestCase } from './testforge/types';

// In-browser test-suite manager. Suites group cases; each case carries its
// steps and expectation. A run records one status per case and a duration, kept
// in localStorage so suites, cases, and history survive a reload. A run is data
// the engine aggregates, never code it executes, so there is no eval anywhere.
// You can record a run by marking each case by hand, or simulate one from a
// deterministic seeded pattern that produces occasional flaky flips. Insights
// derive a pass-rate trend, flaky cases with their flip history, and the
// slowest cases, all from recorded runs.

function pct(rate: number | null): string {
  if (rate === null) return 'n/a';
  return `${Math.round(rate * 100)}%`;
}

const STATUS_LABEL: Record<CaseStatus, string> = {
  pass: 'pass',
  fail: 'fail',
  skip: 'skip',
};

type Draft = { name: string; steps: string; expected: string };

const EMPTY_DRAFT: Draft = { name: '', steps: '', expected: '' };

export default function Testforge() {
  const { suites, cases, runs, selectedSuiteId } = useStore();

  const suite = suites.find((s) => s.id === selectedSuiteId) ?? suites[0];
  const suiteCases = useMemo(
    () => (suite ? cases.filter((c) => suite.caseIds.includes(c.id)) : []),
    [suite, cases],
  );

  // Add-case form state.
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  // Inline edit target.
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);

  // Manual run marks, keyed by case id; absent means skip.
  const [marks, setMarks] = useState<Record<string, CaseStatus>>({});
  // Id of the most recent run to summarize after recording.
  const [lastRunId, setLastRunId] = useState<string | null>(null);

  const health = useMemo(
    () => (suite ? suiteHealth(runs, suites, cases, suite.id) : null),
    [runs, suites, cases, suite],
  );
  const trend = useMemo(
    () => (suite ? passRateTrend(runs, suite.id) : []),
    [runs, suite],
  );
  const flaky = useMemo(
    () => (suite ? flakyCases(runs, cases, suite.id) : []),
    [runs, cases, suite],
  );
  const slow = useMemo(
    () => (suite ? slowestCases(runs, cases, suite.id) : []),
    [runs, cases, suite],
  );

  const lastRun = lastRunId ? runs.find((r) => r.id === lastRunId) ?? null : null;
  const lastRunSummary = lastRun
    ? {
        passed: lastRun.results.filter((r) => r.status === 'pass').length,
        failed: lastRun.results.filter((r) => r.status === 'fail').length,
        skipped: lastRun.results.filter((r) => r.status === 'skip').length,
      }
    : null;

  if (!suite) {
    return (
      <div className="demo" aria-label="testforge test-suite manager">
        <span className="demo__tag">Interactive demo</span>
        <h3 className="demo__title">No suites</h3>
        <p className="demo__lede">Reset to restore the seeded suites.</p>
      </div>
    );
  }

  function beginEdit(tc: TestCase) {
    setEditId(tc.id);
    setEditDraft({ name: tc.name, steps: tc.steps, expected: tc.expected });
  }

  function commitEdit() {
    if (!editId) return;
    updateCase(editId, editDraft);
    setEditId(null);
  }

  function setMark(caseId: string, status: CaseStatus) {
    setMarks((m) => ({ ...m, [caseId]: status }));
  }

  function doRecordManual() {
    const run = recordRun(suite.id, marks);
    if (run) {
      setLastRunId(run.id);
      setMarks({});
    }
  }

  function doSimulate() {
    const run = simulateRun(suite.id);
    if (run) setLastRunId(run.id);
  }

  function doReset() {
    resetAll();
    setMarks({});
    setEditId(null);
    setLastRunId(null);
    setDraft(EMPTY_DRAFT);
  }

  const activeCases = suiteCases.filter((c) => c.state === 'active');
  const trendCount = trend.length;

  return (
    <div className="demo" aria-label="testforge test-suite manager">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Manage suites, record runs, watch for flakes</h3>
      <p className="demo__lede">
        Group test cases into suites, record a run by marking each case or by
        simulating a seeded run, and read the pass-rate trend, flaky cases, and
        slowest cases the engine derives. Everything persists in your browser;
        nothing here executes code, so a run is recorded data, not evaluation.
      </p>

      <div className="tf__grid">
        {/* ---- suite list ---- */}
        <section className="glass tf__panel tf__suites" aria-label="Suites">
          <h4 className="tf__panel-head">Suites</h4>
          <ul className="tf__suite-list">
            {suites.map((s) => {
              const h = suiteHealth(runs, suites, cases, s.id);
              const selected = s.id === suite.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`tf__suite ${selected ? 'tf__suite--on' : ''}`}
                    aria-pressed={selected}
                    onClick={() => selectSuite(s.id)}
                  >
                    <span className="tf__suite-name">{s.name}</span>
                    <span className="tf__suite-meta">
                      {h.caseCount} cases · {pct(h.lastPassRate)} last
                    </span>
                    {h.flakyCount > 0 && (
                      <span className="tf__suite-flaky">{h.flakyCount} flaky</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {health && (
            <dl className="tf__health" aria-label="Suite health">
              <div>
                <dt>Runs</dt>
                <dd>{health.runs}</dd>
              </div>
              <div>
                <dt>Active</dt>
                <dd>
                  {health.activeCount}/{health.caseCount}
                </dd>
              </div>
              <div>
                <dt>Mean pass</dt>
                <dd>{pct(health.meanPassRate)}</dd>
              </div>
              <div>
                <dt>Flaky</dt>
                <dd>{health.flakyCount}</dd>
              </div>
            </dl>
          )}
        </section>

        {/* ---- cases ---- */}
        <section className="glass tf__panel tf__cases" aria-label="Test cases">
          <h4 className="tf__panel-head">
            {suite.name}{' '}
            <span className="tf__panel-sub">{suite.description}</span>
          </h4>

          <table className="tf__table">
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th scope="col">Expected</th>
                <th scope="col">State</th>
                <th scope="col">Last</th>
                <th scope="col">
                  <span className="tf__sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {suiteCases.map((tc) => {
                const last = lastStatus(runs, suite.id, tc.id);
                const editing = editId === tc.id;
                if (editing) {
                  return (
                    <tr key={tc.id} className="tf__row tf__row--edit">
                      <td colSpan={5}>
                        <div className="tf__edit">
                          <label className="tf__field">
                            <span>Name</span>
                            <input
                              value={editDraft.name}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, name: e.target.value }))
                              }
                            />
                          </label>
                          <label className="tf__field">
                            <span>Steps</span>
                            <input
                              value={editDraft.steps}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, steps: e.target.value }))
                              }
                            />
                          </label>
                          <label className="tf__field">
                            <span>Expected</span>
                            <input
                              value={editDraft.expected}
                              onChange={(e) =>
                                setEditDraft((d) => ({
                                  ...d,
                                  expected: e.target.value,
                                }))
                              }
                            />
                          </label>
                          <div className="tf__edit-actions">
                            <button
                              type="button"
                              className="demo__btn"
                              onClick={commitEdit}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="demo__btn demo__btn--ghost"
                              onClick={() => setEditId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={tc.id} className="tf__row">
                    <td>
                      <span className="tf__case-name">{tc.name}</span>
                      <span className="tf__case-steps">{tc.steps}</span>
                    </td>
                    <td className="tf__case-exp">{tc.expected}</td>
                    <td>
                      <button
                        type="button"
                        className={`tf__state tf__state--${tc.state}`}
                        aria-label={`Toggle ${tc.name} state, currently ${tc.state}`}
                        onClick={() =>
                          updateCase(tc.id, {
                            state: tc.state === 'active' ? 'skipped' : 'active',
                          })
                        }
                      >
                        {tc.state}
                      </button>
                    </td>
                    <td>
                      {last ? (
                        <span className={`tf__pill tf__pill--${last}`}>
                          {STATUS_LABEL[last]}
                        </span>
                      ) : (
                        <span className="tf__pill tf__pill--none">never</span>
                      )}
                    </td>
                    <td className="tf__row-actions">
                      <button
                        type="button"
                        className="tf__icon"
                        onClick={() => beginEdit(tc)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="tf__icon tf__icon--danger"
                        onClick={() => deleteCase(tc.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
              {suiteCases.length === 0 && (
                <tr>
                  <td colSpan={5} className="tf__empty">
                    No cases yet. Add one below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <form
            className="tf__add"
            onSubmit={(e) => {
              e.preventDefault();
              addCase(suite.id, draft);
              setDraft(EMPTY_DRAFT);
            }}
          >
            <h5 className="tf__add-head">Add a case</h5>
            <div className="tf__add-fields">
              <label className="tf__field">
                <span>Name</span>
                <input
                  required
                  value={draft.name}
                  placeholder="describes the behavior"
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </label>
              <label className="tf__field">
                <span>Steps</span>
                <input
                  value={draft.steps}
                  placeholder="what the run does"
                  onChange={(e) => setDraft((d) => ({ ...d, steps: e.target.value }))}
                />
              </label>
              <label className="tf__field">
                <span>Expected</span>
                <input
                  value={draft.expected}
                  placeholder="what should hold"
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, expected: e.target.value }))
                  }
                />
              </label>
            </div>
            <button type="submit" className="demo__btn">
              Add case
            </button>
          </form>
        </section>

        {/* ---- run ---- */}
        <section className="glass tf__panel tf__run" aria-label="Record a run">
          <h4 className="tf__panel-head">Record a run</h4>
          <p className="tf__run-lede">
            Mark each active case, or simulate a seeded run. Skipped cases are
            recorded as skips automatically.
          </p>
          <ul className="tf__marks">
            {activeCases.map((tc) => {
              const mark = marks[tc.id];
              return (
                <li key={tc.id} className="tf__mark">
                  <span className="tf__mark-name">{tc.name}</span>
                  <div
                    className="tf__mark-btns"
                    role="group"
                    aria-label={`Mark ${tc.name}`}
                  >
                    {(['pass', 'fail', 'skip'] as CaseStatus[]).map((st) => (
                      <button
                        key={st}
                        type="button"
                        className={`tf__mark-btn tf__mark-btn--${st} ${
                          mark === st ? 'tf__mark-btn--on' : ''
                        }`}
                        aria-pressed={mark === st}
                        onClick={() => setMark(tc.id, st)}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
            {activeCases.length === 0 && (
              <li className="tf__empty">No active cases to run.</li>
            )}
          </ul>

          <div className="tf__run-actions">
            <button
              type="button"
              className="demo__btn"
              onClick={doRecordManual}
              disabled={activeCases.length === 0}
            >
              Record marks
            </button>
            <button
              type="button"
              className="demo__btn demo__btn--ghost"
              onClick={doSimulate}
            >
              Simulate run
            </button>
          </div>

          {lastRunSummary && lastRun && (
            <div className="tf__run-summary" role="status">
              <span className="tf__run-summary-head">
                Run #{lastRun.seq} recorded
              </span>
              <span className="tf__run-summary-line">
                {lastRunSummary.passed} pass · {lastRunSummary.failed} fail ·{' '}
                {lastRunSummary.skipped} skip
              </span>
            </div>
          )}
        </section>

        {/* ---- insights ---- */}
        <section className="glass tf__panel tf__insights" aria-label="Insights">
          <h4 className="tf__panel-head">Insights</h4>

          <div className="tf__insight">
            <h5 className="tf__insight-head">Pass-rate trend</h5>
            {trend.length === 0 ? (
              <p className="tf__empty">No runs recorded.</p>
            ) : (
              <div
                className="tf__trend"
                role="img"
                aria-label={`Pass rate over ${trendCount} runs, latest ${pct(
                  trend[trend.length - 1].passRate,
                )}`}
              >
                {trend.map((p) => (
                  <div
                    key={p.runId}
                    className="tf__bar-wrap"
                    title={`#${p.seq}: ${pct(p.passRate)}`}
                  >
                    <div
                      className="tf__bar"
                      style={{ height: `${Math.round(p.passRate * 100)}%` }}
                    />
                    <span className="tf__bar-label">{p.seq}</span>
                  </div>
                ))}
              </div>
            )}
            <span className="tf__trend-note" aria-hidden="true">
              {trendCount} run{trendCount === 1 ? '' : 's'}, oldest left
            </span>
          </div>

          <div className="tf__insight">
            <h5 className="tf__insight-head">Flaky cases</h5>
            {flaky.length === 0 ? (
              <p className="tf__empty">No flaky cases in the recent window.</p>
            ) : (
              <ul className="tf__flaky">
                {flaky.map((f) => (
                  <li key={f.caseId} className="tf__flaky-row">
                    <span className="tf__flaky-name">{f.name}</span>
                    <span className="tf__flaky-count">
                      {f.passes} pass / {f.fails} fail
                    </span>
                    <span
                      className="tf__flips"
                      aria-label="flip history, oldest first"
                    >
                      {f.history.map((s, i) => (
                        <span
                          key={i}
                          className={`tf__flip tf__flip--${s}`}
                          title={s}
                        />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="tf__insight">
            <h5 className="tf__insight-head">Slowest cases</h5>
            {slow.length === 0 ? (
              <p className="tf__empty">No timing recorded.</p>
            ) : (
              <ol className="tf__slow">
                {slow.slice(0, 5).map((s) => (
                  <li key={s.caseId} className="tf__slow-row">
                    <span className="tf__slow-name">{s.name}</span>
                    <span className="tf__slow-ms">
                      {s.medianMs} ms median · {s.maxMs} ms max
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>

      <div className="demo__controls">
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={doReset}
        >
          Reset to seed
        </button>
        <span className="demo__hint">
          Clears stored suites, cases, and run history.
        </span>
      </div>
    </div>
  );
}
