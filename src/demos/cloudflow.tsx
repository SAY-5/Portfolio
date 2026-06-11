import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './cloudflow.css';

// CloudFlow ops-assistant: a question retrieves log lines and runbook chunks via
// hybrid vector plus keyword, then answers with grounded citations. The enforced
// correctness property is that every cited id must exist in the retrieved
// candidate set, so the assistant cannot cite a source it did not retrieve. This
// demo lets you toggle a cited id in and out of that candidate set and watch the
// property gate the answer.

type Service = { id: string; name: string; status: 'ok' | 'degraded' | 'down' };

const SERVICES: Service[] = [
  { id: 'gateway', name: 'gateway', status: 'ok' },
  { id: 'orders', name: 'orders', status: 'degraded' },
  { id: 'payments', name: 'payments', status: 'ok' },
  { id: 'inventory', name: 'inventory', status: 'down' },
  { id: 'notify', name: 'notify', status: 'ok' },
  { id: 'search', name: 'search', status: 'ok' },
];

type Candidate = {
  id: string;
  kind: 'log' | 'doc';
  source: string;
  score: number; // hybrid score, vector plus keyword
  text: string;
};

// The retrieved candidate set for the orders spike question. Scores are the
// hybrid vector-plus-keyword ranks the retriever returns.
const CANDIDATES: Candidate[] = [
  {
    id: 'log:orders#4182',
    kind: 'log',
    source: 'orders 14:00:07',
    score: 0.91,
    text: 'ERROR pool exhausted: inventory client timeout after 2000ms',
  },
  {
    id: 'doc:runbook/inventory#timeouts',
    kind: 'doc',
    source: 'runbook/inventory',
    score: 0.86,
    text: 'When inventory is down, orders error-rate spikes from connection-pool exhaustion.',
  },
  {
    id: 'log:inventory#0091',
    kind: 'log',
    source: 'inventory 13:59:51',
    score: 0.78,
    text: 'FATAL readiness probe failed; pod evicted',
  },
  {
    id: 'log:gateway#7720',
    kind: 'log',
    source: 'gateway 14:00:09',
    score: 0.64,
    text: 'WARN upstream orders 503, retry budget low',
  },
  {
    id: 'doc:runbook/orders#poolsize',
    kind: 'doc',
    source: 'runbook/orders',
    score: 0.59,
    text: 'orders pool-size is fixed; failing downstreams block all checkout calls.',
  },
];

// The ids the answer cites. Every one of these must be present in the retrieved
// candidate set or the property rejects the answer.
const CITED = ['log:orders#4182', 'doc:runbook/inventory#timeouts', 'log:inventory#0091'];

const QUESTION = 'why did orders error-rate spike at 14:00';

type Stage = 'idle' | 'retrieving' | 'grounding' | 'answered';

const ease = [0.22, 1, 0.36, 1] as const;

export default function CloudflowDemo() {
  const reduce = useReducedMotion();
  // which candidate ids are currently in the retrieved set; toggling one off
  // simulates a candidate that was not retrieved.
  const [present, setPresent] = useState<Record<string, boolean>>(
    () => Object.fromEntries(CANDIDATES.map((c) => [c.id, true])),
  );
  const [stage, setStage] = useState<Stage>('idle');
  const [revealed, setRevealed] = useState(0); // candidates revealed during retrieval
  const [checked, setChecked] = useState(0); // cited ids checked during grounding
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const after = useCallback(
    (ms: number, fn: () => void) => {
      const t = window.setTimeout(fn, reduce ? 0 : ms);
      timers.current.push(t);
    },
    [reduce],
  );

  const running = stage === 'retrieving' || stage === 'grounding';
  const missingCited = CITED.filter((id) => !present[id]);
  const grounded = missingCited.length === 0;

  function toggle(id: string) {
    if (running) return;
    setStage('idle');
    setRevealed(0);
    setChecked(0);
    setPresent((p) => ({ ...p, [id]: !p[id] }));
  }

  function ask() {
    if (running) return;
    clearTimers();
    setStage('retrieving');
    setRevealed(0);
    setChecked(0);

    const live = CANDIDATES.filter((c) => present[c.id]);
    live.forEach((_, i) => {
      after(220 + i * 240, () => setRevealed(i + 1));
    });
    const retrievalEnd = 220 + live.length * 240 + 200;

    after(retrievalEnd, () => {
      setStage('grounding');
      CITED.forEach((_, i) => {
        after(i * 260, () => setChecked(i + 1));
      });
      after(CITED.length * 260 + 260, () => setStage('answered'));
    });
  }

  function reset() {
    clearTimers();
    setStage('idle');
    setRevealed(0);
    setChecked(0);
    setPresent(Object.fromEntries(CANDIDATES.map((c) => [c.id, true])));
  }

  const liveCandidates = CANDIDATES.filter((c) => present[c.id]);

  return (
    <div className="demo" aria-label="cloudflow ops-assistant demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Grounded answer, every citation checked</h3>
      <p className="demo__lede">
        Ask the ops-assistant and watch it retrieve log lines and runbook chunks
        by hybrid score, then ground the answer. Toggle a cited source out of the
        retrieved set to see the enforced property block the answer: every cited
        id must exist in what was retrieved.
      </p>

      <div className="cf__health" role="group" aria-label="service health grid">
        {SERVICES.map((s) => (
          <div
            key={s.id}
            className={`cf__svc cf__svc--${s.status}`}
            title={`${s.name}: ${s.status}`}
          >
            <span className="cf__svc-dot" aria-hidden="true" />
            <span className="cf__svc-name">{s.name}</span>
            <span className="cf__svc-status">{s.status}</span>
          </div>
        ))}
      </div>

      <div className="cf__ask">
        <span className="cf__ask-label">ask</span>
        <span className="cf__ask-q">{QUESTION}</span>
      </div>

      <div className="cf__cols">
        <div className="cf__retrieved">
          <div className="cf__panel-head">
            retrieved candidates
            <span className="cf__panel-count">
              {stage === 'idle' ? liveCandidates.length : revealed}/
              {liveCandidates.length}
            </span>
          </div>
          <ul className="cf__cand-list">
            {liveCandidates.map((c, i) => {
              const shown = stage === 'idle' || i < revealed;
              const isCited = CITED.includes(c.id);
              return (
                <motion.li
                  key={c.id}
                  className={`cf__cand cf__cand--${c.kind}${
                    isCited && stage === 'answered' ? ' cf__cand--cited' : ''
                  }`}
                  initial={false}
                  animate={{
                    opacity: shown ? 1 : 0.18,
                    x: shown ? 0 : reduce ? 0 : -6,
                  }}
                  transition={{ duration: 0.25, ease }}
                >
                  <div className="cf__cand-top">
                    <span className="cf__cand-id">{c.id}</span>
                    <span className="cf__cand-score">{c.score.toFixed(2)}</span>
                  </div>
                  <div className="cf__cand-src">{c.source}</div>
                  <div className="cf__cand-text">{c.text}</div>
                  <button
                    className="cf__cand-toggle"
                    onClick={() => toggle(c.id)}
                    disabled={running}
                    aria-label={`Remove ${c.id} from retrieved set`}
                  >
                    in set
                  </button>
                </motion.li>
              );
            })}
          </ul>

          {missingCited.length > 0 && (
            <div className="cf__dropped" role="status">
              {missingCited.length} cited source
              {missingCited.length > 1 ? 's' : ''} removed from the set:{' '}
              {missingCited.join(', ')}
            </div>
          )}
          {missingCited.length === 0 && (
            <div className="cf__droppedwrap">
              {CANDIDATES.filter((c) => !present[c.id]).map((c) => (
                <button
                  key={c.id}
                  className="cf__restore"
                  onClick={() => toggle(c.id)}
                  disabled={running}
                >
                  restore {c.id}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="cf__answer">
          <div className="cf__panel-head">grounded answer</div>

          <div className="cf__check" aria-live="polite">
            <div className="cf__check-head">citation check</div>
            <ul className="cf__check-list">
              {CITED.map((id, i) => {
                const ok = present[id];
                const active = stage !== 'idle' && (stage === 'answered' || i < checked);
                return (
                  <li
                    key={id}
                    className={`cf__check-row${active ? ' cf__check-row--on' : ''} ${
                      ok ? 'cf__check-row--ok' : 'cf__check-row--bad'
                    }`}
                  >
                    <span className="cf__check-mark" aria-hidden="true">
                      {active ? (ok ? '+' : 'x') : ''}
                    </span>
                    <span className="cf__check-id">{id}</span>
                    <span className="cf__check-state">
                      {active ? (ok ? 'in set' : 'not retrieved') : '...'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <AnimatePresence mode="wait">
            {stage === 'answered' && grounded && (
              <motion.div
                key="ok"
                className="cf__result cf__result--ok"
                initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease }}
              >
                <p className="cf__result-text">
                  Inventory was evicted at 13:59:51, so orders exhausted its
                  connection pool waiting on inventory and error-rate spiked at
                  14:00.
                </p>
                <div className="cf__result-cites">
                  {CITED.map((id) => (
                    <span key={id} className="cf__cite">
                      {id}
                    </span>
                  ))}
                </div>
                <div className="cf__result-tag">
                  property holds: every cited id is in the retrieved set
                </div>
              </motion.div>
            )}
            {stage === 'answered' && !grounded && (
              <motion.div
                key="bad"
                className="cf__result cf__result--bad"
                initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease }}
              >
                <p className="cf__result-text">
                  Answer rejected. The assistant tried to cite{' '}
                  {missingCited.join(', ')}, which was not in the retrieved
                  candidate set.
                </p>
                <div className="cf__result-tag">
                  property fails: a cited id was never retrieved
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={ask} disabled={running}>
          {running ? 'Retrieving…' : 'Ask the assistant'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {grounded
            ? 'all 3 cited ids in the set'
            : `${missingCited.length} cited id removed`}
        </span>
      </div>
    </div>
  );
}
