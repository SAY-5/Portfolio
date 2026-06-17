// GovGate: a working compliance assessment that runs entirely in the browser.
// Walk a policy framework of weighted controls, mark each one met, partial, not
// met, or not applicable with a note, and the app scores a weighted compliance
// percent, gates it against a configurable threshold, breaks the result down by
// category, and produces a prioritized remediation list. The framework and the
// assessment live in localStorage; a pure, eval-free engine computes every
// number.

import '../styles/demo.css';
import './govgate.css';

import { useMemo, useState } from 'react';

import { useGovStore } from './govgate/state';
import {
  resetAssessment,
  setControlNote,
  setControlStatus,
  setThreshold,
} from './govgate/store';
import {
  exportSummary,
  groupByCategory,
  STATUS_LABEL,
  STATUS_ORDER,
  SEVERITY_LABEL,
} from './govgate/format';
import {
  categoryBreakdown,
  remediationList,
  resultFor,
  scoreAssessment,
  statusCounts,
} from './govgate/engine';
import type { Assessment, Framework } from './govgate/types';

export default function GovgateDemo() {
  const { framework, assessment } = useGovStore();
  const groups = groupByCategory(framework.controls);

  return (
    <div className="demo gg" aria-label="GovGate compliance assessment">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Assess a tool against a compliance framework</h3>
      <p className="demo__lede">
        Mark each control met, partial, not met, or not applicable and add a
        note. The engine scores a weighted compliance percent, gates it against
        your threshold, breaks it down by category, and lists the gaps to fix
        first. Everything persists in your browser.
      </p>

      <Scorecard framework={framework} assessment={assessment} />

      <section className="gg__controls" aria-label="Controls">
        {groups.map((group) => (
          <fieldset key={group.category} className="gg__group glass">
            <legend className="gg__group-legend">{group.category}</legend>
            <ul className="gg__list">
              {group.controls.map((control) => {
                const result = resultFor(assessment, control.id);
                return (
                  <li key={control.id} className="gg__control">
                    <div className="gg__control-head">
                      <span className="gg__control-title">{control.title}</span>
                      <span className={`gg__sev gg__sev--${control.severity}`}>
                        {SEVERITY_LABEL[control.severity]}
                      </span>
                      <span className="gg__weight" aria-label={`weight ${control.weight}`}>
                        w{control.weight}
                      </span>
                    </div>
                    <p className="gg__requirement">{control.requirement}</p>

                    <div className="gg__answer">
                      <div
                        className="gg__statusset"
                        role="radiogroup"
                        aria-label={`Status for ${control.title}`}
                      >
                        {STATUS_ORDER.map((status) => (
                          <button
                            key={status}
                            type="button"
                            role="radio"
                            aria-checked={result.status === status}
                            className={`gg__status gg__status--${status} ${
                              result.status === status ? 'is-on' : ''
                            }`}
                            onClick={() => setControlStatus(control.id, status)}
                          >
                            {STATUS_LABEL[status]}
                          </button>
                        ))}
                      </div>
                      <label className="gg__note-label">
                        <span className="gg__note-cap">Note</span>
                        <input
                          type="text"
                          className="gg__note"
                          value={result.note}
                          placeholder="Evidence or gap detail"
                          onChange={(e) =>
                            setControlNote(control.id, e.target.value)
                          }
                          aria-label={`Note for ${control.title}`}
                        />
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}
      </section>

      <Remediation framework={framework} assessment={assessment} />

      <div className="demo__controls">
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={resetAssessment}
        >
          Reset assessment
        </button>
        <span className="demo__hint">
          Reset clears your saved answers and restores the seed.
        </span>
      </div>
    </div>
  );
}

// The scorecard: the headline weighted compliance percent against the threshold
// with a pass or fail badge, a threshold slider, per-category bars, and a tally
// of controls by status. All numbers come from the pure engine.
function Scorecard({
  framework,
  assessment,
}: {
  framework: Framework;
  assessment: Assessment;
}) {
  const score = useMemo(
    () => scoreAssessment(framework, assessment),
    [framework, assessment],
  );
  const categories = useMemo(
    () => categoryBreakdown(framework, assessment),
    [framework, assessment],
  );
  const counts = useMemo(
    () => statusCounts(framework, assessment),
    [framework, assessment],
  );

  return (
    <section className="gg__scorecard glass" aria-label="Scorecard">
      <div className="gg__score">
        <div
          className="gg__score-num"
          role="meter"
          aria-valuenow={score.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Overall weighted compliance ${score.percent} percent`}
        >
          <span className="gg__score-pct" aria-hidden="true">
            {score.percent}
          </span>
          <span className="gg__score-unit" aria-hidden="true">
            %
          </span>
        </div>
        <div className="gg__score-meta">
          <span
            className={`gg__gate ${score.passed ? 'is-pass' : 'is-fail'}`}
            role="status"
            aria-live="polite"
          >
            {score.passed ? 'Pass' : 'Fail'}
          </span>
          <span className="gg__score-cap">
            Weighted compliance, {score.passed ? 'meets' : 'below'} the {score.threshold}% threshold.
          </span>
          <label className="gg__threshold">
            <span className="gg__threshold-cap">Pass threshold</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={score.threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              aria-label="Pass threshold percent"
            />
            <output className="gg__threshold-val">{score.threshold}%</output>
          </label>
        </div>
      </div>

      <ul className="gg__tally" aria-label="Control counts by status">
        {STATUS_ORDER.map((status) => (
          <li key={status} className={`gg__tally-item gg__tally--${status}`}>
            <span className="gg__tally-n">{counts[status]}</span>
            <span className="gg__tally-cap">{STATUS_LABEL[status]}</span>
          </li>
        ))}
        <li className="gg__tally-item gg__tally--total">
          <span className="gg__tally-n">{counts.total}</span>
          <span className="gg__tally-cap">Total</span>
        </li>
      </ul>

      <div className="gg__bars" aria-label="Compliance by category">
        {categories.map((cat) => (
          <div key={cat.category} className="gg__bar-row">
            <span className="gg__bar-name">{cat.category}</span>
            <span className="gg__bar-track">
              <span
                className="gg__bar-fill"
                style={{ width: `${cat.percent}%` }}
                role="meter"
                aria-valuenow={cat.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${cat.category} ${cat.percent}% compliant`}
              />
            </span>
            <span className="gg__bar-pct">{cat.percent}%</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// The remediation view: every not-met or partial control, highest priority
// first, with its severity and weight, plus a copyable text summary of the whole
// assessment. The list and the summary text both come from the pure engine.
function Remediation({
  framework,
  assessment,
}: {
  framework: Framework;
  assessment: Assessment;
}) {
  const items = useMemo(
    () => remediationList(framework, assessment),
    [framework, assessment],
  );
  const summary = useMemo(() => {
    const score = scoreAssessment(framework, assessment);
    const categories = categoryBreakdown(framework, assessment);
    return exportSummary(framework.name, score, categories, items);
  }, [framework, assessment, items]);

  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="gg__remediation glass" aria-label="Remediation">
      <div className="gg__rem-head">
        <h4 className="gg__rem-title">Remediation, highest priority first</h4>
        <span className="gg__rem-sub">
          {items.length === 0
            ? 'Nothing open'
            : `${items.length} open ${items.length === 1 ? 'control' : 'controls'}`}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="gg__rem-empty">
          Every applicable control is met. Nothing to remediate.
        </p>
      ) : (
        <ol className="gg__rem-list">
          {items.map((item) => (
            <li key={item.control.id} className="gg__rem-item">
              <span className="gg__rem-rank" aria-hidden="true">
                {item.priority}
              </span>
              <span className="gg__rem-body">
                <span className="gg__rem-name">{item.control.title}</span>
                <span className="gg__rem-cat">{item.control.category}</span>
                {item.note.trim() && (
                  <span className="gg__rem-note">{item.note.trim()}</span>
                )}
              </span>
              <span className="gg__rem-tags">
                <span className={`gg__sev gg__sev--${item.control.severity}`}>
                  {SEVERITY_LABEL[item.control.severity]}
                </span>
                <span className={`gg__status gg__status--${item.status} is-on`}>
                  {STATUS_LABEL[item.status]}
                </span>
                <span className="gg__weight">w{item.control.weight}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="gg__export">
        <div className="gg__export-bar">
          <span className="gg__export-cap">Exportable summary</span>
          <button type="button" className="demo__btn" onClick={copy}>
            {copied ? 'Copied' : 'Copy summary'}
          </button>
        </div>
        <pre className="gg__export-text" tabIndex={0} aria-label="Compliance summary text">
          {summary}
        </pre>
      </div>
    </section>
  );
}
