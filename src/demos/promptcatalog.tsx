import { useMemo, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './promptcatalog.css';

// promptcatalog routes each prompt through a four-step precedence: a
// high-confidence rule, then the classifier above its floor, then a
// low-confidence rule tie-breaker, then an unknown fallback. The source label
// is recorded so consumers see which signal produced each category. A drift
// endpoint flags any category whose share grows by at least 0.2 absolute.
// The hybrid raises held-out accuracy from 0.909 to 0.955 over the classifier
// alone; the submit path benchmarks at ~9546 ns/op (~105k ops/sec).

const CLASSIFIER_FLOOR = 0.6;
const DRIFT_THRESHOLD = 0.2;

type Source = 'rule_high' | 'classifier' | 'rule_low' | 'fallback';

type Sample = {
  text: string;
  category: string;
  source: Source;
  ruleHigh: string | null; // high-confidence rule hit, if any
  ruleLow: string | null; // low-confidence rule hint, if any
  clfCategory: string; // classifier's top label
  clfConf: number; // classifier confidence
};

// Precomputed routing so each step is deterministic and explainable.
const samples: Sample[] = [
  {
    text: 'reset my password, the link expired',
    category: 'account',
    source: 'rule_high',
    ruleHigh: 'account',
    ruleLow: null,
    clfCategory: 'support',
    clfConf: 0.71,
  },
  {
    text: 'compare your enterprise and pro pricing tiers',
    category: 'sales',
    source: 'classifier',
    ruleHigh: null,
    ruleLow: null,
    clfCategory: 'sales',
    clfConf: 0.88,
  },
  {
    text: 'the dashboard chart is rendering blank',
    category: 'bug',
    source: 'classifier',
    ruleHigh: null,
    ruleLow: 'support',
    clfCategory: 'bug',
    clfConf: 0.74,
  },
  {
    text: 'can you add a dark mode toggle',
    category: 'feature',
    source: 'rule_low',
    ruleHigh: null,
    ruleLow: 'feature',
    clfCategory: 'feature',
    clfConf: 0.41,
  },
  {
    text: 'qty re: forwarded thread (no body)',
    category: 'unknown',
    source: 'fallback',
    ruleHigh: null,
    ruleLow: null,
    clfCategory: 'support',
    clfConf: 0.33,
  },
  {
    text: 'invoice for march is missing a line item',
    category: 'billing',
    source: 'rule_high',
    ruleHigh: 'billing',
    ruleLow: null,
    clfCategory: 'account',
    clfConf: 0.64,
  },
  {
    text: 'export all my data as csv please',
    category: 'feature',
    source: 'classifier',
    ruleHigh: null,
    ruleLow: null,
    clfCategory: 'feature',
    clfConf: 0.79,
  },
  {
    text: 'app crashes on the payment screen',
    category: 'bug',
    source: 'classifier',
    ruleHigh: null,
    ruleLow: 'support',
    clfCategory: 'bug',
    clfConf: 0.83,
  },
  {
    text: 'do you offer a nonprofit discount',
    category: 'sales',
    source: 'rule_low',
    ruleHigh: null,
    ruleLow: 'sales',
    clfCategory: 'sales',
    clfConf: 0.52,
  },
  {
    text: 'another payment screen freeze on submit',
    category: 'bug',
    source: 'classifier',
    ruleHigh: null,
    ruleLow: null,
    clfCategory: 'bug',
    clfConf: 0.9,
  },
];

const sourceLabel: Record<Source, string> = {
  rule_high: 'high-confidence rule',
  classifier: 'classifier above floor',
  rule_low: 'low-confidence rule',
  fallback: 'unknown fallback',
};

const steps: { key: Source; title: string; test: (s: Sample) => boolean }[] = [
  { key: 'rule_high', title: 'High-confidence rule', test: (s) => s.ruleHigh !== null },
  {
    key: 'classifier',
    title: `Classifier ≥ ${CLASSIFIER_FLOOR} floor`,
    test: (s) => s.ruleHigh === null && s.clfConf >= CLASSIFIER_FLOOR,
  },
  {
    key: 'rule_low',
    title: 'Low-confidence rule tie-breaker',
    test: (s) => s.ruleHigh === null && s.clfConf < CLASSIFIER_FLOOR && s.ruleLow !== null,
  },
  {
    key: 'fallback',
    title: 'Unknown fallback',
    test: (s) => s.ruleHigh === null && s.clfConf < CLASSIFIER_FLOOR && s.ruleLow === null,
  },
];

const BASELINE_SHARE: Record<string, number> = {
  account: 0.2,
  sales: 0.2,
  bug: 0.15,
  feature: 0.2,
  billing: 0.15,
  unknown: 0.1,
};

const allCats = ['account', 'sales', 'bug', 'feature', 'billing', 'unknown'];
const ease = [0.22, 1, 0.36, 1] as const;

export default function PromptcatalogDemo() {
  const reduce = useReducedMotion();
  const [routed, setRouted] = useState<Sample[]>([]);

  const current = routed.length < samples.length ? samples[routed.length] : null;

  const dist = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of allCats) counts[c] = 0;
    for (const r of routed) counts[r.category] += 1;
    const total = routed.length || 1;
    return allCats.map((c) => {
      const share = counts[c] / total;
      const grew = share - BASELINE_SHARE[c];
      return { cat: c, share, count: counts[c], surging: routed.length >= 4 && grew >= DRIFT_THRESHOLD };
    });
  }, [routed]);

  const surging = dist.filter((d) => d.surging);

  function routeNext() {
    if (!current) return;
    setRouted((prev) => [...prev, current]);
  }
  function reset() {
    setRouted([]);
  }

  // The active step for the prompt being routed (highlighted in the pipeline).
  const activeStepIdx = current ? steps.findIndex((st) => st.test(current)) : -1;

  return (
    <div className="demo" aria-label="promptcatalog routing demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Route a prompt by precedence</h3>
      <p className="demo__lede">
        Each prompt passes the rules layer and classifier, then the four-step
        precedence picks the winning signal and records its source. Route the
        queue and watch the category distribution shift; a category that gains
        at least {DRIFT_THRESHOLD} absolute share over baseline is flagged as
        surging.
      </p>

      <div className="pc__stage">
        <div className="pc__incoming">
          <div className="pc__incoming-head">
            {current ? 'Incoming prompt' : 'Queue drained'}
            <span className="pc__incoming-count">
              {routed.length} / {samples.length}
            </span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={current ? routed.length : 'empty'}
              className="pc__prompt"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduce ? 0 : -8 }}
              transition={{ duration: reduce ? 0 : 0.28, ease }}
            >
              {current ? `"${current.text}"` : 'All prompts classified and stored.'}
            </motion.div>
          </AnimatePresence>

          {current && (
            <div className="pc__signals">
              <div className="pc__signal">
                <span className="pc__signal-name">rules layer</span>
                <span className="pc__signal-val">
                  {current.ruleHigh
                    ? `high → ${current.ruleHigh}`
                    : current.ruleLow
                      ? `low → ${current.ruleLow}`
                      : 'no rule hit'}
                </span>
              </div>
              <div className="pc__signal">
                <span className="pc__signal-name">classifier</span>
                <span className="pc__signal-val">
                  {current.clfCategory} · {current.clfConf.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>

        <ol className="pc__pipeline">
          {steps.map((st, i) => {
            const isWinner = current !== null && i === activeStepIdx;
            const isSkipped = current !== null && i < activeStepIdx;
            return (
              <li
                key={st.key}
                className={`pc__step ${isWinner ? 'pc__step--win' : ''} ${isSkipped ? 'pc__step--skip' : ''}`}
              >
                <span className="pc__step-idx">{i + 1}</span>
                <span className="pc__step-title">{st.title}</span>
                {isWinner && (
                  <motion.span
                    className="pc__step-tag"
                    initial={{ opacity: 0, scale: reduce ? 1 : 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.25, ease }}
                  >
                    → {current!.category}
                  </motion.span>
                )}
                {isSkipped && <span className="pc__step-skip">skipped</span>}
              </li>
            );
          })}
        </ol>

        <div className="pc__dist">
          <div className="pc__dist-head">
            Category distribution
            <span className="pc__dist-meta">baseline vs current window</span>
          </div>
          <div className="pc__bars">
            {dist.map((d) => (
              <div key={d.cat} className={`pc__bar-row ${d.surging ? 'pc__bar-row--surge' : ''}`}>
                <span className="pc__bar-cat">{d.cat}</span>
                <div className="pc__bar-track">
                  <span className="pc__bar-base" style={{ left: `${BASELINE_SHARE[d.cat] * 100}%` }} aria-hidden />
                  <motion.span
                    className="pc__bar-fill"
                    animate={{ width: `${d.share * 100}%` }}
                    transition={{ duration: reduce ? 0 : 0.4, ease }}
                  />
                </div>
                <span className="pc__bar-pct">{(d.share * 100).toFixed(0)}%</span>
                {d.surging && <span className="pc__bar-flag">surging</span>}
              </div>
            ))}
          </div>
          <div className="pc__drift">
            {surging.length
              ? `drift: ${surging.map((s) => s.cat).join(', ')} grew ≥ ${DRIFT_THRESHOLD} absolute share`
              : `no drift: no category over +${DRIFT_THRESHOLD} share vs baseline`}
          </div>
        </div>

        {current && (
          <div className="pc__source">
            winning source:{' '}
            <b className={`pc__source--${current.source}`}>{sourceLabel[current.source]}</b>
            <span className="pc__source-note">
              {current.source === 'rule_high'
                ? 'a high-confidence rule overrides the classifier deterministically'
                : current.source === 'fallback'
                  ? 'classifier below floor and no rule hint, routed to unknown'
                  : 'recorded so downstream eval sees which signal won'}
            </span>
          </div>
        )}
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={routeNext} disabled={!current}>
          {current ? 'Route next prompt' : 'Queue drained'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={routed.length === 0}>
          Reset
        </button>
        <span className="demo__hint">
          hybrid lifts accuracy 0.909 → 0.955 · submit path ~9546 ns/op (~105k ops/sec)
        </span>
      </div>
    </div>
  );
}
