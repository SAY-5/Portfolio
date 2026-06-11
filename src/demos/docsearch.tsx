import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './docsearch.css';

// Real mechanism from the project: a Go query service ranks results with a
// hybrid of BM25 keyword scoring and dense vector scoring, plus a v3 synonym
// expansion reranker that expands query terms against a curated synonym map.
// Results stream over SSE as ranking proceeds. The numbers below are a small
// in-browser stand-in for that pipeline so the fusion is visible end to end.

type Doc = {
  id: string;
  title: string;
  // Term frequencies for the BM25 lane (keyword match).
  terms: Record<string, number>;
  // A tiny dense embedding for the vector lane (cosine similarity).
  vec: number[];
};

// Curated synonym map, as the v3 reranker would carry.
const SYNONYMS: Record<string, string[]> = {
  fast: ['quick', 'low-latency'],
  search: ['retrieval', 'lookup'],
  vector: ['embedding', 'dense'],
  rank: ['score', 'order'],
  index: ['shard', 'store'],
};

const QUERIES: Record<string, string[]> = {
  'fast search': ['fast', 'search'],
  'vector rank': ['vector', 'rank'],
  'index lookup': ['index', 'lookup'],
};

// Query embeddings, one per query, in the same space as the doc vectors.
const QUERY_VEC: Record<string, number[]> = {
  'fast search': [0.9, 0.2, 0.1, 0.3],
  'vector rank': [0.2, 0.9, 0.4, 0.1],
  'index lookup': [0.3, 0.1, 0.85, 0.4],
};

const CORPUS: Doc[] = [
  {
    id: 'd1',
    title: 'Low-latency retrieval over sharded indexes',
    terms: { fast: 3, search: 2, 'low-latency': 2, retrieval: 2, shard: 1 },
    vec: [0.85, 0.25, 0.35, 0.2],
  },
  {
    id: 'd2',
    title: 'Dense embedding rank fusion',
    terms: { vector: 3, embedding: 2, dense: 2, rank: 3, score: 1 },
    vec: [0.2, 0.92, 0.3, 0.15],
  },
  {
    id: 'd3',
    title: 'Quick lookup with an inverted store',
    terms: { quick: 2, lookup: 3, search: 1, store: 2, index: 2 },
    vec: [0.55, 0.2, 0.8, 0.35],
  },
  {
    id: 'd4',
    title: 'BM25 keyword scoring basics',
    terms: { search: 2, rank: 1, score: 2, keyword: 3 },
    vec: [0.4, 0.45, 0.3, 0.5],
  },
  {
    id: 'd5',
    title: 'Ordering shards by cumulative score',
    terms: { order: 2, shard: 2, score: 2, index: 1, rank: 1 },
    vec: [0.3, 0.5, 0.6, 0.25],
  },
];

const AVG_LEN = 9; // average document length for BM25 length normalization
const K1 = 1.4;
const B = 0.75;

function docLen(d: Doc) {
  return Object.values(d.terms).reduce((a, n) => a + n, 0);
}

// Simplified BM25 over the expanded query terms. Synonym hits count at a
// reduced weight, matching how an expansion reranker discounts expanded terms.
function bm25(d: Doc, queryTerms: string[], synTerms: string[]) {
  const len = docLen(d);
  let score = 0;
  let synContribution = 0;
  const scoreTerm = (term: string, weight: number) => {
    const tf = d.terms[term] ?? 0;
    if (tf === 0) return 0;
    // Inverse document frequency stand-in: rarer terms in this corpus weigh
    // more. We approximate with a fixed idf so the demo stays self-contained.
    const idf = 1.6;
    const norm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (len / AVG_LEN)));
    return weight * idf * norm;
  };
  for (const t of queryTerms) score += scoreTerm(t, 1);
  for (const t of synTerms) {
    const c = scoreTerm(t, 0.45);
    score += c;
    synContribution += c;
  }
  return { score, synContribution };
}

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function normalize(values: number[]) {
  const max = Math.max(...values, 1e-6);
  return values.map((v) => v / max);
}

type Ranked = {
  id: string;
  title: string;
  bm25: number;
  vec: number;
  syn: number;
  fused: number;
};

const ease = [0.22, 1, 0.36, 1] as const;

export default function DocSearchDemo() {
  const reduce = useReducedMotion();
  const [query, setQuery] = useState<keyof typeof QUERIES>('fast search');
  const [vecWeight, setVecWeight] = useState(0.5); // 0 = pure BM25, 1 = pure vector
  const [useSynonyms, setUseSynonyms] = useState(true);
  const [revealed, setRevealed] = useState(0); // how many results have streamed in
  const [streaming, setStreaming] = useState(false);
  const timer = useRef<number | null>(null);

  const queryTerms = QUERIES[query];
  const synTerms = useMemo(() => {
    if (!useSynonyms) return [] as string[];
    return queryTerms.flatMap((t) => SYNONYMS[t] ?? []);
  }, [query, useSynonyms, queryTerms]);

  // Run both lanes, normalize each to 0..1, then fuse with the weight slider.
  const ranked: Ranked[] = useMemo(() => {
    const raw = CORPUS.map((d) => {
      const { score, synContribution } = bm25(d, queryTerms, synTerms);
      const v = cosine(QUERY_VEC[query], d.vec);
      return { d, bm: score, syn: synContribution, v };
    });
    const bmNorm = normalize(raw.map((r) => r.bm));
    const vNorm = normalize(raw.map((r) => r.v));
    const out: Ranked[] = raw.map((r, i) => ({
      id: r.d.id,
      title: r.d.title,
      bm25: bmNorm[i],
      vec: vNorm[i],
      syn: r.bm > 0 ? r.syn / r.bm : 0,
      fused: bmNorm[i] * (1 - vecWeight) + vNorm[i] * vecWeight,
    }));
    out.sort((a, b) => b.fused - a.fused);
    return out;
  }, [query, vecWeight, synTerms, queryTerms]);

  const bm25Lane = useMemo(
    () => [...ranked].sort((a, b) => b.bm25 - a.bm25),
    [ranked]
  );
  const vecLane = useMemo(
    () => [...ranked].sort((a, b) => b.vec - a.vec),
    [ranked]
  );

  function stop() {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  }
  useEffect(() => stop, []);

  // Reset the stream whenever the query, weighting, or synonym toggle changes.
  useEffect(() => {
    stop();
    setStreaming(false);
    setRevealed(0);
  }, [query, vecWeight, useSynonyms]);

  function runSearch() {
    stop();
    setRevealed(0);
    if (reduce) {
      setRevealed(ranked.length);
      setStreaming(false);
      return;
    }
    setStreaming(true);
    timer.current = window.setInterval(() => {
      setRevealed((r) => {
        const next = r + 1;
        if (next >= ranked.length) {
          stop();
          setStreaming(false);
        }
        return Math.min(ranked.length, next);
      });
    }, 320);
  }

  return (
    <div className="demo" aria-label="docsearch hybrid ranking demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Hybrid ranking, lane by lane</h3>
      <p className="demo__lede">
        A query fans into two scoring lanes, BM25 keyword match and dense vector
        similarity, that merge into one hybrid rank. Turn on synonym expansion
        to light up expanded terms, slide the weighting between lanes, and run
        the search to watch ranked results stream in one at a time.
      </p>

      <div className="ds__stage">
        <div className="ds__queryrow">
          <div className="ds__queries" role="group" aria-label="example queries">
            {Object.keys(QUERIES).map((q) => (
              <button
                key={q}
                className={`ds__query${q === query ? ' ds__query--on' : ''}`}
                onClick={() => setQuery(q as keyof typeof QUERIES)}
                aria-pressed={q === query}
              >
                {q}
              </button>
            ))}
          </div>
          <label className="ds__toggle">
            <input
              type="checkbox"
              checked={useSynonyms}
              onChange={(e) => setUseSynonyms(e.target.checked)}
            />
            <span className="ds__toggle-track">
              <span className="ds__toggle-knob" />
            </span>
            Synonym expansion
          </label>
        </div>

        <div className="ds__expansion">
          <span className="ds__expansion-label">terms</span>
          {queryTerms.map((t) => (
            <span key={t} className="ds__term ds__term--query">
              {t}
            </span>
          ))}
          <AnimatePresence>
            {synTerms.map((t, i) => (
              <motion.span
                key={t}
                className="ds__term ds__term--syn"
                initial={{ opacity: 0, scale: reduce ? 1 : 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.25, delay: reduce ? 0 : i * 0.05, ease }}
              >
                + {t}
              </motion.span>
            ))}
          </AnimatePresence>
          {synTerms.length === 0 && (
            <span className="ds__term">no expansion</span>
          )}
        </div>

        <div className="ds__lanes">
          <div className="ds__lane ds__lane--bm25">
            <div className="ds__lane-head">
              <span className="ds__lane-dot" />
              <span className="ds__lane-name">BM25</span>
              <span className="ds__lane-sub">keyword score</span>
            </div>
            <ul className="ds__lane-list">
              {bm25Lane.slice(0, 4).map((r) => (
                <li key={r.id} className="ds__lane-item">
                  <span className="ds__lane-doc">{r.title}</span>
                  <span className="ds__lane-score">{r.bm25.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="ds__lane ds__lane--vec">
            <div className="ds__lane-head">
              <span className="ds__lane-dot" />
              <span className="ds__lane-name">Dense vector</span>
              <span className="ds__lane-sub">cosine similarity</span>
            </div>
            <ul className="ds__lane-list">
              {vecLane.slice(0, 4).map((r) => (
                <li key={r.id} className="ds__lane-item">
                  <span className="ds__lane-doc">{r.title}</span>
                  <span className="ds__lane-score">{r.vec.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="ds__weightrow">
          <label className="ds__weight-label" htmlFor="ds-weight">
            <span className="ds__w-bm25">BM25 {Math.round((1 - vecWeight) * 100)}%</span>
            <b>hybrid weighting</b>
            <span className="ds__w-vec">vector {Math.round(vecWeight * 100)}%</span>
          </label>
          <input
            id="ds-weight"
            className="ds__slider"
            type="range"
            min={0}
            max={100}
            value={Math.round(vecWeight * 100)}
            onChange={(e) => setVecWeight(Number(e.target.value) / 100)}
            aria-label="weighting between BM25 and vector lanes"
          />
        </div>

        <div className="ds__results">
          <div className="ds__results-head">
            <span>Hybrid rank (SSE)</span>
            <span className="ds__results-count">
              {revealed}/{ranked.length}
            </span>
          </div>
          {revealed === 0 ? (
            <div className="ds__results-empty">
              run the search to stream ranked results
            </div>
          ) : (
            <ul className="ds__results-list">
              <AnimatePresence initial={false}>
                {ranked.slice(0, revealed).map((r, i) => (
                  <motion.li
                    key={r.id}
                    className="ds__result"
                    layout={!reduce}
                    initial={{ opacity: 0, y: reduce ? 0 : 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: reduce ? 0 : 0.3, ease }}
                  >
                    <span className="ds__result-rank">{i + 1}</span>
                    <span className="ds__result-body">
                      <span className="ds__result-title">{r.title}</span>
                      <span className="ds__result-contrib">
                        <span className="ds__c-bm25">
                          bm25 <b>{r.bm25.toFixed(2)}</b>
                        </span>
                        <span className="ds__c-vec">
                          vec <b>{r.vec.toFixed(2)}</b>
                        </span>
                        {useSynonyms && r.syn > 0.01 && (
                          <span className="ds__c-syn">
                            syn <b>+{(r.syn * 100).toFixed(0)}%</b>
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="ds__result-score">{r.fused.toFixed(2)}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={runSearch} disabled={streaming}>
          {streaming ? 'Streaming...' : 'Run search'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => {
            stop();
            setStreaming(false);
            setRevealed(0);
          }}
          disabled={streaming}
        >
          Clear
        </button>
        <span className="demo__hint">
          {useSynonyms
            ? `${synTerms.length} synonym terms expanded`
            : 'synonym expansion off'}
        </span>
      </div>
    </div>
  );
}
