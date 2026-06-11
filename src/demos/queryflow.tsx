import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './queryflow.css';

// Real numbers from the project: pgvector retrieves top-20 schema chunks, a
// keyword-overlap rerank narrows to top-8, SQL is grounded only in those, and
// every candidate clears Parse, Safety (AST walk), and EXPLAIN (rejecting plans
// over a 1,000,000 estimated-row cap) before it runs.
const TOP_VECTOR = 20;
const TOP_RERANK = 8;
const MAX_ROWS = 1_000_000;

type Chunk = { id: string; table: string; col: string; score: number };

// The retrieval corpus: schema chunks scored against the question. Sensitive
// columns (password, token, ssn, card_number) are redacted before embedding,
// so they never surface here.
const corpus: Chunk[] = [
  { id: 'c1', table: 'orders', col: 'total_cents', score: 0.94 },
  { id: 'c2', table: 'orders', col: 'created_at', score: 0.91 },
  { id: 'c3', table: 'customers', col: 'region', score: 0.88 },
  { id: 'c4', table: 'orders', col: 'customer_id', score: 0.86 },
  { id: 'c5', table: 'customers', col: 'id', score: 0.83 },
  { id: 'c6', table: 'order_items', col: 'qty', score: 0.71 },
  { id: 'c7', table: 'products', col: 'name', score: 0.64 },
  { id: 'c8', table: 'shipments', col: 'carrier', score: 0.52 },
];

type Cand = {
  id: string;
  label: string;
  sql: string;
  parse: boolean;
  safety: 'pass' | 'reject';
  safetyReason?: string;
  rows: number;
};

// Three candidate SQL drafts, one verified, two caught by a different gate.
const candidates: Cand[] = [
  {
    id: 'good',
    label: 'Grounded SELECT',
    sql:
      'SELECT c.region, SUM(o.total_cents)\n' +
      'FROM orders o JOIN customers c\n' +
      '  ON o.customer_id = c.id\n' +
      "WHERE o.created_at >= '2024-01-01'\n" +
      'GROUP BY c.region;',
    parse: true,
    safety: 'pass',
    rows: 412,
  },
  {
    id: 'ddl',
    label: 'Hidden DROP',
    sql:
      'SELECT region FROM customers;\n' +
      'DROP TABLE audit_log;',
    parse: true,
    safety: 'reject',
    safetyReason: 'AST walk found DDL (DROP)',
    rows: 0,
  },
  {
    id: 'scan',
    label: 'Unbounded scan',
    sql:
      'SELECT o.*, c.*\n' +
      'FROM orders o CROSS JOIN customers c;',
    parse: true,
    safety: 'pass',
    rows: 4_200_000,
  },
];

type Stage = 'idle' | 'retrieve' | 'rerank' | 'draft' | 'parse' | 'safety' | 'explain' | 'done';
const order: Stage[] = ['retrieve', 'rerank', 'draft', 'parse', 'safety', 'explain', 'done'];

type GateState = 'idle' | 'run' | 'pass' | 'reject';

export default function QueryflowDemo() {
  const reduce = useReducedMotion();
  const [candId, setCandId] = useState('good');
  const [stage, setStage] = useState<Stage>('idle');
  const [running, setRunning] = useState(false);
  const timers = useRef<number[]>([]);

  const cand = candidates.find((c) => c.id === candId)!;
  const retrieved = corpus.slice(0, TOP_RERANK);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  // Gate verdicts derive from the active candidate and how far the run got.
  const reached = (s: Stage) => order.indexOf(stage) >= order.indexOf(s);
  const parseGate: GateState = !reached('parse')
    ? 'idle'
    : stage === 'parse'
      ? 'run'
      : cand.parse
        ? 'pass'
        : 'reject';
  const safetyGate: GateState = !reached('safety') || !cand.parse
    ? 'idle'
    : stage === 'safety'
      ? 'run'
      : cand.safety === 'pass'
        ? 'pass'
        : 'reject';
  const explainOk = cand.rows <= MAX_ROWS;
  const explainGate: GateState =
    !reached('explain') || !cand.parse || cand.safety === 'reject'
      ? 'idle'
      : stage === 'explain'
        ? 'run'
        : explainOk
          ? 'pass'
          : 'reject';

  const verified =
    stage === 'done' && cand.parse && cand.safety === 'pass' && explainOk;
  const rejected = stage === 'done' && !verified;

  function pick(id: string) {
    if (running) return;
    setCandId(id);
    setStage('idle');
  }

  function run() {
    if (running) return;
    clearTimers();
    setRunning(true);
    setStage('idle');

    if (reduce) {
      setStage('done');
      setRunning(false);
      return;
    }
    const step = 760;
    order.forEach((s, i) => {
      const t = window.setTimeout(() => {
        setStage(s);
        if (s === 'done') setRunning(false);
      }, step * (i + 1));
      timers.current.push(t);
    });
  }

  function reset() {
    clearTimers();
    setRunning(false);
    setStage('idle');
  }

  const rejectReason = rejected
    ? !cand.parse
      ? 'parse error'
      : cand.safety === 'reject'
        ? cand.safetyReason
        : `EXPLAIN estimate ${cand.rows.toLocaleString()} rows over the ${MAX_ROWS.toLocaleString()} cap`
    : '';

  return (
    <div className="demo" aria-label="QueryFlow retrieval and verification demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">From question to verified SQL</h3>
      <p className="demo__lede">
        One English question grounds against retrieved schema, drafts SQL, then
        passes three gates. Pick a draft and run it to see Parse, the AST safety
        walk, and the EXPLAIN row cap stamp it before any result renders.
      </p>

      <div className="qf__question">
        <span className="qf__q-mark">?</span>
        <span className="qf__q-text">
          Total order revenue by customer region this year
        </span>
      </div>

      <div className="qf__stage">
        <section className="qf__retrieval" aria-label="schema retrieval">
          <div className="qf__panel-head">
            <span>pgvector retrieval</span>
            <span className="qf__panel-meta">
              top {TOP_VECTOR} &rarr; rerank {TOP_RERANK}
            </span>
          </div>
          <ul className="qf__chunks">
            {retrieved.map((ch, i) => {
              const lit = reached('retrieve');
              const kept = reached('rerank');
              return (
                <motion.li
                  key={ch.id}
                  className={
                    'qf__chunk' + (kept ? ' qf__chunk--kept' : lit ? ' qf__chunk--lit' : '')
                  }
                  initial={false}
                  animate={{
                    opacity: lit ? 1 : 0.4,
                    x: 0,
                  }}
                  transition={{
                    duration: reduce ? 0 : 0.3,
                    delay: reduce ? 0 : (lit ? i * 0.05 : 0),
                  }}
                >
                  <span className="qf__chunk-tbl">{ch.table}</span>
                  <span className="qf__chunk-col">.{ch.col}</span>
                  <span className="qf__chunk-score">{ch.score.toFixed(2)}</span>
                </motion.li>
              );
            })}
          </ul>
          <p className="qf__redact">
            password, token, ssn, card_number redacted before embedding
          </p>
        </section>

        <section className="qf__draft" aria-label="drafted SQL">
          <div className="qf__panel-head">
            <span>Drafted SQL</span>
            <span className="qf__panel-meta">grounded in retrieved chunks</span>
          </div>
          <AnimatePresence mode="wait">
            <motion.pre
              key={cand.id + (reached('draft') ? '-on' : '-off')}
              className="qf__sql"
              initial={{ opacity: reduce ? 1 : 0 }}
              animate={{ opacity: reached('draft') ? 1 : 0.25 }}
              transition={{ duration: reduce ? 0 : 0.35 }}
            >
              <code>{cand.sql}</code>
            </motion.pre>
          </AnimatePresence>
        </section>
      </div>

      <div className="qf__gates" role="group" aria-label="verification gates">
        <Gate
          n={1}
          name="Parse"
          state={parseGate}
          okText="valid SQL"
          runText="parsing"
          rejectText="parse error"
        />
        <Gate
          n={2}
          name="Safety"
          state={safetyGate}
          okText="AST walk clean"
          runText="walking AST"
          rejectText={cand.safetyReason ?? 'unsafe node'}
        />
        <Gate
          n={3}
          name="EXPLAIN"
          state={explainGate}
          okText={`${cand.rows.toLocaleString()} rows`}
          runText="estimating rows"
          rejectText={`${cand.rows.toLocaleString()} over cap`}
        />
      </div>

      <AnimatePresence>
        {(verified || rejected) && (
          <motion.div
            className={'qf__verdict' + (rejected ? ' qf__verdict--reject' : '')}
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            role="status"
          >
            {verified ? (
              <>
                <span className="qf__verdict-head">Verified, executed</span>
                <table className="qf__result">
                  <thead>
                    <tr>
                      <th>region</th>
                      <th>revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>west</td>
                      <td>$184,920</td>
                    </tr>
                    <tr>
                      <td>east</td>
                      <td>$151,338</td>
                    </tr>
                    <tr>
                      <td>central</td>
                      <td>$ 96,705</td>
                    </tr>
                  </tbody>
                </table>
              </>
            ) : (
              <>
                <span className="qf__verdict-head">Rejected before execution</span>
                <span className="qf__verdict-text">{rejectReason}</span>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <div className="qf__picker" role="tablist" aria-label="pick a SQL draft">
          {candidates.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={c.id === candId}
              className={'qf__pick' + (c.id === candId ? ' qf__pick--on' : '')}
              onClick={() => pick(c.id)}
              disabled={running}
            >
              {c.label}
            </button>
          ))}
        </div>
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Verifying…' : 'Run pipeline'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function Gate({
  n,
  name,
  state,
  okText,
  runText,
  rejectText,
}: {
  n: number;
  name: string;
  state: GateState;
  okText: string;
  runText: string;
  rejectText: string;
}) {
  const reduce = useReducedMotion();
  const label =
    state === 'pass'
      ? okText
      : state === 'reject'
        ? rejectText
        : state === 'run'
          ? runText
          : 'waiting';
  return (
    <motion.div
      className={`qf__gate qf__gate--${state}`}
      animate={
        state === 'run' && !reduce
          ? { boxShadow: '0 0 0 2px var(--accent-line)' }
          : { boxShadow: '0 0 0 0px transparent' }
      }
      transition={{ duration: 0.3, repeat: state === 'run' ? Infinity : 0, repeatType: 'reverse' }}
    >
      <div className="qf__gate-top">
        <span className="qf__gate-n">{n}</span>
        <span className="qf__gate-name">{name}</span>
        <span className="qf__gate-stamp" aria-hidden="true">
          {state === 'pass' ? '✓' : state === 'reject' ? '✕' : state === 'run' ? '…' : ''}
        </span>
      </div>
      <div className="qf__gate-label">{label}</div>
    </motion.div>
  );
}
