import { useState } from 'react';
import '../styles/demo.css';
import './recommendation-quiz.css';
import { useQuizStore } from './recommendation-quiz/state';
import {
  answer,
  back,
  clearAnswers,
  currentResult,
  finish,
  isComplete,
  next,
  outcomeDescription,
  quiz,
  restart,
  resetAll,
  resume,
  saveResult,
  setDescription,
} from './recommendation-quiz/store';
import { pct } from './recommendation-quiz/engine';
import type { State } from './recommendation-quiz/store';

// One question at a time: progress, the prompt, a radiogroup of options, and
// back/next/finish controls. The store owns answers and the current step.
function Taking({ state }: { state: State }) {
  const total = quiz.questions.length;
  const step = state.step;
  const question = quiz.questions[step];
  const chosen = state.answers[question.id];
  const answered = quiz.questions.filter((q) => Boolean(state.answers[q.id])).length;
  const remaining = total - answered;
  const complete = isComplete(state);

  return (
    <div className="rq__panel glass">
      <div className="rq__progress">
        <div className="rq__progress-track" aria-hidden="true">
          <div
            className="rq__progress-fill"
            style={{ width: `${((step + 1) / total) * 100}%` }}
          />
        </div>
        <p className="rq__progress-label">
          Question {step + 1} of {total}
          <span className="rq__remaining">
            {remaining === 0 ? 'all answered' : `${remaining} left`}
          </span>
        </p>
      </div>

      <h4 className="rq__prompt" id={`prompt-${question.id}`}>
        {question.prompt}
      </h4>
      {question.help && <p className="rq__help">{question.help}</p>}

      <div
        className="rq__options"
        role="radiogroup"
        aria-labelledby={`prompt-${question.id}`}
      >
        {question.options.map((option) => {
          const on = chosen === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={'rq__option' + (on ? ' rq__option--on' : '')}
              onClick={() => answer(question.id, option.id)}
            >
              <span className="rq__radio" aria-hidden="true" />
              <span className="rq__option-label">{option.label}</span>
            </button>
          );
        })}
      </div>

      <div className="rq__nav">
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={back}
          disabled={step === 0}
        >
          Back
        </button>
        {step < total - 1 ? (
          <button
            type="button"
            className="demo__btn"
            onClick={next}
            disabled={!chosen}
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            className="demo__btn"
            onClick={finish}
            disabled={!complete}
          >
            See recommendation
          </button>
        )}
        <button
          type="button"
          className="demo__btn demo__btn--ghost rq__nav-clear"
          onClick={clearAnswers}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

// The recommendation: primary outcome with match percent, runners-up, and the
// answers that drove the primary. The clock is snapshotted on save so the
// render path stays pure.
function Result({ state }: { state: State }) {
  const result = currentResult(state);
  const [saved, setSaved] = useState(false);
  if (!result.primary) return null;
  const primary = result.primary;

  function onSave() {
    saveResult(Date.now());
    setSaved(true);
  }

  return (
    <div className="rq__panel glass">
      <div className="rq__verdict">
        <span className="rq__verdict-tag">Top match</span>
        <div className="rq__verdict-head">
          <h4 className="rq__verdict-name">{primary.outcome.name}</h4>
          <span className="rq__verdict-pct">{pct(primary.match)}%</span>
        </div>
        <p className="rq__verdict-desc">
          {outcomeDescription(primary.outcome.id, state)}
        </p>
        <ul className="rq__tags">
          {primary.outcome.tags.map((t) => (
            <li key={t} className="rq__tag">
              {t}
            </li>
          ))}
        </ul>
      </div>

      {result.runnersUp.length > 0 && (
        <div className="rq__runners">
          <p className="rq__section-label">Runners-up</p>
          {result.runnersUp.map((row) => (
            <div key={row.outcome.id} className="rq__runner">
              <span className="rq__runner-name">{row.outcome.name}</span>
              <span className="rq__runner-bar" aria-hidden="true">
                <span style={{ width: `${pct(row.match)}%` }} />
              </span>
              <span className="rq__runner-pct">{pct(row.match)}%</span>
            </div>
          ))}
        </div>
      )}

      <div className="rq__why">
        <p className="rq__section-label">Why this match</p>
        {result.contributions.length === 0 ? (
          <p className="rq__why-empty">No answer pushed toward this outcome.</p>
        ) : (
          <ul className="rq__why-list">
            {result.contributions.map((c) => (
              <li key={c.questionId} className="rq__why-item">
                <span className="rq__why-prompt">{c.prompt}</span>
                <span className="rq__why-answer">{c.optionLabel}</span>
                <span className="rq__why-points">+{c.points}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rq__nav">
        <button type="button" className="demo__btn" onClick={restart}>
          Retake quiz
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={onSave}
          disabled={saved}
        >
          {saved ? 'Saved' : 'Save result'}
        </button>
      </div>
    </div>
  );
}

// Saved results plus a read-only view of the quiz definition with an editable
// outcome description, and a control that clears all persisted state.
function HistoryAndBuilder({ state }: { state: State }) {
  const [openOutcome, setOpenOutcome] = useState<string | null>(null);

  return (
    <div className="rq__side">
      <section className="rq__panel glass" aria-label="saved results">
        <p className="rq__section-label">History</p>
        {state.history.length === 0 ? (
          <p className="rq__history-empty">
            No saved results yet. Finish the quiz and save to build a history.
          </p>
        ) : (
          <ul className="rq__history">
            {state.history.map((h) => (
              <li key={h.id} className="rq__history-item">
                <span className="rq__history-name">{h.primaryName}</span>
                <span className="rq__history-pct">{pct(h.match)}%</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rq__panel glass" aria-label="quiz definition">
        <p className="rq__section-label">Quiz definition</p>
        <p className="rq__builder-note">
          {quiz.questions.length} questions scoring {quiz.outcomes.length}{' '}
          outcomes. Weights are read-only; outcome copy is editable.
        </p>

        <div className="rq__outcomes">
          {quiz.outcomes.map((o) => {
            const open = openOutcome === o.id;
            return (
              <div key={o.id} className="rq__outcome">
                <button
                  type="button"
                  className="rq__outcome-head"
                  aria-expanded={open}
                  onClick={() => setOpenOutcome(open ? null : o.id)}
                >
                  <span className="rq__outcome-name">{o.name}</span>
                  <span className="rq__outcome-toggle" aria-hidden="true">
                    {open ? '-' : '+'}
                  </span>
                </button>
                {open && (
                  <div className="rq__outcome-body">
                    <label className="rq__field-label" htmlFor={`desc-${o.id}`}>
                      Description
                    </label>
                    <textarea
                      id={`desc-${o.id}`}
                      className="rq__textarea"
                      rows={3}
                      value={outcomeDescription(o.id, state)}
                      onChange={(e) => setDescription(o.id, e.target.value)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <details className="rq__weights">
          <summary>View questions and weights</summary>
          <ul className="rq__weights-list">
            {quiz.questions.map((q) => (
              <li key={q.id} className="rq__weights-q">
                <span className="rq__weights-prompt">{q.prompt}</span>
                <ul>
                  {q.options.map((opt) => (
                    <li key={opt.id} className="rq__weights-opt">
                      <span>{opt.label}</span>
                      <span className="rq__weights-w">
                        {Object.entries(opt.weights)
                          .map(([k, v]) => `${k} +${v}`)
                          .join(', ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>

        <button
          type="button"
          className="demo__btn demo__btn--ghost rq__reset"
          onClick={resetAll}
        >
          Reset all saved data
        </button>
      </section>
    </div>
  );
}

export default function RecommendationQuizDemo() {
  const state = useQuizStore();
  const complete = isComplete(state);

  return (
    <div className="demo" aria-label="recommendation quiz demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">{quiz.title}</h3>
      <p className="demo__lede">{quiz.intro}</p>

      <div className="rq__stage">
        <div className="rq__main">
          {state.phase === 'taking' ? (
            <Taking state={state} />
          ) : (
            <Result state={state} />
          )}
          <button
            type="button"
            className="rq__phase-link"
            onClick={() => (state.phase === 'taking' ? finish() : resume())}
            disabled={state.phase === 'taking' && !complete}
          >
            {state.phase === 'taking'
              ? 'Skip to recommendation'
              : 'Back to questions'}
          </button>
        </div>
        <HistoryAndBuilder state={state} />
      </div>
    </div>
  );
}
