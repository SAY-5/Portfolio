import { useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './recommendation-quiz.css';

// Real project facts: 12-question quiz scores answers against a catalog of 30
// products with a weighted-attribute engine and returns the top three matches
// with a per-question contribution breakdown. Scoring is deterministic and
// rules-based (no machine-learned engine). The worked example domain is coffee.
// In-process bench: 144 rps, 5.93 ms p50, ~2.25 queries per request.

type AttrKey = 'roast' | 'body' | 'acidity' | 'sweetness';

type Product = {
  id: string;
  name: string;
  note: string;
  attrs: Record<AttrKey, number>; // each 0..3 on the catalog axis
};

// A trimmed, representative slice of the 30-product catalog.
const catalog: Product[] = [
  { id: 'p1', name: 'Midnight Drum', note: 'cocoa, walnut', attrs: { roast: 3, body: 3, acidity: 0, sweetness: 2 } },
  { id: 'p2', name: 'River Stone', note: 'plum, cane sugar', attrs: { roast: 2, body: 2, acidity: 1, sweetness: 3 } },
  { id: 'p3', name: 'Highland Bloom', note: 'jasmine, lemon', attrs: { roast: 0, body: 1, acidity: 3, sweetness: 1 } },
  { id: 'p4', name: 'Ember Field', note: 'toffee, fig', attrs: { roast: 2, body: 3, acidity: 1, sweetness: 2 } },
  { id: 'p5', name: 'Pale Current', note: 'green apple, tea', attrs: { roast: 1, body: 1, acidity: 3, sweetness: 1 } },
  { id: 'p6', name: 'Slow Harbor', note: 'caramel, almond', attrs: { roast: 1, body: 2, acidity: 1, sweetness: 3 } },
];

type Choice = { label: string; attr: AttrKey; target: number };

type Question = {
  id: string;
  prompt: string;
  weight: number; // how much this question moves the score
  choices: Choice[];
};

// Four of the twelve quiz questions, each mapping an answer onto a catalog axis.
const questions: Question[] = [
  {
    id: 'q1',
    prompt: 'How dark do you take it?',
    weight: 1.0,
    choices: [
      { label: 'Light', attr: 'roast', target: 0 },
      { label: 'Medium', attr: 'roast', target: 2 },
      { label: 'Dark', attr: 'roast', target: 3 },
    ],
  },
  {
    id: 'q2',
    prompt: 'Cup feel in the mouth?',
    weight: 0.9,
    choices: [
      { label: 'Light', attr: 'body', target: 1 },
      { label: 'Round', attr: 'body', target: 2 },
      { label: 'Heavy', attr: 'body', target: 3 },
    ],
  },
  {
    id: 'q3',
    prompt: 'Brightness you want?',
    weight: 0.8,
    choices: [
      { label: 'Mellow', attr: 'acidity', target: 0 },
      { label: 'Balanced', attr: 'acidity', target: 1 },
      { label: 'Vivid', attr: 'acidity', target: 3 },
    ],
  },
  {
    id: 'q4',
    prompt: 'How sweet should it read?',
    weight: 0.7,
    choices: [
      { label: 'Dry', attr: 'sweetness', target: 1 },
      { label: 'Soft', attr: 'sweetness', target: 2 },
      { label: 'Sweet', attr: 'sweetness', target: 3 },
    ],
  },
];

const MAX_AXIS = 3;
const ease = [0.22, 1, 0.36, 1] as const;

// A single answer contributes weight * (1 - distance/maxDistance) to each
// product, so a closer attribute match adds more to that product's score.
function contribution(choice: Choice, weight: number, p: Product): number {
  const dist = Math.abs(p.attrs[choice.attr] - choice.target);
  return weight * (1 - dist / MAX_AXIS);
}

type ScoreRow = { product: Product; total: number; parts: number[] };

export default function RecommendationQuizDemo() {
  const reduce = useReducedMotion();
  // answers[i] is the chosen choice index for question i, or -1 if unanswered.
  const [answers, setAnswers] = useState<number[]>(() => questions.map(() => -1));
  const [step, setStep] = useState(0);

  const answeredCount = answers.filter((a) => a >= 0).length;
  const done = answeredCount === questions.length;

  const scores: ScoreRow[] = useMemo(() => {
    const rows = catalog.map((product) => {
      const parts = questions.map((q, qi) => {
        const ci = answers[qi];
        if (ci < 0) return 0;
        return contribution(q.choices[ci], q.weight, product);
      });
      const total = parts.reduce((a, b) => a + b, 0);
      return { product, total, parts };
    });
    return rows.sort((a, b) => b.total - a.total);
  }, [answers]);

  const maxTotal = Math.max(0.001, ...scores.map((s) => s.total));
  const topThree = scores.slice(0, 3);

  function answer(choiceIdx: number) {
    setAnswers((prev) => {
      const next = [...prev];
      next[step] = choiceIdx;
      return next;
    });
    if (step < questions.length - 1) setStep((s) => s + 1);
  }

  function reset() {
    setAnswers(questions.map(() => -1));
    setStep(0);
  }

  const q = questions[step];
  const partColors = ['var(--accent)', 'var(--accent-soft)', '#4fd08a', '#6aa9ff'];

  return (
    <div className="demo" aria-label="recommendation quiz demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Score the catalog, answer by answer</h3>
      <p className="demo__lede">
        Step through the quiz. Each answer adds a weighted contribution to every
        product, stacking into per-product scores. The top three sort into place
        with the reason behind each match.
      </p>

      <div className="rq__stage">
        <div className="rq__quiz">
          <div className="rq__progress" aria-hidden="true">
            {questions.map((qq, i) => (
              <span
                key={qq.id}
                className={
                  'rq__dot' +
                  (i === step ? ' rq__dot--on' : '') +
                  (answers[i] >= 0 ? ' rq__dot--done' : '')
                }
              />
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={q.id}
              initial={{ opacity: 0, x: reduce ? 0 : 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: reduce ? 0 : -16 }}
              transition={{ duration: reduce ? 0 : 0.28, ease }}
            >
              <div className="rq__qmeta">
                question {step + 1} of {questions.length}
                <span className="rq__qweight">weight {q.weight.toFixed(1)}</span>
              </div>
              <p className="rq__prompt">{q.prompt}</p>
              <div className="rq__choices" role="group" aria-label={q.prompt}>
                {q.choices.map((c, ci) => (
                  <button
                    key={c.label}
                    className={
                      'rq__choice' + (answers[step] === ci ? ' rq__choice--on' : '')
                    }
                    aria-pressed={answers[step] === ci}
                    onClick={() => answer(ci)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="rq__qnav">
            <button
              className="demo__btn demo__btn--ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
            >
              Back
            </button>
            <button
              className="demo__btn demo__btn--ghost"
              onClick={() => setStep((s) => Math.min(questions.length - 1, s + 1))}
              disabled={step === questions.length - 1}
            >
              Next
            </button>
            <button className="demo__btn demo__btn--ghost" onClick={reset}>
              Reset
            </button>
          </div>
        </div>

        <div className="rq__scores" aria-label="live product scores">
          <div className="rq__scores-head">
            <span>Catalog score</span>
            <span className="rq__scores-meta">
              {answeredCount}/{questions.length} answered
            </span>
          </div>
          <div className="rq__rows">
            {scores.map((row, rank) => {
              const isTop = done && rank < 3;
              return (
                <motion.div
                  key={row.product.id}
                  layout={!reduce}
                  transition={{ duration: reduce ? 0 : 0.45, ease }}
                  className={'rq__row' + (isTop ? ' rq__row--top' : '')}
                >
                  {isTop && <span className="rq__rank">#{rank + 1}</span>}
                  <div className="rq__row-main">
                    <div className="rq__row-name">
                      {row.product.name}
                      <span className="rq__row-note">{row.product.note}</span>
                    </div>
                    <div
                      className="rq__bar"
                      role="img"
                      aria-label={`${row.product.name} score ${row.total.toFixed(2)}`}
                    >
                      {row.parts.map((part, pi) =>
                        part > 0 ? (
                          <motion.span
                            key={pi}
                            className="rq__seg"
                            style={{ background: partColors[pi % partColors.length] }}
                            initial={false}
                            animate={{ width: `${(part / maxTotal) * 100}%` }}
                            transition={{ duration: reduce ? 0 : 0.5, ease }}
                            title={`${questions[pi].prompt}: +${part.toFixed(2)}`}
                          />
                        ) : null
                      )}
                    </div>
                  </div>
                  <span className="rq__row-total">{row.total.toFixed(2)}</span>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {done && (
          <motion.div
            className="rq__verdict"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            <div className="rq__verdict-head">Top three matches</div>
            <div className="rq__verdict-grid">
              {topThree.map((row, i) => {
                const best = row.parts
                  .map((p, pi) => ({ p, pi }))
                  .sort((a, b) => b.p - a.p)[0];
                return (
                  <div key={row.product.id} className="rq__match">
                    <div className="rq__match-rank">#{i + 1}</div>
                    <div className="rq__match-name">{row.product.name}</div>
                    <div className="rq__match-reason">
                      led by {questions[best.pi].prompt.toLowerCase().replace(/\?$/, '')}
                      {' '}(+{best.p.toFixed(2)})
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="rq__verdict-text">
              Deterministic, rules-based scoring over 30 products. The bench
              measured 144 rps at 5.93 ms p50 with about 2.25 queries per
              request, one prefetched query instead of per-product fetches.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
