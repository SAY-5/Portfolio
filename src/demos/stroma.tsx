import { useMemo, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './stroma.css';

// Stroma fuses a dense vector arm with an FTS5 arm through a pluggable
// FusionStrategy; the default is Reciprocal Rank Fusion (RRF) with k = 60.
// RRF score for a doc = sum over arms of 1 / (k + rank). Per-arm provenance is
// kept so a downstream reranker can see which arm contributed.
const RRF_K = 60;

type Arm = { doc: string; rank: number }[];
type Scenario = {
  id: string;
  query: string;
  vec: Arm;
  fts: Arm;
};

// Two query scenarios, each with the per-arm ranked lists the two retrievers
// return. Document labels are illustrative section ids.
const SCENARIOS: Scenario[] = [
  {
    id: 'a',
    query: 'how does atomic index rebuild work',
    vec: [
      { doc: 'rebuild.go#atomicSwap', rank: 1 },
      { doc: 'index.md#snapshot', rank: 2 },
      { doc: 'store.go#openSqlite', rank: 3 },
      { doc: 'chunk.go#section', rank: 4 },
    ],
    fts: [
      { doc: 'index.md#snapshot', rank: 1 },
      { doc: 'rebuild.go#atomicSwap', rank: 2 },
      { doc: 'README#rebuilds', rank: 3 },
      { doc: 'store.go#openSqlite', rank: 4 },
    ],
  },
  {
    id: 'b',
    query: 'retry on rate limit with Retry-After',
    vec: [
      { doc: 'http.go#backoff', rank: 1 },
      { doc: 'failure.go#classify', rank: 2 },
      { doc: 'http.go#retryAfter', rank: 3 },
      { doc: 'embed.go#callModel', rank: 4 },
    ],
    fts: [
      { doc: 'http.go#retryAfter', rank: 1 },
      { doc: 'http.go#backoff', rank: 2 },
      { doc: 'failure.go#classify', rank: 3 },
      { doc: 'taxonomy.md#rate_limit', rank: 4 },
    ],
  },
];

type Fused = {
  doc: string;
  score: number;
  vecRank: number | null;
  ftsRank: number | null;
};

function fuse(s: Scenario): Fused[] {
  const map = new Map<string, Fused>();
  const add = (doc: string, rank: number, arm: 'vec' | 'fts') => {
    const cur =
      map.get(doc) ??
      ({ doc, score: 0, vecRank: null, ftsRank: null } as Fused);
    cur.score += 1 / (RRF_K + rank);
    if (arm === 'vec') cur.vecRank = rank;
    else cur.ftsRank = rank;
    map.set(doc, cur);
  };
  for (const r of s.vec) add(r.doc, r.rank, 'vec');
  for (const r of s.fts) add(r.doc, r.rank, 'fts');
  return [...map.values()].sort((a, b) => b.score - a.score).slice(0, 5);
}

type Quant = {
  id: string;
  name: string;
  factor: number; // size relative to float32 (1 = full)
  note: string;
};

// Quantization knobs as documented: float32 default, int8 (4x smaller),
// binary 1-bit prefilter (32x smaller prefilter), with full-precision cosine
// rescoring on top of the cheaper prefilter.
const QUANTS: Quant[] = [
  {
    id: 'f32',
    name: 'float32',
    factor: 1,
    note: 'Full-precision vectors. The default, and the rescoring reference.',
  },
  {
    id: 'int8',
    name: 'int8',
    factor: 1 / 4,
    note: '4x smaller. Quantized vectors with full-precision cosine rescore on the survivors.',
  },
  {
    id: 'bin',
    name: 'binary 1-bit',
    factor: 1 / 32,
    note: '32x smaller prefilter. A 1-bit prefilter narrows the candidate set, then full-precision cosine rescores.',
  },
];

const ease = [0.22, 1, 0.36, 1] as const;
const BASE_MB = 320; // illustrative float32 footprint for the size bars

export default function StromaDemo() {
  const reduce = useReducedMotion();
  const [scenarioId, setScenarioId] = useState('a');
  const [quantId, setQuantId] = useState('f32');

  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const fused = useMemo(() => fuse(scenario), [scenario]);
  const quant = QUANTS.find((q) => q.id === quantId)!;

  const sizeMb = BASE_MB * quant.factor;
  const widthPct = quant.factor * 100;
  const shrink = Math.round(1 / quant.factor);

  return (
    <div className="demo" aria-label="Stroma hybrid retrieval demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Hybrid retrieval, fused by rank</h3>
      <p className="demo__lede">
        A query runs down two arms at once: a dense vector search and an FTS5
        keyword search. Their ranked lists fuse through Reciprocal Rank Fusion
        with k = {RRF_K}, keeping per-arm provenance. Switch queries to watch
        the fused order shift, then change quantization to shrink the index.
      </p>

      <div className="st__stage">
        <div className="st__query">
          <span className="st__query-label">query</span>
          <span className="st__query-text">{scenario.query}</span>
          <div
            className="st__query-pick"
            role="group"
            aria-label="Choose query"
          >
            {SCENARIOS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={`st__query-btn ${s.id === scenarioId ? 'st__query-btn--on' : ''}`}
                aria-pressed={s.id === scenarioId}
                onClick={() => setScenarioId(s.id)}
              >
                query {i + 1}
              </button>
            ))}
          </div>
        </div>

        <div className="st__arms">
          <div className="st__arm st__arm--vec">
            <div className="st__arm-head">
              <span className="st__arm-name">vector arm</span>
              <span className="st__arm-sub">dense cosine</span>
            </div>
            {scenario.vec.map((r) => (
              <div key={r.doc} className="st__row">
                <span className="st__row-rank">#{r.rank}</span>
                <span className="st__row-doc">{r.doc}</span>
                <span className="st__row-score">1/{RRF_K + r.rank}</span>
              </div>
            ))}
          </div>

          <div className="st__arm st__arm--fts">
            <div className="st__arm-head">
              <span className="st__arm-name">FTS5 arm</span>
              <span className="st__arm-sub">keyword bm25</span>
            </div>
            {scenario.fts.map((r) => (
              <div key={r.doc} className="st__row">
                <span className="st__row-rank">#{r.rank}</span>
                <span className="st__row-doc">{r.doc}</span>
                <span className="st__row-score">1/{RRF_K + r.rank}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="st__fuse">
          <div className="st__fuse-head">
            <span className="st__fuse-name">RRF fused result</span>
            <span className="st__fuse-formula">
              score = sum of 1 / (k + rank)
            </span>
          </div>
          <div className="st__fuse-list">
            <AnimatePresence initial={false}>
              {fused.map((f, i) => (
                <motion.div
                  key={`${scenarioId}-${f.doc}`}
                  layout={!reduce}
                  className={`st__frow ${i === 0 ? 'st__frow--top' : ''}`}
                  initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{
                    duration: reduce ? 0 : 0.3,
                    delay: reduce ? 0 : i * 0.05,
                    ease,
                  }}
                >
                  <span className="st__frow-rank">#{i + 1}</span>
                  <span className="st__frow-doc">{f.doc}</span>
                  <span className="st__frow-prov">
                    {f.vecRank !== null && (
                      <span className="st__prov st__prov--vec">
                        vec #{f.vecRank}
                      </span>
                    )}
                    {f.ftsRank !== null && (
                      <span className="st__prov st__prov--fts">
                        fts #{f.ftsRank}
                      </span>
                    )}
                  </span>
                  <span className="st__frow-score">{f.score.toFixed(4)}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        <div className="st__quant">
          <div className="st__quant-head">index footprint by quantization</div>
          <div
            className="st__quant-tabs"
            role="group"
            aria-label="Choose quantization mode"
          >
            {QUANTS.map((q) => (
              <button
                key={q.id}
                type="button"
                className={`st__quant-tab ${q.id === quantId ? 'st__quant-tab--on' : ''}`}
                aria-pressed={q.id === quantId}
                onClick={() => setQuantId(q.id)}
              >
                {q.name}
              </button>
            ))}
          </div>

          <div className="st__bar-track">
            <motion.div
              className="st__bar-fill"
              animate={{ width: `${widthPct}%` }}
              initial={false}
              transition={{ duration: reduce ? 0 : 0.45, ease }}
            />
          </div>
          <div className="st__bar-meta">
            <span>
              <b>{sizeMb < 10 ? sizeMb.toFixed(1) : Math.round(sizeMb)} MB</b>{' '}
              vs {BASE_MB} MB float32
            </span>
            <span>{shrink === 1 ? 'baseline' : `${shrink}x smaller`}</span>
          </div>
          <p className="st__quant-note">{quant.note}</p>
        </div>
      </div>

      <div className="demo__controls">
        <span className="demo__hint">
          per-arm provenance carried through fusion for downstream rerankers
        </span>
      </div>
    </div>
  );
}
