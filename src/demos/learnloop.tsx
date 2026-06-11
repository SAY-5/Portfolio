import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './learnloop.css';

// Real mechanism from the project. Every answer updates two Elo ratings:
//   expected = 1 / (1 + 10^((q_diff - learner_rating) / 400))
//   rating'  = rating + K * (actual - expected)
// The selector targets the desirable-difficulty sweet spot of 70 percent
// expected success and avoids recently-seen items via a cooldown.
const K = 32;
const TARGET = 0.7;
const COOLDOWN = 2;

function expectedSuccess(learner: number, qDiff: number) {
  return 1 / (1 + Math.pow(10, (qDiff - learner) / 400));
}

type Question = { id: string; label: string; diff: number };

// A small question bank spanning a difficulty range around the learner.
const BANK: Question[] = [
  { id: 'q1', label: 'two-step linear', diff: 1180 },
  { id: 'q2', label: 'factor quadratic', diff: 1290 },
  { id: 'q3', label: 'system of two', diff: 1350 },
  { id: 'q4', label: 'rational equation', diff: 1430 },
  { id: 'q5', label: 'log identity', diff: 1510 },
  { id: 'q6', label: 'nested radical', diff: 1600 },
];

type Bucket = 'novice' | 'developing' | 'proficient' | 'mastered';

// Mastery is bucketed from the rolling rating, mirroring the event-sourced log.
function bucketFor(rating: number): Bucket {
  if (rating < 1250) return 'novice';
  if (rating < 1400) return 'developing';
  if (rating < 1530) return 'proficient';
  return 'mastered';
}

// Map a rating onto the shared 1100-1650 scale used by the rail.
const SCALE_MIN = 1100;
const SCALE_MAX = 1650;
function pct(rating: number) {
  return ((rating - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
}

const START_RATING = 1300;
const ease = [0.22, 1, 0.36, 1] as const;

type LogRow = { n: number; q: string; correct: boolean; before: number; after: number };

export default function LearnloopDemo() {
  const reduce = useReducedMotion();
  const [rating, setRating] = useState(START_RATING);
  const [recent, setRecent] = useState<string[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [answered, setAnswered] = useState(0);

  // The selector: among items not in cooldown, pick the one whose expected
  // success is closest to the 70 percent target.
  const ranked = useMemo(() => {
    return BANK.map((q) => {
      const exp = expectedSuccess(rating, q.diff);
      const onCooldown = recent.includes(q.id);
      return { q, exp, onCooldown, dist: Math.abs(exp - TARGET) };
    }).sort((a, b) => a.dist - b.dist);
  }, [rating, recent]);

  const next = useMemo(() => {
    const eligible = ranked.filter((r) => !r.onCooldown);
    return (eligible[0] ?? ranked[0]).q;
  }, [ranked]);

  const nextExp = expectedSuccess(rating, next.diff);
  const bucket = bucketFor(rating);

  function answer(correct: boolean) {
    const q = next;
    const exp = expectedSuccess(rating, q.diff);
    const delta = K * ((correct ? 1 : 0) - exp);
    const after = Math.round(rating + delta);
    const n = answered + 1;

    setRating(after);
    setRecent((prev) => [q.id, ...prev].slice(0, COOLDOWN));
    setLog((prev) =>
      [{ n, q: q.label, correct, before: Math.round(rating), after }, ...prev].slice(0, 6),
    );
    setAnswered(n);
  }

  function reset() {
    setRating(START_RATING);
    setRecent([]);
    setLog([]);
    setAnswered(0);
  }

  return (
    <div className="demo" aria-label="LearnLoop adaptive practice demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Answer, adapt, repeat</h3>
      <p className="demo__lede">
        Each answer slides your skill rating and the question difficulty by an
        Elo update. The selector then picks the next question whose expected
        success lands nearest 70 percent, skipping anything still on cooldown.
        Answer right or wrong and watch the marker chase the target.
      </p>

      <div className="ll__stage">
        <div className="ll__rail" role="img" aria-label="difficulty rail">
          <div className="ll__rail-track">
            {BANK.map((q) => {
              const isNext = q.id === next.id;
              const onCd = recent.includes(q.id);
              return (
                <motion.span
                  key={q.id}
                  className={`ll__q ${isNext ? 'll__q--next' : ''} ${
                    onCd ? 'll__q--cooldown' : ''
                  }`}
                  style={{ left: `${pct(q.diff)}%` }}
                  animate={{ scale: isNext ? 1.15 : 1 }}
                  transition={{ duration: reduce ? 0 : 0.3, ease }}
                  title={`${q.label} (${q.diff})`}
                >
                  <span className="ll__q-dot" aria-hidden="true" />
                  <span className="ll__q-label">{q.label}</span>
                </motion.span>
              );
            })}

            <motion.span
              className="ll__learner"
              animate={{ left: `${pct(rating)}%` }}
              transition={{ type: reduce ? false : 'spring', stiffness: 220, damping: 26 }}
              aria-hidden="true"
            >
              <span className="ll__learner-flag">you</span>
            </motion.span>
          </div>
          <div className="ll__rail-ends">
            <span>{SCALE_MIN}</span>
            <span>easier · harder</span>
            <span>{SCALE_MAX}</span>
          </div>
        </div>

        <div className="ll__panel">
          <div className="ll__stat">
            <div className="ll__stat-name">skill rating</div>
            <div className="ll__stat-val">{Math.round(rating)}</div>
            <div className={`ll__bucket ll__bucket--${bucket}`}>{bucket}</div>
          </div>
          <div className="ll__stat">
            <div className="ll__stat-name">next question</div>
            <div className="ll__stat-q">{next.label}</div>
            <div className="ll__stat-meta">difficulty {next.diff}</div>
          </div>
          <div className="ll__stat ll__stat--target">
            <div className="ll__stat-name">expected success</div>
            <div className="ll__stat-val">{Math.round(nextExp * 100)}%</div>
            <div className="ll__stat-meta">target {Math.round(TARGET * 100)}%</div>
          </div>
        </div>

        <div className="ll__log" aria-live="polite">
          {log.length === 0 ? (
            <div className="ll__log-empty">No answers yet. The log is event sourced.</div>
          ) : (
            log.map((row) => (
              <motion.div
                key={row.n}
                className="ll__log-row"
                initial={{ opacity: 0, x: reduce ? 0 : -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: reduce ? 0 : 0.3, ease }}
              >
                <span className="ll__log-n">#{row.n}</span>
                <span className={`ll__log-mark ${row.correct ? 'is-ok' : 'is-bad'}`}>
                  {row.correct ? 'correct' : 'missed'}
                </span>
                <span className="ll__log-q">{row.q}</span>
                <span className="ll__log-delta">
                  {row.before}
                  <span aria-hidden="true"> {'->'} </span>
                  {row.after}
                  <b>
                    {row.after - row.before >= 0 ? ' +' : ' '}
                    {row.after - row.before}
                  </b>
                </span>
              </motion.div>
            ))
          )}
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn ll__btn-ok" onClick={() => answer(true)}>
          Answer correctly
        </button>
        <button className="demo__btn demo__btn--ghost ll__btn-bad" onClick={() => answer(false)}>
          Answer wrong
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">
          K {K} · cooldown {COOLDOWN} · {answered} answered
        </span>
      </div>
    </div>
  );
}
