import { useCallback, useMemo, useState, type KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './learnloop.css';
import { SKILLS, bank, skillLabel, type Question, type Skill } from './learnloop/data';
import { useSession } from './learnloop/state';
import {
  nextQuestion,
  resetSession,
  skillSummaries,
  submitAnswer,
  type LogEntry,
} from './learnloop/store';
import {
  COOLDOWN,
  K,
  TARGET,
  bucketFor,
  bucketLabel,
  expectedSuccess,
  rank,
  scalePct,
  SCALE_MAX,
  SCALE_MIN,
} from './learnloop/engine';

// In-browser LearnLoop practice session. Pick a skill, answer the question the
// selector chose, and watch the Elo update slide your rating and the question
// difficulty markers on a shared scale. The selector always offers the item
// whose expected success is nearest the 70 percent desirable-difficulty target,
// skipping anything still in cooldown. Ratings, mastery, and the answer log
// persist in this browser and survive a reload.
const ease = [0.22, 1, 0.36, 1] as const;

type Graded = { entry: LogEntry; choice: number; correct: number };

export default function LearnloopDemo() {
  const session = useSession();
  const reduce = useReducedMotion();
  const [skill, setSkill] = useState<Skill>('algebra');
  // The last graded answer, held so the card can show feedback before advancing.
  const [graded, setGraded] = useState<Graded | null>(null);

  const rating = session.ratings[skill];

  // The selector's choice for this skill at the current rating. While a graded
  // answer is on screen we keep showing that question so the feedback lines up.
  const selected = useMemo(
    () => nextQuestion(skill, session),
    [skill, session],
  );
  const current: Question | undefined = graded
    ? bank.find((q) => q.id === graded.entry.questionId)
    : selected;

  const currentExpected = current ? expectedSuccess(rating, current.diff) : 0;

  // Rank the skill's pool so the rail can flag cooldown items and the next pick.
  const pool = useMemo(() => bank.filter((q) => q.skill === skill), [skill]);
  const ranked = useMemo(
    () => rank(pool, rating, session.recent),
    [pool, rating, session.recent],
  );
  const nextId = selected?.id;

  // Per-skill live readouts: rating, mastery bucket, and answered counts.
  const summaries = useMemo(() => skillSummaries(session), [session]);

  const onAnswer = useCallback(
    (choice: number) => {
      if (graded || !current) return;
      const entry = submitAnswer(current.id, choice);
      if (entry) setGraded({ entry, choice, correct: current.answer });
    },
    [graded, current],
  );

  const onNext = useCallback(() => setGraded(null), []);

  // Clear the persisted session and start over from the base rating.
  const onReset = useCallback(() => {
    setGraded(null);
    resetSession();
  }, []);

  function pickSkill(next: Skill) {
    setGraded(null);
    setSkill(next);
  }

  // Left/right arrow keys move between skill tabs, the expected tablist pattern.
  function onTabsKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const idx = SKILLS.findIndex((s) => s.id === skill);
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const nextIdx = (idx + step + SKILLS.length) % SKILLS.length;
    pickSkill(SKILLS[nextIdx].id);
  }

  return (
    <div className="demo" aria-label="LearnLoop adaptive practice session">
      <span className="demo__tag">Adaptive practice</span>
      <h3 className="demo__title">LearnLoop</h3>
      <p className="demo__lede">
        Answer the question the selector picked for you. Each answer runs an Elo
        update that slides your skill rating and the question difficulty markers,
        and the selector then offers the item whose expected success is nearest
        the 70 percent target. Your progress is saved in this browser.
      </p>

      <div
        className="lla__skills"
        role="tablist"
        aria-label="Skill to practice"
        onKeyDown={onTabsKey}
      >
        {SKILLS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`lla-tab-${s.id}`}
            aria-selected={skill === s.id}
            aria-controls="lla-panel"
            tabIndex={skill === s.id ? 0 : -1}
            className={`lla__skill ${skill === s.id ? 'lla__skill--on' : ''}`}
            onClick={() => pickSkill(s.id)}
          >
            {s.label}
            <span className="lla__skill-rating">{Math.round(session.ratings[s.id])}</span>
          </button>
        ))}
      </div>

      <div className="lla__stage">
        <Rail
          ranked={ranked}
          rating={rating}
          nextId={nextId}
          reduce={!!reduce}
        />

        <QuestionCard
          question={current}
          skill={skill}
          expected={currentExpected}
          graded={graded}
          onAnswer={onAnswer}
          onNext={onNext}
          reduce={!!reduce}
        />

        <Readouts
          summaries={summaries}
          activeSkill={skill}
          nextDiff={selected?.diff}
          nextExpected={selected ? expectedSuccess(rating, selected.diff) : null}
        />

        <SessionLog log={session.log} reduce={!!reduce} />
      </div>

      <div className="demo__controls">
        <button type="button" className="demo__btn demo__btn--ghost" onClick={onReset}>
          Reset session
        </button>
        <span className="demo__hint">
          K {K} · target {Math.round(TARGET * 100)}% · cooldown {COOLDOWN} ·{' '}
          {session.answered} answered
        </span>
      </div>
    </div>
  );
}

// ---------- the difficulty rail ----------

type RankedRow = ReturnType<typeof rank>[number];

function Rail({
  ranked,
  rating,
  nextId,
  reduce,
}: {
  ranked: RankedRow[];
  rating: number;
  nextId: string | undefined;
  reduce: boolean;
}) {
  return (
    <div
      className="lla__rail"
      role="img"
      aria-label={`Difficulty scale from ${SCALE_MIN} to ${SCALE_MAX}. Your rating is ${Math.round(
        rating,
      )}. Dots mark each question difficulty; the highlighted dot is the next item.`}
    >
      <div className="lla__rail-track" aria-hidden="true">
        {/* The 70 percent target band, drawn relative to the learner rating. */}
        {ranked.map((r) => {
          const isNext = r.q.id === nextId;
          return (
            <motion.span
              key={r.q.id}
              className={`lla__q ${isNext ? 'lla__q--next' : ''} ${
                r.onCooldown ? 'lla__q--cooldown' : ''
              }`}
              style={{ left: `${scalePct(r.q.diff)}%` }}
              animate={{ scale: isNext ? 1.25 : 1 }}
              transition={{ duration: reduce ? 0 : 0.3, ease }}
              title={`${r.q.diff} · ${Math.round(r.expected * 100)}% expected`}
            >
              <span className="lla__q-dot" aria-hidden="true" />
            </motion.span>
          );
        })}

        <motion.span
          className="lla__learner"
          animate={{ left: `${scalePct(rating)}%` }}
          transition={{ type: reduce ? false : 'spring', stiffness: 220, damping: 26 }}
          aria-hidden="true"
        >
          <span className="lla__learner-flag">you {Math.round(rating)}</span>
        </motion.span>
      </div>
      <div className="lla__rail-ends">
        <span>{SCALE_MIN}</span>
        <span>easier · harder</span>
        <span>{SCALE_MAX}</span>
      </div>
    </div>
  );
}

// ---------- live readouts ----------

function Readouts({
  summaries,
  activeSkill,
  nextDiff,
  nextExpected,
}: {
  summaries: ReturnType<typeof skillSummaries>;
  activeSkill: Skill;
  nextDiff: number | undefined;
  nextExpected: number | null;
}) {
  return (
    <div className="lla__readouts">
      <div className="lla__ratings glass">
        <div className="lla__panel-title">Per-skill rating and mastery</div>
        <ul className="lla__rating-list">
          {summaries.map((s) => (
            <li
              key={s.skill}
              className={`lla__rating-row ${
                s.skill === activeSkill ? 'lla__rating-row--on' : ''
              }`}
            >
              <span className="lla__rating-name">{skillLabel(s.skill)}</span>
              <span className="lla__rating-elo">{Math.round(s.rating)}</span>
              <span className={`lla__chip lla__chip--${s.bucket}`}>
                {bucketLabel(s.bucket)}
              </span>
              <span className="lla__rating-count">
                {s.correct}/{s.answered}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="lla__target glass">
        <div className="lla__panel-title">Selector target</div>
        {nextExpected === null || nextDiff === undefined ? (
          <p className="lla__card-empty">Pick a skill to see the next item.</p>
        ) : (
          <>
            <div className="lla__target-val">
              {Math.round(nextExpected * 100)}
              <span className="lla__target-unit">% expected</span>
            </div>
            <div className="lla__target-bar" aria-hidden="true">
              <span
                className="lla__target-fill"
                style={{ width: `${Math.round(nextExpected * 100)}%` }}
              />
              <span
                className="lla__target-mark"
                style={{ left: `${Math.round(TARGET * 100)}%` }}
              />
            </div>
            <div className="lla__target-meta">
              next item difficulty {nextDiff} · target {Math.round(TARGET * 100)}%
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- session log and progress ----------

function SessionLog({ log, reduce }: { log: LogEntry[]; reduce: boolean }) {
  if (log.length === 0) {
    return (
      <div className="lla__log glass">
        <div className="lla__panel-title">Session progress</div>
        <p className="lla__card-empty">
          No answers yet. The log is event sourced: each row records the rating
          before and after, and ratings are a fold over it.
        </p>
      </div>
    );
  }

  // Show the most recent answers. A mastery transition is flagged when an
  // answer's rating crosses a bucket boundary in either direction.
  const rows = log.slice(0, 8);

  return (
    <div className="lla__log glass">
      <div className="lla__panel-title">Session progress</div>
      <ol className="lla__log-list">
        {rows.map((e) => {
          const fromBucket = bucketFor(e.before);
          const toBucket = bucketFor(e.after);
          const moved = fromBucket !== toBucket;
          const delta = e.after - e.before;
          return (
            <motion.li
              key={e.n}
              className="lla__log-row"
              initial={{ opacity: reduce ? 1 : 0, x: reduce ? 0 : -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: reduce ? 0 : 0.25, ease }}
            >
              <span className="lla__log-n">#{e.n}</span>
              <span className={`lla__log-mark ${e.correct ? 'is-ok' : 'is-bad'}`}>
                {e.correct ? 'correct' : 'missed'}
              </span>
              <span className="lla__log-skill">{skillLabel(e.skill)}</span>
              <span className="lla__log-delta">
                {e.before}
                <span aria-hidden="true"> {'->'} </span>
                {e.after}
                <b>
                  {delta >= 0 ? ' +' : ' '}
                  {delta}
                </b>
              </span>
              {moved && (
                <span className="lla__log-transition">
                  {bucketLabel(toBucket)}
                </span>
              )}
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------- the question card ----------

function QuestionCard({
  question,
  skill,
  expected,
  graded,
  onAnswer,
  onNext,
  reduce,
}: {
  question: Question | undefined;
  skill: Skill;
  expected: number;
  graded: Graded | null;
  onAnswer: (choice: number) => void;
  onNext: () => void;
  reduce: boolean;
}) {
  if (!question) {
    return (
      <div
        className="lla__card glass"
        role="tabpanel"
        id="lla-panel"
        aria-labelledby={`lla-tab-${skill}`}
      >
        <p className="lla__card-empty">No questions available for this skill.</p>
      </div>
    );
  }

  const answeredChoice = graded?.choice ?? null;
  const correctIndex = question.answer;

  return (
    <motion.div
      className="lla__card glass"
      role="tabpanel"
      id="lla-panel"
      aria-labelledby={`lla-tab-${skill}`}
      key={question.id + (graded ? '-graded' : '')}
      initial={{ opacity: reduce ? 1 : 0, y: reduce ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.25, ease }}
    >
      <div className="lla__card-head">
        <span className="lla__card-skill">{skillLabel(skill)}</span>
        <span className="lla__card-meta">
          difficulty {question.diff} · {Math.round(expected * 100)}% expected
        </span>
      </div>

      <p className="lla__prompt">{question.prompt}</p>

      <div className="lla__options" role="group" aria-label="Answer choices">
        {question.options.map((opt, i) => {
          const isChosen = answeredChoice === i;
          const isCorrect = i === correctIndex;
          const state = graded
            ? isCorrect
              ? 'correct'
              : isChosen
                ? 'wrong'
                : 'muted'
            : '';
          return (
            <button
              key={i}
              type="button"
              className={`lla__option ${state ? `lla__option--${state}` : ''}`}
              onClick={() => onAnswer(i)}
              disabled={!!graded}
              aria-pressed={isChosen}
            >
              <span className="lla__option-key" aria-hidden="true">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="lla__option-text">{opt}</span>
            </button>
          );
        })}
      </div>

      <div className="lla__feedback" role="status" aria-live="polite">
        {graded ? (
          <>
            <span
              className={`lla__verdict ${graded.entry.correct ? 'is-ok' : 'is-bad'}`}
            >
              {graded.entry.correct ? 'Correct' : 'Not quite'}
            </span>
            <span className="lla__delta">
              {graded.entry.before}
              <span aria-hidden="true"> {'->'} </span>
              {graded.entry.after}
              <b>
                {graded.entry.after - graded.entry.before >= 0 ? ' +' : ' '}
                {graded.entry.after - graded.entry.before}
              </b>
            </span>
            <button type="button" className="demo__btn" onClick={onNext}>
              Next question
            </button>
          </>
        ) : (
          <span className="lla__hint-text">Choose the correct answer.</span>
        )}
      </div>
    </motion.div>
  );
}
