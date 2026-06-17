import { useState } from 'react';
import '../styles/demo.css';
import './agentflow.css';
import { useStore } from './agentflow/state';
import {
  addStep,
  moveStep,
  removeStep,
  resetAll,
  run,
  setSeed,
  updateStep,
} from './agentflow/store';
import type { Attempt } from './agentflow/types';

// Human label for an attempt outcome, shown on each trace row badge.
const OUTCOME_LABEL: Record<Attempt['outcome'], string> = {
  ok: 'ok',
  retry: 'retry',
  failed: 'failed',
};

// AgentFlow runs an ordered task pipeline in the browser. Each step is a plain
// unit of work (fetch, transform, validate, publish and the like) with a
// configurable chance of flaking, a retry budget, and an exponential backoff.
// The builder below edits that pipeline; the runner that executes it is fully
// deterministic, so the same pipeline and seed always produce the same trace.

export default function AgentflowDemo() {
  const state = useStore();
  // Snapshot the wall clock once, in render state, so handlers can mint ids
  // without reading the clock during a pure render.
  const [clock] = useState(() => Date.now());
  const { steps, seed } = state.workflow;
  const last = state.last;
  const history = state.history;

  return (
    <div className="demo">
      <span className="demo__tag">workflow runner</span>
      <h2 className="demo__title">AgentFlow</h2>
      <p className="demo__lede">
        Define an ordered task pipeline, then run it. Each step can flake; the
        runner retries with exponential backoff and either recovers or fails the
        run at that step. Runs are deterministic per seed.
      </p>

      <section className="af__builder glass" aria-labelledby="af-builder-h">
        <header className="af__builder-head">
          <h3 id="af-builder-h" className="af__h">
            Pipeline
          </h3>
          <button
            type="button"
            className="demo__btn demo__btn--ghost af__add"
            onClick={() => addStep(clock)}
          >
            + Add step
          </button>
        </header>

        <ol className="af__steps">
          {steps.map((step, i) => (
            <li key={step.id} className="af__step">
              <div className="af__step-bar">
                <span className="af__step-idx" aria-hidden="true">
                  {i + 1}
                </span>
                <label className="af__field af__field--name">
                  <span className="af__lbl">Name</span>
                  <input
                    className="af__input"
                    type="text"
                    value={step.name}
                    aria-label={`Step ${i + 1} name`}
                    onChange={(e) => updateStep(step.id, { name: e.target.value })}
                  />
                </label>
                <div
                  className="af__reorder"
                  role="group"
                  aria-label={`Reorder ${step.name}`}
                >
                  <button
                    type="button"
                    className="af__icon-btn"
                    onClick={() => moveStep(step.id, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${step.name} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="af__icon-btn"
                    onClick={() => moveStep(step.id, 1)}
                    disabled={i === steps.length - 1}
                    aria-label={`Move ${step.name} down`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="af__icon-btn af__icon-btn--rm"
                    onClick={() => removeStep(step.id)}
                    disabled={steps.length <= 1}
                    aria-label={`Remove ${step.name}`}
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="af__knobs">
                <label className="af__field">
                  <span className="af__lbl">
                    Failure rate <b>{Math.round(step.failureRate * 100)}%</b>
                  </span>
                  <input
                    className="af__range"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(step.failureRate * 100)}
                    aria-label={`${step.name} failure rate percent`}
                    onChange={(e) =>
                      updateStep(step.id, {
                        failureRate: Number(e.target.value) / 100,
                      })
                    }
                  />
                </label>

                <label className="af__field af__field--num">
                  <span className="af__lbl">Max retries</span>
                  <input
                    className="af__input af__input--num"
                    type="number"
                    min={0}
                    max={8}
                    value={step.maxRetries}
                    aria-label={`${step.name} max retries`}
                    onChange={(e) =>
                      updateStep(step.id, { maxRetries: Number(e.target.value) })
                    }
                  />
                </label>

                <label className="af__field af__field--num">
                  <span className="af__lbl">Backoff ms</span>
                  <input
                    className="af__input af__input--num"
                    type="number"
                    min={0}
                    max={5000}
                    step={20}
                    value={step.baseBackoffMs}
                    aria-label={`${step.name} base backoff milliseconds`}
                    onChange={(e) =>
                      updateStep(step.id, {
                        baseBackoffMs: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="demo__controls af__controls">
        <button
          type="button"
          className="demo__btn"
          onClick={() => run(clock)}
        >
          Run pipeline
        </button>
        <label className="af__seed">
          <span className="af__lbl">Seed</span>
          <input
            className="af__input af__input--num af__seed-input"
            type="number"
            min={0}
            max={999999}
            value={seed}
            aria-label="Run seed"
            onChange={(e) => setSeed(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={() => resetAll()}
        >
          Reset
        </button>
        <span className="demo__hint">
          {last
            ? `last run ${last.status} · ${last.totalMs} ms simulated`
            : 'not run yet · change the seed to flake different steps'}
        </span>
      </div>

      <section className="af__trace glass" aria-labelledby="af-trace-h">
        <header className="af__trace-head">
          <h3 id="af-trace-h" className="af__h">
            Trace
          </h3>
          {last && (
            <span
              className={`af__verdict-pill af__verdict-pill--${last.status}`}
            >
              run {last.status}
            </span>
          )}
        </header>

        {!last ? (
          <p className="af__trace-empty">
            Run the pipeline to see every attempt, retry, and backoff.
          </p>
        ) : (
          <ol className="af__attempts">
            {last.attempts.map((a, idx) => (
              <li
                key={`${a.stepId}-${a.attempt}-${idx}`}
                className={`af__attempt af__attempt--${a.outcome}`}
              >
                <span className="af__attempt-step">{a.stepName}</span>
                <span className="af__attempt-no">try {a.attempt}</span>
                <span className="af__attempt-dur">{a.durationMs} ms</span>
                <span className="af__attempt-back">
                  {a.backoffMs > 0 ? `backoff ${a.backoffMs} ms` : 'no backoff'}
                </span>
                <span
                  className={`af__attempt-badge af__attempt-badge--${a.outcome}`}
                >
                  {OUTCOME_LABEL[a.outcome]}
                </span>
              </li>
            ))}
          </ol>
        )}

        {last && (
          <p
            className={`af__result af__result--${last.status}`}
            role="status"
          >
            {last.status === 'ok'
              ? `All ${steps.length} steps completed in ${last.totalMs} ms of simulated work across ${last.attempts.length} attempts.`
              : `Run failed at step "${
                  steps.find((s) => s.id === last.failedStepId)?.name ??
                  last.failedStepId
                }" after exhausting its retries. ${last.attempts.length} attempts, ${last.totalMs} ms simulated.`}
          </p>
        )}
      </section>

      <section className="af__history glass" aria-labelledby="af-history-h">
        <header className="af__trace-head">
          <h3 id="af-history-h" className="af__h">
            Run history
          </h3>
          <span className="af__hist-count">{history.length}</span>
        </header>
        {history.length === 0 ? (
          <p className="af__trace-empty">No runs yet.</p>
        ) : (
          <ul className="af__hist-list">
            {history.map((r) => (
              <li
                key={r.id}
                className={`af__hist-row af__hist-row--${r.status}`}
              >
                <span
                  className={`af__hist-badge af__hist-badge--${r.status}`}
                >
                  {r.status}
                </span>
                <span className="af__hist-meta">seed {r.seed}</span>
                <span className="af__hist-meta">
                  {r.stepCount} steps · {r.attemptCount} attempts
                </span>
                <span className="af__hist-dur">{r.totalMs} ms</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
