import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './localebridge.css';

// Real facts from the project:
// - Extracts from three patterns: t() calls, <Trans> tags, and props with a
//   JSDoc @i18n annotation.
// - Validates each locale for ICU MessageFormat parse correctness, NFC
//   normalization, absence of bidi-control and zero-width attacks, and CLDR
//   plural-category coverage.
// - Default suite: en, es, fr, de, ja, ar (RTL), zh-CN, hi (multi-plural).

type Source = 't()' | '<Trans>' | '@i18n';

type StringRow = {
  id: string;
  line: number;
  source: Source;
  key: string;
  text: string;
  // plural keys carry a CLDR category set that some locales do not fully cover.
  plural?: boolean;
};

const rows: StringRow[] = [
  { id: 'r1', line: 7, source: 't()', key: 'cart.title', text: 'Your cart' },
  {
    id: 'r2',
    line: 12,
    source: '<Trans>',
    key: 'cart.items',
    text: '{count, plural, one {# item} other {# items}}',
    plural: true,
  },
  {
    id: 'r3',
    line: 18,
    source: '@i18n',
    key: 'checkout.cta',
    text: 'Checkout now',
  },
];

type Locale = {
  code: string;
  label: string;
  rtl?: boolean;
  // outcome of the validators on the plural row for this locale.
  plural: 'pass' | 'fail';
  pluralNote: string;
};

// hi and ar carry plural categories (one/two/few/many) that a naive
// translation can leave uncovered, so the CLDR coverage check flags them.
const locales: Locale[] = [
  { code: 'en', label: 'English', plural: 'pass', pluralNote: 'one, other' },
  { code: 'es', label: 'Spanish', plural: 'pass', pluralNote: 'one, other' },
  { code: 'fr', label: 'French', plural: 'pass', pluralNote: 'one, other' },
  { code: 'de', label: 'German', plural: 'pass', pluralNote: 'one, other' },
  { code: 'ja', label: 'Japanese', plural: 'pass', pluralNote: 'other only' },
  {
    code: 'ar',
    label: 'Arabic',
    rtl: true,
    plural: 'fail',
    pluralNote: 'missing few, many',
  },
  { code: 'zh-CN', label: 'Chinese', plural: 'pass', pluralNote: 'other only' },
  {
    code: 'hi',
    label: 'Hindi',
    plural: 'fail',
    pluralNote: 'missing one category',
  },
];

const checks = [
  'ICU MessageFormat parse',
  'NFC normalization',
  'No bidi-control / zero-width',
  'CLDR plural coverage',
];

const ease = [0.22, 1, 0.36, 1] as const;

type Phase = 'idle' | 'extract' | 'translate' | 'validate' | 'done';

export default function LocalebridgeDemo() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [lifted, setLifted] = useState<number>(0);
  const [validated, setValidated] = useState<number>(0);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }

  useEffect(() => clearTimers, []);

  function reset() {
    clearTimers();
    setPhase('idle');
    setLifted(0);
    setValidated(0);
  }

  function run() {
    clearTimers();
    setLifted(0);
    setValidated(0);

    if (reduce) {
      setPhase('done');
      setLifted(rows.length);
      setValidated(locales.length);
      return;
    }

    setPhase('extract');
    rows.forEach((_, i) => {
      timers.current.push(
        window.setTimeout(() => setLifted(i + 1), 350 + i * 320),
      );
    });

    timers.current.push(
      window.setTimeout(() => setPhase('translate'), 350 + rows.length * 320),
    );
    timers.current.push(
      window.setTimeout(
        () => setPhase('validate'),
        900 + rows.length * 320,
      ),
    );
    locales.forEach((_, i) => {
      timers.current.push(
        window.setTimeout(
          () => setValidated(i + 1),
          1100 + rows.length * 320 + i * 180,
        ),
      );
    });
    timers.current.push(
      window.setTimeout(
        () => setPhase('done'),
        1200 + rows.length * 320 + locales.length * 180,
      ),
    );
  }

  const running = phase !== 'idle' && phase !== 'done';
  const failing = locales.filter((l) => l.plural === 'fail').length;

  return (
    <div className="demo" aria-label="localebridge extraction and validation demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Lift strings, fan out, validate</h3>
      <p className="demo__lede">
        Run the pipeline to extract translatable strings from a React file,
        route them through translation, then fan into eight locales where ICU,
        Unicode, and CLDR plural checks turn each column green or red.
      </p>

      <div className="lb__stage">
        <div className="lb__source" aria-label="React source file">
          <div className="lb__file-head">
            <span className="lb__dot" />
            <span className="lb__dot" />
            <span className="lb__dot" />
            <span className="lb__filename">Cart.tsx</span>
          </div>
          <ol className="lb__code">
            {rows.map((r, i) => {
              const isLifted = lifted > i && phase !== 'idle';
              return (
                <li
                  key={r.id}
                  className={`lb__line${isLifted ? ' is-lifted' : ''}`}
                >
                  <span className="lb__ln" aria-hidden="true">
                    {r.line}
                  </span>
                  <span className="lb__src-badge">{r.source}</span>
                  <code className="lb__str">{r.text}</code>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="lb__pipe" aria-hidden="true">
          <motion.div
            className="lb__pipe-track"
            animate={{
              opacity:
                phase === 'translate' || phase === 'validate' || phase === 'done'
                  ? 1
                  : 0.25,
            }}
            transition={{ duration: 0.3 }}
          />
          <AnimatePresence>
            {(phase === 'translate' || phase === 'validate') && (
              <motion.span
                className="lb__pipe-label"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                translate + review
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <div className="lb__locales" role="list" aria-label="per-locale validation">
          {locales.map((l, i) => {
            const checked = validated > i && (phase === 'validate' || phase === 'done');
            const failed = checked && l.plural === 'fail';
            const state = !checked ? 'pending' : failed ? 'fail' : 'pass';
            return (
              <motion.div
                key={l.code}
                role="listitem"
                className={`lb__loc is-${state}${l.rtl ? ' is-rtl' : ''}`}
                initial={false}
                animate={{
                  scale: checked && !reduce ? [0.96, 1] : 1,
                }}
                transition={{ duration: 0.3, ease }}
              >
                <div className="lb__loc-head">
                  <span className="lb__loc-code">{l.code}</span>
                  {l.rtl && <span className="lb__loc-tag">RTL</span>}
                  <span className="lb__loc-mark" aria-hidden="true">
                    {state === 'pass' ? '✓' : state === 'fail' ? '✕' : ''}
                  </span>
                </div>
                <div className="lb__loc-label">{l.label}</div>
                <div className="lb__loc-note">
                  {state === 'pending'
                    ? 'queued'
                    : state === 'fail'
                      ? l.pluralNote
                      : 'all checks pass'}
                </div>
                <span className="lb__sr">
                  {l.label}: {state}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>

      <ul className="lb__checks" aria-label="validators run per locale">
        {checks.map((c, i) => {
          const lit = phase === 'validate' || phase === 'done';
          return (
            <li
              key={c}
              className={`lb__check${lit ? ' is-on' : ''}`}
              style={{ transitionDelay: reduce ? '0s' : `${i * 0.08}s` }}
            >
              {c}
            </li>
          );
        })}
      </ul>

      <AnimatePresence>
        {phase === 'done' && (
          <motion.div
            className="lb__verdict"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            <span className="lb__verdict-count">{failing} of {locales.length}</span>
            <span className="lb__verdict-text">
              locales fail CLDR plural coverage on the {`{count, plural}`} key.
              The PR diff comment blocks until ar and hi cover every required
              category.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Running…' : 'Run pipeline'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {rows.length} strings extracted, {locales.length} locales validated
        </span>
      </div>
    </div>
  );
}
