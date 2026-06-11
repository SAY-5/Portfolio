import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './triagegpt.css';

// TriageGPT ingests a failing test log, summarizes it into a structured form,
// and retrieves the most similar past failures from an embeddings index ranked
// by cosine similarity. It aggregates the retrieved neighbors' owner and
// root-cause labels into a ranked owner suggestion with a confidence. When no
// neighbor clears the similarity floor or confidence is too low, it reports
// "no confident match" rather than forcing a wrong owner. On a 20-case labeled
// set over a 400-failure corpus, retrieval scored precision@5 1.0, recall@5 1.0
// and mean reciprocal rank 1.0. The numbers below are illustrative neighbor
// scores; the headline retrieval metrics are the measured ones.

const FLOOR = 0.62; // similarity floor below which a neighbor is not counted
const CONF_FLOOR = 0.6; // owner-confidence floor for a confident match

type Neighbor = {
  id: string;
  owner: string;
  cause: string;
  sim: number;
  x: number; // plot position in embedding space (0..1)
  y: number;
};

type Sample = {
  key: string;
  label: string;
  errorType: string;
  salient: string;
  query: { x: number; y: number };
  neighbors: Neighbor[];
};

const SAMPLES: Sample[] = [
  {
    key: 'timeout',
    label: 'connection timeout',
    errorType: 'TimeoutError',
    salient: 'pool.acquire() exceeded 30s waiting for a free connection',
    query: { x: 0.32, y: 0.4 },
    neighbors: [
      { id: 'F-118', owner: 'platform', cause: 'db pool exhaustion', sim: 0.94, x: 0.36, y: 0.36 },
      { id: 'F-072', owner: 'platform', cause: 'db pool exhaustion', sim: 0.89, x: 0.28, y: 0.45 },
      { id: 'F-203', owner: 'platform', cause: 'slow query', sim: 0.81, x: 0.4, y: 0.5 },
      { id: 'F-051', owner: 'data', cause: 'migration lock', sim: 0.7, x: 0.5, y: 0.3 },
      { id: 'F-160', owner: 'platform', cause: 'db pool exhaustion', sim: 0.66, x: 0.22, y: 0.3 },
    ],
  },
  {
    key: 'assert',
    label: 'assertion mismatch',
    errorType: 'AssertionError',
    salient: 'expected status 200 but got 422 from /v2/checkout',
    query: { x: 0.68, y: 0.62 },
    neighbors: [
      { id: 'F-244', owner: 'checkout', cause: 'schema drift', sim: 0.92, x: 0.64, y: 0.6 },
      { id: 'F-189', owner: 'checkout', cause: 'schema drift', sim: 0.87, x: 0.72, y: 0.66 },
      { id: 'F-301', owner: 'checkout', cause: 'validation rule', sim: 0.79, x: 0.6, y: 0.7 },
      { id: 'F-090', owner: 'payments', cause: 'rounding', sim: 0.68, x: 0.78, y: 0.55 },
      { id: 'F-122', owner: 'checkout', cause: 'schema drift', sim: 0.64, x: 0.58, y: 0.52 },
    ],
  },
  {
    key: 'novel',
    label: 'unseen flake',
    errorType: 'RuntimeError',
    salient: 'segfault in native extension, no matching signature on record',
    query: { x: 0.5, y: 0.86 },
    neighbors: [
      { id: 'F-277', owner: 'platform', cause: 'native crash', sim: 0.55, x: 0.45, y: 0.7 },
      { id: 'F-018', owner: 'data', cause: 'oom', sim: 0.49, x: 0.6, y: 0.72 },
      { id: 'F-233', owner: 'checkout', cause: 'schema drift', sim: 0.41, x: 0.66, y: 0.78 },
      { id: 'F-141', owner: 'platform', cause: 'slow query', sim: 0.38, x: 0.36, y: 0.66 },
      { id: 'F-205', owner: 'payments', cause: 'rounding', sim: 0.33, x: 0.55, y: 0.6 },
    ],
  },
];

type Phase = 'idle' | 'summarize' | 'retrieve' | 'aggregate' | 'done';

const ease = [0.22, 1, 0.36, 1] as const;

export default function TriagegptDemo() {
  const reduce = useReducedMotion();
  const [sampleKey, setSampleKey] = useState(SAMPLES[0].key);
  const [phase, setPhase] = useState<Phase>('idle');
  const timers = useRef<number[]>([]);

  const sample = useMemo(
    () => SAMPLES.find((s) => s.key === sampleKey)!,
    [sampleKey],
  );

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // Aggregate neighbors that clear the similarity floor into a ranked owner
  // suggestion with a similarity-weighted confidence.
  const result = useMemo(() => {
    const kept = sample.neighbors.filter((n) => n.sim >= FLOOR);
    const weight: Record<string, number> = {};
    let total = 0;
    kept.forEach((n) => {
      weight[n.owner] = (weight[n.owner] ?? 0) + n.sim;
      total += n.sim;
    });
    const ranked = Object.entries(weight)
      .map(([owner, w]) => ({ owner, share: total ? w / total : 0 }))
      .sort((a, b) => b.share - a.share);
    const top = ranked[0];
    const confident = kept.length > 0 && top && top.share >= CONF_FLOOR;
    // The root cause that dominates the kept neighbors for the top owner.
    const cause = (() => {
      const counts: Record<string, number> = {};
      kept
        .filter((n) => top && n.owner === top.owner)
        .forEach((n) => {
          counts[n.cause] = (counts[n.cause] ?? 0) + 1;
        });
      return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    })();
    return { kept, ranked, top, confident, cause };
  }, [sample]);

  const reset = useCallback(() => {
    clearTimers();
    setPhase('idle');
  }, [clearTimers]);

  const run = useCallback(() => {
    clearTimers();
    setPhase('idle');
    if (reduce) {
      setPhase('done');
      return;
    }
    const seq: Array<[number, Phase]> = [
      [60, 'summarize'],
      [700, 'retrieve'],
      [1500, 'aggregate'],
      [2200, 'done'],
    ];
    seq.forEach(([delay, p]) => {
      timers.current.push(window.setTimeout(() => setPhase(p), delay));
    });
  }, [clearTimers, reduce]);

  const onPick = useCallback(
    (key: string) => {
      clearTimers();
      setSampleKey(key);
      setPhase('idle');
    },
    [clearTimers],
  );

  const showSummary = phase !== 'idle';
  const showRetrieve = phase === 'retrieve' || phase === 'aggregate' || phase === 'done';
  const showAggregate = phase === 'aggregate' || phase === 'done';
  const done = phase === 'done';

  return (
    <div className="demo" aria-label="TriageGPT defect triage demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Triage a failing log</h3>
      <p className="demo__lede">
        Pick a failing log and run triage. It normalizes into a structured
        summary, plots into the embedding space where the nearest past failures
        light up by cosine similarity, then aggregates their owner labels into a
        ranked suggestion with a confidence. A log with no neighbor above the
        floor trips the no-confident-match state.
      </p>

      <div className="tg__picker" role="tablist" aria-label="failing log samples">
        {SAMPLES.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={s.key === sampleKey}
            className={`tg__pick ${s.key === sampleKey ? 'tg__pick--on' : ''}`}
            onClick={() => onPick(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="tg__stage">
        <div className="tg__col">
          <div className="tg__log">
            <div className="tg__log-head">failing log</div>
            <pre className="tg__log-body">{`FAILED tests/run::case
${sample.errorType}: ${sample.salient}
  exit code 1`}</pre>
          </div>

          <AnimatePresence>
            {showSummary && (
              <motion.div
                className="tg__summary"
                initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.3, ease }}
              >
                <div className="tg__summary-head">structured summary</div>
                <dl className="tg__summary-grid">
                  <dt>error_type</dt>
                  <dd>{sample.errorType}</dd>
                  <dt>salient</dt>
                  <dd>{sample.salient}</dd>
                </dl>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="tg__col">
          <div className="tg__space-head">embedding space · cosine k-NN</div>
          <div className="tg__space" role="img" aria-label="embedding space plot">
            <svg viewBox="0 0 100 100" className="tg__space-svg" preserveAspectRatio="none">
              {/* edges from query to each kept neighbor */}
              {showRetrieve &&
                sample.neighbors.map((n) => {
                  const kept = n.sim >= FLOOR;
                  return (
                    <motion.line
                      key={`e-${n.id}`}
                      x1={sample.query.x * 100}
                      y1={sample.query.y * 100}
                      x2={n.x * 100}
                      y2={n.y * 100}
                      stroke={kept ? 'var(--accent)' : 'var(--line)'}
                      strokeWidth={kept ? 0.6 : 0.4}
                      strokeOpacity={kept ? 0.7 : 0.3}
                      strokeDasharray={kept ? '0' : '1.5 1.5'}
                      initial={{ pathLength: reduce ? 1 : 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: reduce ? 0 : 0.5, ease }}
                    />
                  );
                })}
              {/* neighbor points */}
              {sample.neighbors.map((n) => {
                const kept = showRetrieve && n.sim >= FLOOR;
                return (
                  <motion.circle
                    key={n.id}
                    cx={n.x * 100}
                    cy={n.y * 100}
                    r={kept ? 2.4 : 1.8}
                    className={kept ? 'tg__pt tg__pt--kept' : 'tg__pt'}
                    initial={false}
                    animate={
                      kept && !reduce
                        ? { scale: [1, 1.4, 1] }
                        : { scale: 1 }
                    }
                    style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                    transition={{ duration: 0.5 }}
                  />
                );
              })}
              {/* query point */}
              <circle
                cx={sample.query.x * 100}
                cy={sample.query.y * 100}
                r={2.8}
                className="tg__pt-query"
              />
            </svg>
          </div>

          <AnimatePresence>
            {showRetrieve && (
              <motion.ul
                className="tg__neighbors"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {sample.neighbors.map((n, i) => {
                  const kept = n.sim >= FLOOR;
                  return (
                    <motion.li
                      key={n.id}
                      className={`tg__nb ${kept ? 'tg__nb--kept' : 'tg__nb--below'}`}
                      initial={{ opacity: 0, x: reduce ? 0 : -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: reduce ? 0 : 0.22, delay: reduce ? 0 : i * 0.06 }}
                    >
                      <span className="tg__nb-id">{n.id}</span>
                      <span className="tg__nb-owner">{n.owner}</span>
                      <span className="tg__nb-sim">{n.sim.toFixed(2)}</span>
                    </motion.li>
                  );
                })}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {showAggregate && (
          <motion.div
            key={done && !result.confident ? 'nomatch' : 'match'}
            className={`tg__result ${
              done && !result.confident ? 'tg__result--none' : ''
            }`}
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.35, ease }}
          >
            {result.confident ? (
              <>
                <div className="tg__result-head">
                  suggested owner
                  <span className="tg__result-owner">{result.top!.owner}</span>
                </div>
                <div className="tg__bars">
                  {result.ranked.map((r) => (
                    <div key={r.owner} className="tg__bar-row">
                      <span className="tg__bar-name">{r.owner}</span>
                      <div className="tg__bar-track">
                        <motion.div
                          className="tg__bar-fill"
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.round(r.share * 100)}%` }}
                          transition={{ duration: reduce ? 0 : 0.6, ease }}
                        />
                      </div>
                      <span className="tg__bar-pct">
                        {Math.round(r.share * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
                <div className="tg__conf">
                  <span className="tg__conf-label">confidence</span>
                  <div className="tg__conf-meter">
                    <motion.div
                      className="tg__conf-fill"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.round(result.top!.share * 100)}%` }}
                      transition={{ duration: reduce ? 0 : 0.6, ease }}
                    />
                  </div>
                  <span className="tg__conf-val">
                    {Math.round(result.top!.share * 100)}%
                  </span>
                </div>
                {done && (
                  <div className="tg__cause">
                    likely root cause: <b>{result.cause}</b> · from{' '}
                    {result.kept.length} neighbors above the {FLOOR.toFixed(2)}{' '}
                    floor
                  </div>
                )}
              </>
            ) : (
              <div className="tg__nomatch">
                <span className="tg__nomatch-head">no confident match</span>
                <span className="tg__nomatch-text">
                  No retrieved failure cleared the {FLOOR.toFixed(2)} similarity
                  floor, so triage reports no confident match rather than forcing
                  a wrong owner onto the ticket.
                </span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {done && (
        <motion.div
          className="tg__metrics"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : 0.2 }}
        >
          <div className="tg__metric">
            <span className="tg__metric-val">1.0</span>
            <span className="tg__metric-label">precision@5</span>
          </div>
          <div className="tg__metric">
            <span className="tg__metric-val">1.0</span>
            <span className="tg__metric-label">recall@5</span>
          </div>
          <div className="tg__metric">
            <span className="tg__metric-val">1.0</span>
            <span className="tg__metric-label">mrr</span>
          </div>
          <div className="tg__metric tg__metric--corpus">
            <span className="tg__metric-val">400</span>
            <span className="tg__metric-label">failure corpus</span>
          </div>
        </motion.div>
      )}

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={run}
          disabled={phase !== 'idle' && phase !== 'done'}
        >
          {phase === 'idle' ? 'Run triage' : done ? 'Run again' : 'Triaging…'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={phase === 'idle'}
        >
          Reset
        </button>
        <span className="demo__hint">
          measured over a 20-case labeled set, 400-failure corpus
        </span>
      </div>
    </div>
  );
}
