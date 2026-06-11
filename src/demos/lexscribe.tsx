import { useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './lexscribe.css';

// Real project facts: hybrid retrieval fuses BM25 and dense vectors via
// Reciprocal Rank Fusion (k=60), then a cross-encoder rerank. Generation is
// constrained to cite only indices from the retrieved set, so answers cannot
// invent a source. Every citation carries chunk_hash and doc_canonical_hash
// (sha256 over NFKC-normalised text) and pins to an exact page and character
// range. The harder mna_real_v1 suite scores 0.50 precision@1 over five real
// EDGAR merger agreements. End-to-end Q&A p50 is 2.72 ms at small scale.

const RRF_K = 60;

type Question = {
  id: string;
  q: string;
  // The page text the answer is grounded in; cite spans into this string.
  page: string;
  citeStart: number;
  citeEnd: number;
  answer: string;
};

type Chunk = {
  id: string;
  label: string;
  bm25: number; // rank in the BM25 lane (1-based)
  dense: number; // rank in the dense lane (1-based)
  rerank: number; // final cross-encoder order (1-based), set after fusion
  isAnswer?: boolean;
};

type Scenario = {
  question: Question;
  chunks: Chunk[];
};

const scenarios: Scenario[] = [
  {
    question: {
      id: 's1',
      q: 'What notice period applies to termination for convenience?',
      page:
        'Section 8.2 Termination. Either party may terminate this Agreement for convenience upon ninety (90) days prior written notice to the other party. Such notice shall be delivered in accordance with Section 12.4 and shall specify the effective date of termination.',
      citeStart: 78,
      citeEnd: 138,
      answer:
        'Either party may terminate for convenience on ninety (90) days prior written notice.',
    },
    chunks: [
      { id: 'c1', label: '8.2 Termination, p.14', bm25: 1, dense: 2, rerank: 1, isAnswer: true },
      { id: 'c2', label: '12.4 Notices, p.21', bm25: 2, dense: 4, rerank: 2 },
      { id: 'c3', label: '8.1 Term, p.13', bm25: 4, dense: 1, rerank: 3 },
      { id: 'c4', label: '2.3 Closing, p.4', bm25: 3, dense: 5, rerank: 4 },
      { id: 'c5', label: '8.3 Survival, p.15', bm25: 5, dense: 3, rerank: 5 },
    ],
  },
  {
    question: {
      id: 's2',
      q: 'What is the cap on the indemnification obligations?',
      page:
        'Section 10.4 Limitation. The aggregate liability of the Seller for indemnification under this Article X shall not exceed fifteen percent (15%) of the Purchase Price, except in the case of fraud or willful misconduct.',
      citeStart: 68,
      citeEnd: 145,
      answer:
        'Seller indemnification is capped at fifteen percent (15%) of the Purchase Price, save for fraud.',
    },
    chunks: [
      { id: 'd1', label: '10.4 Limitation, p.18', bm25: 2, dense: 1, rerank: 1, isAnswer: true },
      { id: 'd2', label: '10.1 Indemnity, p.17', bm25: 1, dense: 3, rerank: 2 },
      { id: 'd3', label: '1.1 Defined Terms, p.2', bm25: 3, dense: 2, rerank: 3 },
      { id: 'd4', label: '10.5 Escrow, p.19', bm25: 4, dense: 4, rerank: 4 },
      { id: 'd5', label: '3.2 Purchase Price, p.6', bm25: 5, dense: 5, rerank: 5 },
    ],
  },
];

// Reciprocal Rank Fusion: each lane contributes 1 / (k + rank).
function rrf(rankA: number, rankB: number): number {
  return 1 / (RRF_K + rankA) + 1 / (RRF_K + rankB);
}

const ease = [0.22, 1, 0.36, 1] as const;
type Stage = 0 | 1 | 2 | 3; // 0 idle, 1 lanes, 2 fused, 3 answered

export default function LexscribeDemo() {
  const reduce = useReducedMotion();
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [stage, setStage] = useState<Stage>(0);

  const scenario = scenarios[scenarioIdx];
  const { question } = scenario;

  // Fused ranking: order by RRF score, descending.
  const fused = useMemo(() => {
    return [...scenario.chunks]
      .map((c) => ({ ...c, score: rrf(c.bm25, c.dense) }))
      .sort((a, b) => b.score - a.score);
  }, [scenario]);

  const bm25Lane = useMemo(
    () => [...scenario.chunks].sort((a, b) => a.bm25 - b.bm25),
    [scenario]
  );
  const denseLane = useMemo(
    () => [...scenario.chunks].sort((a, b) => a.dense - b.dense),
    [scenario]
  );
  const reranked = useMemo(
    () => [...scenario.chunks].sort((a, b) => a.rerank - b.rerank),
    [scenario]
  );

  const answerChunk = scenario.chunks.find((c) => c.isAnswer)!;

  function run() {
    if (reduce) {
      setStage(3);
      return;
    }
    setStage(1);
    window.setTimeout(() => setStage(2), 700);
    window.setTimeout(() => setStage(3), 1500);
  }

  function pickScenario(i: number) {
    setScenarioIdx(i);
    setStage(0);
  }

  function reset() {
    setStage(0);
  }

  const before = question.page.slice(0, question.citeStart);
  const cited = question.page.slice(question.citeStart, question.citeEnd);
  const after = question.page.slice(question.citeEnd);
  const showHighlight = stage === 3;

  return (
    <div className="demo" aria-label="lexscribe hybrid retrieval demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Hybrid retrieval to a cited span</h3>
      <p className="demo__lede">
        Ask a question against a contract. BM25 and dense lanes each rank
        chunks, fuse through reciprocal rank fusion, get reranked, and the answer
        highlights the exact cited character span on the page.
      </p>

      <div className="lx__tabs" role="tablist" aria-label="example question">
        {scenarios.map((s, i) => (
          <button
            key={s.question.id}
            role="tab"
            aria-selected={i === scenarioIdx}
            className={'lx__tab' + (i === scenarioIdx ? ' lx__tab--on' : '')}
            onClick={() => pickScenario(i)}
          >
            Question {i + 1}
          </button>
        ))}
      </div>

      <div className="lx__q">
        <span className="lx__q-mark" aria-hidden="true">Q</span>
        {question.q}
      </div>

      <div className="lx__stage">
        <div className="lx__lanes">
          <Lane
            title="BM25"
            sub="lexical"
            rows={bm25Lane}
            rankKey="bm25"
            visible={stage >= 1}
            reduce={reduce}
          />
          <Lane
            title="Dense"
            sub="pgvector"
            rows={denseLane}
            rankKey="dense"
            visible={stage >= 1}
            reduce={reduce}
          />
        </div>

        <div className="lx__fused">
          <div className="lx__fused-head">
            <span>Reciprocal rank fusion</span>
            <span className="lx__fused-k">k = {RRF_K}</span>
          </div>
          <div className="lx__fused-list">
            <AnimatePresence>
              {stage >= 2 &&
                (stage >= 3 ? reranked : fused).map((c, i) => {
                  const score = rrf(c.bm25, c.dense);
                  const isTop = stage >= 3 && c.isAnswer;
                  return (
                    <motion.div
                      key={c.id}
                      layout={!reduce}
                      initial={{ opacity: 0, x: reduce ? 0 : -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: reduce ? 0 : 0.35, delay: reduce ? 0 : i * 0.05, ease }}
                      className={'lx__fused-row' + (isTop ? ' lx__fused-row--top' : '')}
                    >
                      <span className="lx__fused-rank">{i + 1}</span>
                      <span className="lx__fused-label">{c.label}</span>
                      <span className="lx__fused-score">{score.toFixed(4)}</span>
                    </motion.div>
                  );
                })}
            </AnimatePresence>
            {stage < 2 && (
              <p className="lx__fused-empty">
                Run retrieval to fuse the two lanes into one ranked set.
              </p>
            )}
          </div>
          {stage >= 3 && (
            <div className="lx__rerank-note">cross-encoder rerank applied</div>
          )}
        </div>

        <div className="lx__page" aria-label="contract page with cited span">
          <div className="lx__page-head">
            <span>contract page</span>
            <span className="lx__page-src">{answerChunk.label}</span>
          </div>
          <p className="lx__page-body">
            {before}
            <span className={'lx__span' + (showHighlight ? ' lx__span--on' : '')}>
              {cited}
            </span>
            {after}
          </p>
          {showHighlight && (
            <motion.div
              className="lx__cite"
              initial={{ opacity: 0, y: reduce ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduce ? 0 : 0.35, ease }}
            >
              <div className="lx__cite-meta">
                <code>page {answerChunk.label.split('p.')[1] ?? '?'}</code>
                <code>
                  chars {question.citeStart}-{question.citeEnd}
                </code>
                <code>chunk_hash sha256</code>
              </div>
              <p className="lx__answer">{question.answer}</p>
            </motion.div>
          )}
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={stage !== 0}>
          {stage === 0 ? 'Run retrieval' : 'Retrieved'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={stage === 0}>
          Reset
        </button>
        <span className="demo__hint">
          mna_real_v1: 0.50 precision@1 over 5 real EDGAR merger agreements
        </span>
      </div>
    </div>
  );
}

function Lane(props: {
  title: string;
  sub: string;
  rows: Chunk[];
  rankKey: 'bm25' | 'dense';
  visible: boolean;
  reduce: boolean | null;
}) {
  const { title, sub, rows, rankKey, visible, reduce } = props;
  return (
    <div className="lx__lane">
      <div className="lx__lane-head">
        <span className="lx__lane-title">{title}</span>
        <span className="lx__lane-sub">{sub}</span>
      </div>
      <div className="lx__lane-list">
        {rows.map((c, i) => (
          <motion.div
            key={c.id}
            className="lx__lane-row"
            initial={false}
            animate={{ opacity: visible ? 1 : 0.25, x: visible ? 0 : reduce ? 0 : -6 }}
            transition={{ duration: reduce ? 0 : 0.3, delay: visible && !reduce ? i * 0.06 : 0 }}
          >
            <span className="lx__lane-rank">{c[rankKey]}</span>
            <span className="lx__lane-label">{c.label}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
