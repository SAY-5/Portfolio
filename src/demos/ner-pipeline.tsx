import { useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './ner-pipeline.css';

// Real numbers from the project: end-to-end CoNLL-2003 test F1 of 0.8794
// (precision 0.8719, recall 0.8870), per-type F1 from 0.7683 (MISC) to 0.9201
// (PER). Switching aggregation_strategy from "simple" to "first" recovers
// whole-word spans and moves overall F1 from 0.77 to 0.88 on the same data.
// Char offsets are returned into the original text, never WordPiece indices.
const F1_SIMPLE = 0.77;
const F1_FIRST = 0.88;
const PRECISION = 0.8719;
const RECALL = 0.887;

type EntType = 'PER' | 'ORG' | 'LOC' | 'MISC';

type Entity = {
  text: string; // whole-word span as it appears in the source text
  type: EntType;
  conf: number; // model confidence for the whole-word span
  start: number; // char offset into the source text
  // How "simple" aggregation fragments the span into WordPiece sub-tokens.
  // Each fragment carries the type but the span is broken, hurting F1.
  pieces: { text: string; conf: number }[];
};

// One fixed source sentence with hand-placed char offsets. Each entity shows
// both its recovered whole-word form ("first") and its fragmented form
// ("simple"), which is the comparison the toggle visualises.
const SOURCE =
  'Satya Nadella met Angela Merkel in Frankfurt to discuss the GraphQL spec at Microsoft.';

const entities: Entity[] = [
  {
    text: 'Satya Nadella',
    type: 'PER',
    conf: 0.992,
    start: 0,
    pieces: [
      { text: 'Sat', conf: 0.91 },
      { text: '##ya', conf: 0.74 },
      { text: 'Na', conf: 0.88 },
      { text: '##della', conf: 0.69 },
    ],
  },
  {
    text: 'Angela Merkel',
    type: 'PER',
    conf: 0.988,
    start: 18,
    pieces: [
      { text: 'Angela', conf: 0.95 },
      { text: 'Mer', conf: 0.86 },
      { text: '##kel', conf: 0.71 },
    ],
  },
  {
    text: 'Frankfurt',
    type: 'LOC',
    conf: 0.974,
    start: 35,
    pieces: [
      { text: 'Frank', conf: 0.9 },
      { text: '##furt', conf: 0.7 },
    ],
  },
  {
    text: 'GraphQL',
    type: 'MISC',
    conf: 0.831,
    start: 60,
    pieces: [
      { text: 'Graph', conf: 0.79 },
      { text: '##QL', conf: 0.64 },
    ],
  },
  {
    text: 'Microsoft',
    type: 'ORG',
    conf: 0.981,
    start: 76,
    pieces: [
      { text: 'Microsoft', conf: 0.98 },
    ],
  },
];

const typeColor: Record<EntType, string> = {
  PER: 'var(--accent)',
  ORG: '#4fd08a',
  LOC: '#5aa9ff',
  MISC: '#d98cff',
};

const ease = [0.22, 1, 0.36, 1] as const;

type Token =
  | { kind: 'text'; text: string }
  | { kind: 'entity'; ent: Entity };

// Build an ordered token stream over the source text so plain text and entity
// spans render in document order.
function buildTokens(): Token[] {
  const sorted = [...entities].sort((a, b) => a.start - b.start);
  const out: Token[] = [];
  let cursor = 0;
  for (const ent of sorted) {
    if (ent.start > cursor) {
      out.push({ kind: 'text', text: SOURCE.slice(cursor, ent.start) });
    }
    out.push({ kind: 'entity', ent });
    cursor = ent.start + ent.text.length;
  }
  if (cursor < SOURCE.length) {
    out.push({ kind: 'text', text: SOURCE.slice(cursor) });
  }
  return out;
}

export default function NerPipelineDemo() {
  const reduce = useReducedMotion();
  const [strategy, setStrategy] = useState<'simple' | 'first'>('first');
  const tokens = useMemo(buildTokens, []);

  const isFirst = strategy === 'first';
  const f1 = isFirst ? F1_FIRST : F1_SIMPLE;
  // "simple" fragments multi-piece spans, so it emits more, shorter entities.
  const spanCount = isFirst
    ? entities.length
    : entities.reduce((n, e) => n + e.pieces.length, 0);

  return (
    <div className="demo" aria-label="ner-pipeline entity extraction demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Whole-word spans, not WordPiece</h3>
      <p className="demo__lede">
        A transformer tags entities as PER, ORG, LOC, or MISC, then returns char
        offsets into the original text. Toggle aggregation_strategy: simple
        leaves spans fragmented at WordPiece boundaries, first stitches them back
        into whole words and lifts F1 from {F1_SIMPLE} to {F1_FIRST}.
      </p>

      <div className="np__toggle" role="group" aria-label="aggregation strategy">
        <button
          className={isFirst ? 'np__seg' : 'np__seg np__seg--on'}
          aria-pressed={!isFirst}
          onClick={() => setStrategy('simple')}
        >
          simple
        </button>
        <button
          className={isFirst ? 'np__seg np__seg--on' : 'np__seg'}
          aria-pressed={isFirst}
          onClick={() => setStrategy('first')}
        >
          first
        </button>
      </div>

      <div className="np__textbox" aria-label="tagged source text">
        <AnimatePresence mode="wait">
          <motion.p
            key={strategy}
            className="np__text"
            initial={{ opacity: reduce ? 1 : 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: reduce ? 1 : 0 }}
            transition={{ duration: reduce ? 0 : 0.25 }}
          >
            {tokens.map((tok, i) => {
              if (tok.kind === 'text') {
                return <span key={i}>{tok.text}</span>;
              }
              const ent = tok.ent;
              const color = typeColor[ent.type];
              if (isFirst) {
                return (
                  <span
                    key={i}
                    className="np__ent"
                    style={{
                      borderColor: color,
                      background: `color-mix(in srgb, ${color} 16%, transparent)`,
                    }}
                  >
                    {ent.text}
                    <span className="np__ent-tag" style={{ color }}>
                      {ent.type}
                    </span>
                  </span>
                );
              }
              // simple: render the fragmented WordPiece sub-spans.
              return (
                <span key={i} className="np__frag-group">
                  {ent.pieces.map((p, pi) => (
                    <span
                      key={pi}
                      className="np__frag"
                      style={{
                        borderColor: color,
                        background: `color-mix(in srgb, ${color} 12%, transparent)`,
                      }}
                    >
                      {p.text}
                    </span>
                  ))}
                </span>
              );
            })}
          </motion.p>
        </AnimatePresence>
      </div>

      <div className="np__lower">
        <div className="np__entities">
          <div className="np__entities-head">
            <span>{isFirst ? 'entities' : 'fragments'}</span>
            <span className="np__entities-count">{spanCount} spans</span>
          </div>
          <div className="np__entity-list">
            {entities.map((ent) => {
              const color = typeColor[ent.type];
              if (isFirst) {
                return (
                  <div className="np__erow" key={ent.text}>
                    <span
                      className="np__edot"
                      style={{ background: color }}
                      aria-hidden="true"
                    />
                    <span className="np__etext">{ent.text}</span>
                    <span className="np__etype" style={{ color }}>
                      {ent.type}
                    </span>
                    <span className="np__ecut">
                      [{ent.start}:{ent.start + ent.text.length}]
                    </span>
                    <span className="np__ebar" aria-hidden="true">
                      <motion.span
                        className="np__ebar-fill"
                        style={{ background: color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${ent.conf * 100}%` }}
                        transition={{ duration: reduce ? 0 : 0.5, ease }}
                      />
                    </span>
                    <span className="np__econf">{ent.conf.toFixed(2)}</span>
                  </div>
                );
              }
              return (
                <div className="np__erow np__erow--frag" key={ent.text}>
                  <span
                    className="np__edot"
                    style={{ background: color }}
                    aria-hidden="true"
                  />
                  <span className="np__etext np__etext--frag">
                    {ent.pieces.map((p) => p.text).join(' · ')}
                  </span>
                  <span className="np__etype" style={{ color }}>
                    {ent.type}
                  </span>
                  <span className="np__ecut np__ecut--warn">
                    {ent.pieces.length > 1
                      ? `${ent.pieces.length} pieces`
                      : 'whole'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="np__metrics">
          <div
            className={
              isFirst ? 'np__f1 np__f1--good' : 'np__f1 np__f1--low'
            }
          >
            <span className="np__f1-label">CoNLL-2003 F1</span>
            <span className="np__f1-val">{f1.toFixed(2)}</span>
            <span className="np__f1-meta">
              aggregation_strategy = {strategy}
            </span>
          </div>
          <div className="np__sub">
            <div className="np__sub-row">
              <span>precision</span>
              <b>{isFirst ? PRECISION.toFixed(4) : '-'}</b>
            </div>
            <div className="np__sub-row">
              <span>recall</span>
              <b>{isFirst ? RECALL.toFixed(4) : '-'}</b>
            </div>
            <div className="np__sub-row">
              <span>per-type F1</span>
              <b>{isFirst ? '0.768 to 0.920' : 'spans broken'}</b>
            </div>
          </div>
          <p className="np__note">
            {isFirst
              ? 'first stitches WordPiece sub-tokens back into whole-word spans and returns char offsets into the source.'
              : 'simple keeps sub-token boundaries, so multi-piece names split apart and span F1 drops.'}
          </p>
        </div>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={() => setStrategy(isFirst ? 'simple' : 'first')}
        >
          {isFirst ? 'Show simple' : 'Show first'}
        </button>
        <span className="demo__hint">
          {isFirst
            ? `${entities.length} whole-word spans, F1 ${F1_FIRST}`
            : `${spanCount} fragments, F1 ${F1_SIMPLE}`}
        </span>
      </div>
    </div>
  );
}
