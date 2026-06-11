import { useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './doc-index-service.css';

// Real numbers from the project: each query runs a BM25 keyword retriever
// (ts_rank_cd) and a 384-d HNSW cosine vector retriever in parallel, then fuses
// the two ranked lists with reciprocal rank fusion at k=60. RRF is chosen over
// weighted sums because BM25 and cosine live on different scales. Latencies over
// 100,000 docs and 1000 queries: vector p50 2.8 ms, keyword p50 157 ms,
// hybrid p50 171.1 ms.
const RRF_K = 60;
const KEYWORD_P50 = 157;
const VECTOR_P50 = 2.8;
const HYBRID_P50 = 171.1;

type Chunk = {
  id: string;
  doc: string;
  keywordRank: number | null; // 1-based rank in the keyword list, null if absent
  vectorRank: number | null; // 1-based rank in the vector list, null if absent
};

// Two query scenarios, each with its own keyword/vector rankings, so toggling
// the query visibly re-fuses the lists differently.
const scenarios: Record<string, { label: string; chunks: Chunk[] }> = {
  rollback: {
    label: 'how do I roll back a migration',
    chunks: [
      { id: 'c12', doc: 'migrations.md', keywordRank: 1, vectorRank: 3 },
      { id: 'c47', doc: 'cli-reference.md', keywordRank: 2, vectorRank: null },
      { id: 'c08', doc: 'undo-changes.md', keywordRank: null, vectorRank: 1 },
      { id: 'c33', doc: 'schema-versioning.md', keywordRank: 4, vectorRank: 2 },
      { id: 'c21', doc: 'troubleshooting.md', keywordRank: 3, vectorRank: 5 },
      { id: 'c55', doc: 'recovery-guide.md', keywordRank: null, vectorRank: 4 },
    ],
  },
  auth: {
    label: 'rotate an expired api token',
    chunks: [
      { id: 'a04', doc: 'auth-tokens.md', keywordRank: 2, vectorRank: 1 },
      { id: 'a19', doc: 'rotation-policy.md', keywordRank: 1, vectorRank: 4 },
      { id: 'a31', doc: 'expiry-and-renewal.md', keywordRank: null, vectorRank: 2 },
      { id: 'a08', doc: 'cli-reference.md', keywordRank: 3, vectorRank: null },
      { id: 'a22', doc: 'security-faq.md', keywordRank: 4, vectorRank: 3 },
      { id: 'a40', doc: 'service-accounts.md', keywordRank: null, vectorRank: 5 },
    ],
  },
};

const ease = [0.22, 1, 0.36, 1] as const;

function rrf(rank: number | null) {
  return rank === null ? 0 : 1 / (RRF_K + rank);
}

export default function DocIndexServiceDemo() {
  const reduce = useReducedMotion();
  const [scenarioKey, setScenarioKey] = useState<keyof typeof scenarios>(
    'rollback',
  );
  const [fused, setFused] = useState(false);

  const scenario = scenarios[scenarioKey];

  const keywordList = useMemo(
    () =>
      scenario.chunks
        .filter((c) => c.keywordRank !== null)
        .sort((a, b) => (a.keywordRank! - b.keywordRank!)),
    [scenario],
  );
  const vectorList = useMemo(
    () =>
      scenario.chunks
        .filter((c) => c.vectorRank !== null)
        .sort((a, b) => (a.vectorRank! - b.vectorRank!)),
    [scenario],
  );

  const fusedList = useMemo(() => {
    return scenario.chunks
      .map((c) => ({
        ...c,
        kScore: rrf(c.keywordRank),
        vScore: rrf(c.vectorRank),
        score: rrf(c.keywordRank) + rrf(c.vectorRank),
      }))
      .sort((a, b) => b.score - a.score);
  }, [scenario]);

  function pickScenario(key: keyof typeof scenarios) {
    setScenarioKey(key);
    setFused(false);
  }

  return (
    <div className="demo" aria-label="doc-index-service hybrid retrieval demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Two retrievers, one fused list</h3>
      <p className="demo__lede">
        A query fans out to a BM25 keyword retriever and a 384-d cosine vector
        retriever in parallel. Reciprocal rank fusion at k={RRF_K} merges the two
        ranked lists into one, chosen over a weighted sum because keyword and
        cosine scores live on different scales.
      </p>

      <div className="dx__queries" role="group" aria-label="pick a query">
        {(Object.keys(scenarios) as (keyof typeof scenarios)[]).map((key) => (
          <button
            key={key}
            className={
              key === scenarioKey ? 'dx__query dx__query--on' : 'dx__query'
            }
            aria-pressed={key === scenarioKey}
            onClick={() => pickScenario(key)}
          >
            <span className="dx__query-prompt">/v1/query</span>
            {scenarios[key].label}
          </button>
        ))}
      </div>

      <div className="dx__stage">
        <div className="dx__col dx__col--keyword">
          <div className="dx__col-head">
            <span className="dx__col-name">keyword (BM25)</span>
            <span className="dx__col-lat">p50 {KEYWORD_P50} ms</span>
          </div>
          <div className="dx__list">
            {keywordList.map((c, i) => (
              <div className="dx__row" key={c.id}>
                <span className="dx__rank">{i + 1}</span>
                <span className="dx__row-doc">{c.doc}</span>
                <span className="dx__row-id">{c.id}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dx__merge" aria-hidden="true">
          <svg viewBox="0 0 40 200" className="dx__merge-svg" role="presentation">
            <motion.path
              d="M0 40 C 24 40, 16 100, 40 100"
              fill="none"
              stroke="var(--accent-line)"
              strokeWidth={1.5}
              animate={{ opacity: fused ? 1 : 0.35 }}
              transition={{ duration: 0.4 }}
            />
            <motion.path
              d="M0 160 C 24 160, 16 100, 40 100"
              fill="none"
              stroke="var(--accent-line)"
              strokeWidth={1.5}
              animate={{ opacity: fused ? 1 : 0.35 }}
              transition={{ duration: 0.4 }}
            />
          </svg>
        </div>

        <div className="dx__col dx__col--vector">
          <div className="dx__col-head">
            <span className="dx__col-name">vector (HNSW cosine)</span>
            <span className="dx__col-lat">p50 {VECTOR_P50} ms</span>
          </div>
          <div className="dx__list">
            {vectorList.map((c, i) => (
              <div className="dx__row" key={c.id}>
                <span className="dx__rank">{i + 1}</span>
                <span className="dx__row-doc">{c.doc}</span>
                <span className="dx__row-id">{c.id}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="dx__fusedwrap">
        <div className="dx__col-head dx__col-head--fused">
          <span className="dx__col-name dx__col-name--fused">
            fused (RRF k={RRF_K})
          </span>
          <span className="dx__col-lat">hybrid p50 {HYBRID_P50} ms</span>
        </div>
        <div className="dx__fused">
          <AnimatePresence initial={false}>
            {(fused ? fusedList : []).map((c, i) => (
              <motion.div
                className={
                  i === 0 ? 'dx__frow dx__frow--top' : 'dx__frow'
                }
                key={c.id}
                layout={!reduce}
                initial={{ opacity: 0, y: reduce ? 0 : 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: reduce ? 0 : 0.4,
                  delay: reduce ? 0 : i * 0.07,
                  ease,
                }}
              >
                <span className="dx__frank">{i + 1}</span>
                <span className="dx__frow-doc">{c.doc}</span>
                <span className="dx__signals">
                  <span
                    className={
                      c.keywordRank
                        ? 'dx__sig dx__sig--kw'
                        : 'dx__sig dx__sig--off'
                    }
                  >
                    kw {c.keywordRank ? `#${c.keywordRank}` : '-'}
                  </span>
                  <span
                    className={
                      c.vectorRank
                        ? 'dx__sig dx__sig--vec'
                        : 'dx__sig dx__sig--off'
                    }
                  >
                    vec {c.vectorRank ? `#${c.vectorRank}` : '-'}
                  </span>
                  <span className="dx__sig dx__sig--score">
                    {c.score.toFixed(4)}
                  </span>
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
          {!fused && (
            <div className="dx__fused-empty">
              Run fusion to merge both lists by 1 / (k + rank).
            </div>
          )}
        </div>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={() => setFused(true)}
          disabled={fused}
        >
          {fused ? 'Fused' : 'Run fusion'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => setFused(false)}
          disabled={!fused}
        >
          Reset
        </button>
        <span className="demo__hint">
          {fused
            ? `top result fuses both signals: ${fusedList[0].doc}`
            : 'score = 1/(k+keywordRank) + 1/(k+vectorRank)'}
        </span>
      </div>
    </div>
  );
}
