import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './clinicalrag.css';

// Real numbers from the project: a retrieval pipeline that indexes 15,000+
// documents and cuts manual research lookup time by 50%. The vector index is
// FAISS-shaped (add, search, size). A hallucination guard scores each answer
// claim's overlap with the retrieved evidence and refuses answers below a
// threshold. Tokens and citations stream back over SSE.
const INDEXED_DOCS = '15,000+';
const LOOKUP_CUT = 50;
const TOP_K = 4;

type Chunk = {
  id: number;
  cite: string; // citation label, e.g. [3]
  title: string;
  x: number; // 2D projection of the embedding (0..100)
  y: number;
};

type Query = {
  id: string;
  label: string;
  qx: number;
  qy: number;
  // the streamed answer, split into claim spans. each claim cites one chunk
  // and carries an overlap score with that retrieved evidence (0..1).
  claims: { text: string; cite: number; overlap: number }[];
};

// A small embedding space: each dot is a document chunk projected to 2D.
const CHUNKS: Chunk[] = [
  { id: 1, cite: '[1]', title: 'metformin first-line therapy', x: 22, y: 30 },
  { id: 2, cite: '[2]', title: 'GLP-1 receptor agonist trial', x: 34, y: 22 },
  { id: 3, cite: '[3]', title: 'HbA1c target thresholds', x: 28, y: 44 },
  { id: 4, cite: '[4]', title: 'renal dosing adjustments', x: 44, y: 36 },
  { id: 5, cite: '[5]', title: 'statin cardiovascular benefit', x: 70, y: 66 },
  { id: 6, cite: '[6]', title: 'ACE inhibitor nephropathy', x: 62, y: 30 },
  { id: 7, cite: '[7]', title: 'hypoglycemia risk factors', x: 18, y: 58 },
  { id: 8, cite: '[8]', title: 'lifestyle intervention outcomes', x: 50, y: 18 },
  { id: 9, cite: '[9]', title: 'SGLT2 inhibitor heart failure', x: 80, y: 44 },
  { id: 10, cite: '[10]', title: 'insulin titration protocol', x: 38, y: 60 },
  { id: 11, cite: '[11]', title: 'unrelated: wound care guideline', x: 86, y: 20 },
  { id: 12, cite: '[12]', title: 'unrelated: vaccine schedule', x: 14, y: 84 },
];

const QUERIES: Query[] = [
  {
    id: 'first-line',
    label: 'First-line therapy for type 2 diabetes?',
    qx: 28,
    qy: 32,
    claims: [
      { text: 'Metformin is recommended as first-line therapy ', cite: 1, overlap: 0.92 },
      { text: 'with an HbA1c target around 7% ', cite: 3, overlap: 0.81 },
      { text: 'and a GLP-1 agonist added when targets are missed.', cite: 2, overlap: 0.74 },
    ],
  },
  {
    id: 'renal',
    label: 'Dosing in patients with renal impairment?',
    qx: 44,
    qy: 36,
    claims: [
      { text: 'Doses are adjusted for renal function ', cite: 4, overlap: 0.88 },
      { text: 'and SGLT2 inhibitors are considered for heart-failure benefit ', cite: 9, overlap: 0.69 },
      { text: 'while cutting cholesterol by exactly half.', cite: 5, overlap: 0.18 },
    ],
  },
  {
    id: 'cardio',
    label: 'Cardiovascular risk management?',
    qx: 66,
    qy: 48,
    claims: [
      { text: 'Statins provide cardiovascular benefit ', cite: 5, overlap: 0.9 },
      { text: 'and ACE inhibitors slow nephropathy ', cite: 6, overlap: 0.78 },
      { text: 'so every patient should stop all medication.', cite: 11, overlap: 0.12 },
    ],
  },
];

function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by);
}

const ease = [0.22, 1, 0.36, 1] as const;

type Phase = 'idle' | 'retrieve' | 'stream' | 'done';

export default function ClinicalragDemo() {
  const reduce = useReducedMotion();
  const [queryId, setQueryId] = useState(QUERIES[0].id);
  const [threshold, setThreshold] = useState(0.4);
  const [phase, setPhase] = useState<Phase>('idle');
  const [revealedClaims, setRevealedClaims] = useState(0); // claims fully streamed
  const [streamChars, setStreamChars] = useState(0); // chars of current claim shown
  const timers = useRef<number[]>([]);

  const query = QUERIES.find((q) => q.id === queryId)!;

  // top-k nearest chunks to the query vector (FAISS-shaped search)
  const ranked = useMemo(() => {
    return CHUNKS.map((c) => ({ c, d: dist(query.qx, query.qy, c.x, c.y) })).sort(
      (a, b) => a.d - b.d,
    );
  }, [query]);
  const topK = ranked.slice(0, TOP_K).map((r) => r.c.id);

  function clearTimers() {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function reset() {
    clearTimers();
    setPhase('idle');
    setRevealedClaims(0);
    setStreamChars(0);
  }

  function selectQuery(id: string) {
    if (phase === 'retrieve' || phase === 'stream') return;
    setQueryId(id);
    reset();
  }

  function run() {
    clearTimers();
    setRevealedClaims(0);
    setStreamChars(0);
    setPhase('retrieve');

    if (reduce) {
      setRevealedClaims(query.claims.length);
      setPhase('done');
      return;
    }

    // after the retrieve highlight settles, stream the answer claim by claim,
    // character by character, so citations attach as each claim completes.
    const retrieveMs = 700;
    timers.current.push(
      window.setTimeout(() => {
        setPhase('stream');
        streamClaim(0);
      }, retrieveMs),
    );
  }

  function streamClaim(idx: number) {
    if (idx >= query.claims.length) {
      setPhase('done');
      return;
    }
    const text = query.claims[idx].text;
    let ch = 0;
    setStreamChars(0);
    const stepMs = 26;
    const tick = () => {
      ch += 1;
      setStreamChars(ch);
      if (ch < text.length) {
        timers.current.push(window.setTimeout(tick, stepMs));
      } else {
        // claim complete: lock it in, pause, then next claim
        setRevealedClaims(idx + 1);
        setStreamChars(0);
        timers.current.push(window.setTimeout(() => streamClaim(idx + 1), 360));
      }
    };
    timers.current.push(window.setTimeout(tick, stepMs));
  }

  const running = phase === 'retrieve' || phase === 'stream';
  const showRetrieval = phase !== 'idle';

  // guard verdict for each claim once it is revealed
  const claimVerdicts = query.claims.map((c, i) => {
    const revealed = i < revealedClaims;
    const accepted = c.overlap >= threshold;
    return { ...c, revealed, accepted };
  });
  const anyRefused =
    phase === 'done' && claimVerdicts.some((c) => c.revealed && !c.accepted);
  const lowestOverlap = Math.min(...query.claims.map((c) => c.overlap));

  return (
    <div className="demo" aria-label="clinicalrag retrieval and guard demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Retrieve, stream, and guard the answer</h3>
      <p className="demo__lede">
        Pick a query to search the index of {INDEXED_DOCS} documents. The query
        vector lights up its {TOP_K} nearest chunks, then the answer streams in
        with citations attaching. The hallucination guard scores each claim's
        overlap with its retrieved evidence and refuses any claim below the
        threshold you set.
      </p>

      <div className="crag__queries" role="group" aria-label="example queries">
        {QUERIES.map((q) => (
          <button
            key={q.id}
            className={`crag__query${q.id === queryId ? ' crag__query--on' : ''}`}
            aria-pressed={q.id === queryId}
            onClick={() => selectQuery(q.id)}
            disabled={running}
          >
            {q.label}
          </button>
        ))}
      </div>

      <div className="crag__stage">
        <div className="crag__space">
          <div className="crag__space-head">Embedding space &middot; cosine nearest neighbors</div>
          <svg
            className="crag__svg"
            viewBox="0 0 100 100"
            role="group"
            aria-label="document chunks projected to two dimensions"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* edges from query to its top-k neighbors */}
            <AnimatePresence>
              {showRetrieval &&
                topK.map((cid, i) => {
                  const c = CHUNKS.find((x) => x.id === cid)!;
                  return (
                    <motion.line
                      key={`edge-${queryId}-${cid}`}
                      x1={query.qx}
                      y1={query.qy}
                      x2={c.x}
                      y2={c.y}
                      stroke="var(--accent)"
                      strokeWidth={0.5}
                      strokeOpacity={0.5}
                      initial={{ pathLength: reduce ? 1 : 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: reduce ? 0 : 0.4, delay: reduce ? 0 : i * 0.08, ease }}
                    />
                  );
                })}
            </AnimatePresence>

            {/* chunk dots */}
            {CHUNKS.map((c) => {
              const hit = showRetrieval && topK.includes(c.id);
              return (
                <g key={c.id}>
                  <motion.circle
                    cx={c.x}
                    cy={c.y}
                    r={hit ? 2.6 : 1.6}
                    fill={hit ? 'var(--accent)' : 'var(--crag-dot)'}
                    animate={{
                      r: hit ? 2.6 : 1.6,
                      opacity: showRetrieval ? (hit ? 1 : 0.35) : 0.7,
                    }}
                    transition={{ duration: reduce ? 0 : 0.3 }}
                  />
                  {hit && (
                    <text x={c.x + 3.2} y={c.y + 1.2} className="crag__dot-cite">
                      {c.cite}
                    </text>
                  )}
                </g>
              );
            })}

            {/* the query vector */}
            <motion.circle
              cx={query.qx}
              cy={query.qy}
              r={2.4}
              fill="none"
              stroke="var(--text-strong)"
              strokeWidth={0.8}
              animate={{ scale: showRetrieval && !reduce ? [1, 1.25, 1] : 1 }}
              transition={{ duration: 1.1, repeat: showRetrieval && !reduce ? Infinity : 0, ease: 'easeInOut' }}
              style={{ transformOrigin: `${query.qx}px ${query.qy}px` }}
            />
            <circle cx={query.qx} cy={query.qy} r={0.9} fill="var(--text-strong)" />
          </svg>
          <div className="crag__space-meta">
            {showRetrieval
              ? `search() returned top ${TOP_K} of ${CHUNKS.length} chunks in view`
              : `index.size() = ${INDEXED_DOCS} documents`}
          </div>
        </div>

        <div className="crag__answer">
          <div className="crag__answer-head">
            <span>Grounded answer</span>
            <span className="crag__sse" data-on={phase === 'stream'}>
              SSE {phase === 'stream' ? 'streaming' : phase === 'done' ? 'closed' : 'idle'}
            </span>
          </div>
          <div className="crag__answer-body" aria-live="polite">
            {phase === 'idle' && (
              <span className="crag__placeholder">Run the query to stream a citation-grounded answer.</span>
            )}
            {phase === 'retrieve' && <span className="crag__placeholder">Retrieving evidence&hellip;</span>}
            {(phase === 'stream' || phase === 'done') &&
              claimVerdicts.map((c, i) => {
                const isCurrent = phase === 'stream' && i === revealedClaims;
                const isRevealed = c.revealed;
                if (!isRevealed && !isCurrent) return null;
                const shownText = isCurrent ? c.text.slice(0, streamChars) : c.text;
                const chunk = CHUNKS.find((x) => x.id === c.cite)!;
                const refused = isRevealed && !c.accepted;
                return (
                  <span key={i} className={`crag__claim${refused ? ' crag__claim--refused' : ''}`}>
                    <span className="crag__claim-text">{shownText}</span>
                    {isCurrent && <span className="crag__caret" aria-hidden="true" />}
                    {isRevealed &&
                      (c.accepted ? (
                        <motion.span
                          className="crag__cite"
                          initial={{ opacity: 0, y: reduce ? 0 : 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.25 }}
                          title={chunk.title}
                        >
                          {chunk.cite}
                        </motion.span>
                      ) : (
                        <motion.span
                          className="crag__cite crag__cite--refused"
                          initial={{ opacity: 0, y: reduce ? 0 : 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.25 }}
                          title={`overlap ${c.overlap.toFixed(2)} below threshold ${threshold.toFixed(2)}`}
                        >
                          refused
                        </motion.span>
                      ))}{' '}
                  </span>
                );
              })}
          </div>

          <div className="crag__guard">
            <div className="crag__guard-head">
              <span>Hallucination guard</span>
              <span className="crag__guard-th">
                threshold <b>{threshold.toFixed(2)}</b>
              </span>
            </div>
            <input
              className="crag__slider"
              type="range"
              min={0}
              max={0.9}
              step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              aria-label="guard overlap threshold"
            />
            <div className="crag__meters">
              {query.claims.map((c, i) => {
                const revealed = i < revealedClaims;
                const accepted = c.overlap >= threshold;
                return (
                  <div key={i} className="crag__meter" data-revealed={revealed} data-ok={accepted}>
                    <div className="crag__meter-label">
                      claim {i + 1}
                      <span className="crag__meter-score">{c.overlap.toFixed(2)}</span>
                    </div>
                    <div className="crag__meter-track">
                      <motion.div
                        className="crag__meter-fill"
                        data-ok={accepted}
                        animate={{ width: revealed ? `${c.overlap * 100}%` : '0%' }}
                        transition={{ duration: reduce ? 0 : 0.5, ease }}
                      />
                      <div
                        className="crag__meter-th"
                        style={{ left: `${threshold * 100}%` }}
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {phase === 'done' && (
          <motion.div
            className={`crag__verdict${anyRefused ? ' crag__verdict--refused' : ''}`}
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            <span className="crag__verdict-head">
              {anyRefused ? 'Guard refused a claim' : 'All claims grounded'}
            </span>
            <span className="crag__verdict-text">
              {anyRefused
                ? `One claim scored ${lowestOverlap.toFixed(2)} overlap against its retrieved evidence, below the ${threshold.toFixed(2)} threshold, so the guard refused it instead of letting it through. This grounding is what cuts manual lookup time by ${LOOKUP_CUT}%.`
                : `Every claim cleared the ${threshold.toFixed(2)} overlap threshold against its retrieved evidence. Citation grounding over ${INDEXED_DOCS} documents cuts manual lookup time by ${LOOKUP_CUT}%.`}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Running…' : phase === 'done' ? 'Run again' : 'Run query'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={phase === 'idle'}>
          Reset
        </button>
        <span className="demo__hint">drag the threshold to make the guard refuse a weak claim</span>
      </div>
    </div>
  );
}
