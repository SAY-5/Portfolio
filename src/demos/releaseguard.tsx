import '../styles/demo.css';
import './releaseguard.css';
import { useStore } from './releaseguard/state';
import { evaluateReadiness } from './releaseguard/engine';
import {
  advance,
  reseed,
  resetAll,
  resetRamp,
  setErrorBudget,
  setGateBoolean,
  setGateCurrent,
  setGateRequired,
  setGateThreshold,
} from './releaseguard/store';
import type { CanaryState, CanaryStep, Gate } from './releaseguard/types';

// ReleaseGuard: an in-browser release-readiness gate. A set of gates (threshold
// or boolean) each carry a current value and a required condition. The pure
// engine evaluates every gate, vetoes the release if any required gate fails,
// and reports a weighted readiness score. The user tunes gate values and the
// GO / NO-GO banner updates live. All state is deterministic and persisted in
// localStorage; nothing here uses eval.

function unitSuffix(g: Gate): string {
  return g.kind === 'threshold' && g.unit === 'percent' ? '%' : '';
}

// Editor row for a single gate. Threshold gates expose two sliders (current
// and required); boolean gates expose a single toggle. Every gate exposes a
// required checkbox. Editing flows through the store actions, which persist and
// trigger a re-evaluation through the subscription.
function GateEditor({ gate }: { gate: Gate }) {
  return (
    <div className="rg2__edit glass">
      <div className="rg2__edit-head">
        <span className="rg2__edit-name">{gate.label}</span>
        <label className="rg2__bool">
          <input
            type="checkbox"
            checked={gate.required}
            onChange={(e) => setGateRequired(gate.id, e.target.checked)}
          />
          required
        </label>
      </div>

      {gate.kind === 'threshold' ? (
        <div className="rg2__fields">
          <div className="rg2__field">
            <span className="rg2__field-label" id={`${gate.id}-cur`}>
              current
              <span className="rg2__field-val">
                {gate.current}
                {unitSuffix(gate)}
              </span>
            </span>
            <input
              className="rg2__range"
              type="range"
              min={gate.min}
              max={gate.max}
              step={gate.step}
              value={gate.current}
              aria-labelledby={`${gate.id}-cur`}
              onChange={(e) =>
                setGateCurrent(gate.id, Number(e.target.value))
              }
            />
          </div>
          <div className="rg2__field">
            <span className="rg2__field-label" id={`${gate.id}-thr`}>
              required {gate.compare === 'atLeast' ? '≥' : '≤'}
              <span className="rg2__field-val">
                {gate.threshold}
                {unitSuffix(gate)}
              </span>
            </span>
            <input
              className="rg2__range"
              type="range"
              min={gate.min}
              max={gate.max}
              step={gate.step}
              value={gate.threshold}
              aria-labelledby={`${gate.id}-thr`}
              onChange={(e) =>
                setGateThreshold(gate.id, Number(e.target.value))
              }
            />
          </div>
        </div>
      ) : (
        <label className="rg2__bool">
          <input
            type="checkbox"
            checked={gate.current}
            onChange={(e) => setGateBoolean(gate.id, e.target.checked)}
          />
          {gate.current ? 'condition met' : 'condition not met'}
        </label>
      )}
    </div>
  );
}

// One-line explanation of the last canary step, so the operator sees why the
// ramp promoted, completed, or rolled back.
function stepMessage(step: CanaryStep | null): string {
  if (!step) return 'advance the ramp to evaluate the next stage';
  switch (step.kind) {
    case 'promote':
      return `under budget at ${step.from}%; promoted to ${step.to}% traffic`;
    case 'complete':
      return `under budget at ${step.at}%; rollout complete at full traffic`;
    case 'rollback':
      return `error rate ${step.errorRate}% exceeded the ${step.budget}% budget at ${step.at}%; rolled back`;
    case 'noop':
      return 'the ramp has finished; reset to run it again';
  }
}

// The canary ramp: stages from 1% to 100% traffic, each with a simulated error
// rate compared against the error budget. The active stage promotes when under
// budget and rolls the whole rollout back when over. The budget is tunable.
function Canary({
  canary,
  lastStep,
}: {
  canary: CanaryState;
  lastStep: CanaryStep | null;
}) {
  const done = canary.status === 'promoted' || canary.status === 'rolledback';
  const budgetMax = 20;

  function stageClass(index: number): string {
    const stage = canary.stages[index];
    if (canary.status === 'rolledback' && index === canary.stageIndex) {
      return ' rg2__stage--over';
    }
    if (index < canary.stageIndex) return ' rg2__stage--done';
    if (index === canary.stageIndex) {
      if (canary.status === 'promoted') return ' rg2__stage--done';
      return stage.errorRate > canary.errorBudget
        ? ' rg2__stage--over'
        : ' rg2__stage--active';
    }
    return ' rg2__stage--pending';
  }

  function stageState(index: number): string {
    if (canary.status === 'promoted' && index <= canary.stageIndex) {
      return 'cleared';
    }
    if (canary.status === 'rolledback' && index === canary.stageIndex) {
      return 'over budget';
    }
    if (index < canary.stageIndex) return 'cleared';
    if (index === canary.stageIndex) return 'observing';
    return 'pending';
  }

  return (
    <div className="rg2__canary glass">
      <div className="rg2__budget">
        <span className="rg2__budget-label" id="rg2-budget">
          error budget
          <span className="rg2__budget-val">{canary.errorBudget}%</span>
        </span>
        <input
          className="rg2__range"
          type="range"
          min={0}
          max={budgetMax}
          step={0.1}
          value={canary.errorBudget}
          aria-labelledby="rg2-budget"
          onChange={(e) => setErrorBudget(Number(e.target.value))}
        />
      </div>

      <ol className="rg2__stages" aria-label="canary ramp stages">
        {canary.stages.map((stage, i) => {
          const pct = Math.min(
            100,
            Math.round((stage.errorRate / budgetMax) * 100),
          );
          return (
            <li
              key={stage.percent}
              className={`rg2__stage${stageClass(i)}`}
            >
              <span className="rg2__stage-pct">{stage.percent}%</span>
              <span className="rg2__stage-err">err {stage.errorRate}%</span>
              <span
                className="rg2__stage-bar"
                role="img"
                aria-label={`error rate ${stage.errorRate} percent against ${canary.errorBudget} percent budget`}
              >
                <span
                  className="rg2__stage-fill"
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="rg2__stage-state">{stageState(i)}</span>
            </li>
          );
        })}
      </ol>

      <div className="rg2__ramp-status" role="status" aria-live="polite">
        <span
          className={`rg2__ramp-badge${
            canary.status === 'promoted'
              ? ' rg2__ramp-badge--promoted'
              : canary.status === 'rolledback'
                ? ' rg2__ramp-badge--rolledback'
                : ''
          }`}
        >
          {canary.status}
        </span>
        <span className="rg2__ramp-msg">{stepMessage(lastStep)}</span>
      </div>

      <div className="rg2__actions">
        <button
          className="demo__btn"
          onClick={advance}
          disabled={done}
        >
          Advance ramp
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={resetRamp}>
          Reset ramp
        </button>
      </div>
    </div>
  );
}

export default function ReleaseguardDemo() {
  const { gates, canary, lastStep } = useStore();
  const readiness = evaluateReadiness(gates);
  const go = readiness.decision === 'GO';

  return (
    <div className="demo" aria-label="releaseguard release readiness gate">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Is this release ready to ship?</h3>
      <p className="demo__lede">
        Each gate has a current value and a required condition. Any required
        gate that fails forces a NO-GO; the readiness score is the weighted
        share of passing gates. Tune the values below and the decision updates
        live.
      </p>

      <section
        className="rg2"
        aria-label="release gate checklist and decision"
      >
        <div
          className={`rg2__banner glass${go ? ' rg2__banner--go' : ' rg2__banner--nogo'}`}
          role="status"
          aria-live="polite"
        >
          <div className="rg2__decision">
            <span className="rg2__decision-label">Release decision</span>
            <strong className="rg2__decision-value">
              {readiness.decision}
            </strong>
          </div>
          <div className="rg2__score" aria-label="readiness score">
            <span className="rg2__score-num">{readiness.score}</span>
            <span className="rg2__score-unit">/ 100 ready</span>
            <span className="rg2__score-sub">
              {readiness.passCount} of {readiness.total} gates pass
            </span>
          </div>
        </div>

        <ul className="rg2__list" aria-label="gates">
          {readiness.results.map((r) => (
            <li
              key={r.id}
              className={`rg2__row glass${r.pass ? '' : ' rg2__row--fail'}`}
            >
              <div className="rg2__row-main">
                <span className="rg2__row-label">
                  {r.label}
                  {r.required && (
                    <span className="rg2__req" title="required gate">
                      required
                    </span>
                  )}
                </span>
                <span className="rg2__row-vals">
                  <span className="rg2__cur">{r.currentText}</span>
                  <span className="rg2__sep">vs</span>
                  <span className="rg2__req-val">{r.requiredText}</span>
                </span>
              </div>
              <span
                className={`rg2__chip${r.pass ? ' rg2__chip--pass' : ' rg2__chip--fail'}`}
              >
                {r.pass ? 'pass' : 'fail'}
              </span>
            </li>
          ))}
        </ul>

        <div className="rg2__subhead">
          <h4 className="rg2__subtitle">Tune the gates</h4>
          <span className="rg2__subhint">
            a failing required gate forces NO-GO
          </span>
        </div>
        <div className="rg2__editor" aria-label="gate editor">
          {gates.map((g) => (
            <GateEditor key={g.id} gate={g} />
          ))}
        </div>

        <div className="rg2__subhead">
          <h4 className="rg2__subtitle">Canary rollout</h4>
          <span className="rg2__subhint">
            advance while under the error budget, else roll back
          </span>
        </div>
        <Canary canary={canary} lastStep={lastStep} />

        <div className="rg2__actions">
          <button className="demo__btn demo__btn--ghost" onClick={reseed}>
            Re-seed release
          </button>
          <button className="demo__btn demo__btn--ghost" onClick={resetAll}>
            Reset all
          </button>
          <span className="demo__hint">
            {gates.length} gates · 4 ramp stages · deterministic, no eval
          </span>
        </div>
      </section>
    </div>
  );
}
