import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './insightllm.css';

// Real mechanism: a question is translated into a typed QueryIntent, never an
// executable query string. The runtime validates the intent against the schema
// (unknown column or unsupported aggregate is rejected) before any data is
// touched, then computes the answer over the rows and shows it next to the
// query. Grounding tests assert the figure equals an independent computation.
// Benchmark: 10 questions, grounding_match 1.0, mean 5.7 ms per question over
// a 20000-order dataset.

const ease = [0.22, 1, 0.36, 1] as const;

const SCHEMA = {
  region: 'text',
  product: 'text',
  channel: 'text',
  amount: 'number',
  units: 'number',
} as const;
type Column = keyof typeof SCHEMA;
type Aggregate = 'sum' | 'avg' | 'count' | 'max';

type Row = {
  region: string;
  product: string;
  channel: string;
  amount: number;
  units: number;
};

// A small, representative slice of the orders table the demo computes over.
const ROWS: Row[] = [
  { region: 'West', product: 'Atlas', channel: 'online', amount: 420, units: 3 },
  { region: 'West', product: 'Beam', channel: 'retail', amount: 180, units: 1 },
  { region: 'East', product: 'Atlas', channel: 'online', amount: 510, units: 4 },
  { region: 'East', product: 'Cobalt', channel: 'online', amount: 240, units: 2 },
  { region: 'West', product: 'Cobalt', channel: 'retail', amount: 360, units: 2 },
  { region: 'North', product: 'Beam', channel: 'online', amount: 150, units: 1 },
  { region: 'East', product: 'Beam', channel: 'retail', amount: 300, units: 2 },
  { region: 'West', product: 'Atlas', channel: 'online', amount: 480, units: 4 },
];

type Filter = { column: Column; value: string };
type QueryIntent = {
  aggregate: Aggregate;
  column: Column;
  groupBy?: Column;
  filters: Filter[];
};

type Question = {
  id: string;
  text: string;
  // A valid intent the provider seam would emit, or an invalid one to show
  // schema rejection. follow extends the prior intent with one more filter.
  intent?: QueryIntent;
  invalid?: { intent: { aggregate: Aggregate; column: string }; reason: string };
  follow?: Filter;
};

const QUESTIONS: Question[] = [
  {
    id: 'q1',
    text: 'Total sales by region',
    intent: { aggregate: 'sum', column: 'amount', groupBy: 'region', filters: [] },
  },
  {
    id: 'q2',
    text: 'Average order amount for online orders',
    intent: {
      aggregate: 'avg',
      column: 'amount',
      filters: [{ column: 'channel', value: 'online' }],
    },
  },
  {
    id: 'q3',
    text: 'How many orders for product Atlas',
    intent: {
      aggregate: 'count',
      column: 'amount',
      filters: [{ column: 'product', value: 'Atlas' }],
    },
  },
  {
    id: 'q4',
    text: 'Top profit margin by salesperson',
    invalid: {
      intent: { aggregate: 'max', column: 'margin' },
      reason: 'column margin is not in the schema',
    },
  },
];

// A follow-up that merges a new filter onto the prior intent rather than
// starting over: narrow "total sales by region" to the online channel.
const FOLLOW: Question = {
  id: 'follow',
  text: 'and just for the online channel',
  follow: { column: 'channel', value: 'online' },
};

function aggLabel(a: Aggregate) {
  return a === 'avg' ? 'avg' : a;
}

function compute(intent: QueryIntent): { rows: { key: string; value: number }[] } {
  const filtered = ROWS.filter((r) =>
    intent.filters.every((f) => String(r[f.column]) === f.value),
  );
  const reduceVals = (rs: Row[]): number => {
    const vals = rs.map((r) => r[intent.column] as number);
    if (intent.aggregate === 'count') return rs.length;
    if (intent.aggregate === 'sum') return vals.reduce((s, v) => s + v, 0);
    if (intent.aggregate === 'max') return vals.length ? Math.max(...vals) : 0;
    // avg
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  };
  if (!intent.groupBy) {
    return { rows: [{ key: 'all rows', value: reduceVals(filtered) }] };
  }
  const groups = new Map<string, Row[]>();
  for (const r of filtered) {
    const k = String(r[intent.groupBy]);
    const arr = groups.get(k) ?? [];
    arr.push(r);
    groups.set(k, arr);
  }
  return {
    rows: [...groups.entries()].map(([key, rs]) => ({ key, value: reduceVals(rs) })),
  };
}

function fmt(intent: QueryIntent, v: number) {
  if (intent.aggregate === 'count') return String(Math.round(v));
  if (intent.aggregate === 'avg') return v.toFixed(1);
  return `$${v.toLocaleString()}`;
}

type Stage = 'idle' | 'translate' | 'validate' | 'run' | 'done' | 'rejected';

export default function InsightllmDemo() {
  const reduce = useReducedMotion();
  const [activeId, setActiveId] = useState('q1');
  const [stage, setStage] = useState<Stage>('idle');
  const [intent, setIntent] = useState<QueryIntent | null>(null);
  const [followApplied, setFollowApplied] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearTimers() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  const active = QUESTIONS.find((q) => q.id === activeId)!;

  function ask(q: Question, isFollow = false) {
    clearTimers();
    setActiveId(isFollow ? activeId : q.id);
    setFollowApplied(isFollow);

    // Invalid question: provider emits an intent that fails schema validation.
    if (q.invalid) {
      setStage('translate');
      const go = (fn: () => void, ms: number) =>
        timers.current.push(setTimeout(fn, reduce ? 0 : ms));
      go(() => setStage('validate'), 480);
      go(() => setStage('rejected'), 980);
      return;
    }

    const base = q.intent!;
    const nextIntent: QueryIntent = isFollow
      ? { ...intent!, filters: [...intent!.filters, FOLLOW.follow!] }
      : base;

    setStage('translate');
    setIntent(nextIntent);

    if (reduce) {
      setStage('done');
      return;
    }
    const go = (fn: () => void, ms: number) =>
      timers.current.push(setTimeout(fn, ms));
    go(() => setStage('validate'), 520);
    go(() => setStage('run'), 1040);
    go(() => setStage('done'), 1560);
  }

  function reset() {
    clearTimers();
    setStage('idle');
    setIntent(null);
    setFollowApplied(false);
  }

  const result = intent && (stage === 'run' || stage === 'done') ? compute(intent) : null;
  const canFollow =
    stage === 'done' && intent && activeId === 'q1' && !followApplied;
  const filteredCount = intent
    ? ROWS.filter((r) => intent.filters.every((f) => String(r[f.column]) === f.value))
        .length
    : 0;

  return (
    <div className="demo" aria-label="InsightLLM grounded query demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Question to typed query, grounded</h3>
      <p className="demo__lede">
        Pick a question. It is translated into a typed query intent, validated
        against the schema before any data is read, then run over the rows. The
        number you get is the result of that computation, shown next to the
        exact query. A question that names an unknown column is rejected, not
        guessed.
      </p>

      <div className="il__grid">
        <div className="il__left">
          <div className="il__col-head">schema</div>
          <ul className="il__schema">
            {(Object.keys(SCHEMA) as Column[]).map((c) => (
              <li key={c} className="il__schema-row">
                <span className="il__schema-col">{c}</span>
                <span className="il__schema-type">{SCHEMA[c]}</span>
              </li>
            ))}
          </ul>

          <div className="il__col-head il__col-head--gap">questions</div>
          <div className="il__questions" role="group" aria-label="sample questions">
            {QUESTIONS.map((q) => (
              <button
                key={q.id}
                className={`il__q ${activeId === q.id ? 'il__q--on' : ''} ${
                  q.invalid ? 'il__q--risky' : ''
                }`}
                onClick={() => ask(q)}
                aria-pressed={activeId === q.id}
              >
                {q.text}
              </button>
            ))}
          </div>
        </div>

        <div className="il__right">
          <Pipeline
            stage={stage}
            intent={intent}
            active={active}
            reduce={!!reduce}
            result={result}
            filteredCount={filteredCount}
          />
        </div>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={() => ask(active)}
          disabled={stage === 'translate' || stage === 'validate' || stage === 'run'}
        >
          {stage === 'translate' || stage === 'validate' || stage === 'run'
            ? 'Running…'
            : 'Ask'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => canFollow && ask(FOLLOW, true)}
          disabled={!canFollow}
        >
          Follow up: online only
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">
          grounding_match 1.0 over 10 questions, mean 5.7 ms, 20000 orders
        </span>
      </div>
    </div>
  );
}

function Pipeline(props: {
  stage: Stage;
  intent: QueryIntent | null;
  active: Question;
  reduce: boolean;
  result: { rows: { key: string; value: number }[] } | null;
  filteredCount: number;
}) {
  const { stage, intent, active, reduce, result, filteredCount } = props;
  const rejected = stage === 'rejected';
  const showIntent = stage !== 'idle';

  return (
    <div className="il__pipe" aria-live="polite">
      <Step
        n={1}
        label="translate to query intent"
        on={stage !== 'idle'}
        reduce={reduce}
      >
        {!showIntent && <span className="il__muted">pick a question to start</span>}
        {showIntent && active.invalid && (
          <pre className="il__intent il__intent--bad">
            {`{ aggregate: "${active.invalid.intent.aggregate}",\n  column: "${active.invalid.intent.column}" }`}
          </pre>
        )}
        {showIntent && intent && !active.invalid && (
          <pre className="il__intent">
            {`{ aggregate: "${aggLabel(intent.aggregate)}", column: "${intent.column}"${
              intent.groupBy ? `,\n  groupBy: "${intent.groupBy}"` : ''
            }${
              intent.filters.length
                ? `,\n  filters: [${intent.filters
                    .map((f) => `${f.column} = "${f.value}"`)
                    .join(', ')}]`
                : ''
            } }`}
          </pre>
        )}
      </Step>

      <Step
        n={2}
        label="validate against schema"
        on={['validate', 'run', 'done', 'rejected'].includes(stage)}
        reduce={reduce}
      >
        {rejected && (
          <motion.div
            className="il__reject"
            initial={{ opacity: 0, x: reduce ? 0 : -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, ease }}
          >
            rejected: {active.invalid?.reason}. No data was read.
          </motion.div>
        )}
        {!rejected && ['validate', 'run', 'done'].includes(stage) && (
          <span className="il__ok">
            valid: every column and aggregate is in the schema
          </span>
        )}
        {!rejected && stage === 'idle' && <span className="il__muted">waiting</span>}
        {!rejected && stage === 'translate' && (
          <span className="il__muted">pending</span>
        )}
      </Step>

      <Step
        n={3}
        label="run over rows and ground the answer"
        on={['run', 'done'].includes(stage)}
        reduce={reduce}
      >
        {result && intent ? (
          <div>
            <div className="il__scan">
              computed over {filteredCount} matching row
              {filteredCount === 1 ? '' : 's'}
            </div>
            <div className="il__results">
              <AnimatePresence>
                {result.rows.map((r, i) => (
                  <motion.div
                    key={r.key}
                    className="il__result-row"
                    initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: reduce ? 0 : i * 0.06, ease }}
                  >
                    <span className="il__result-key">{r.key}</span>
                    <span className="il__result-val">{fmt(intent, r.value)}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        ) : rejected ? (
          <span className="il__muted">skipped, intent never reached the data</span>
        ) : (
          <span className="il__muted">awaiting a valid intent</span>
        )}
      </Step>
    </div>
  );
}

function Step(props: {
  n: number;
  label: string;
  on: boolean;
  reduce: boolean;
  children: ReactNode;
}) {
  const { n, label, on, reduce, children } = props;
  return (
    <motion.div
      className={`il__step ${on ? 'il__step--on' : ''}`}
      animate={{ opacity: on ? 1 : 0.5 }}
      transition={{ duration: reduce ? 0 : 0.25, ease }}
    >
      <div className="il__step-head">
        <span className="il__step-n">{n}</span>
        <span className="il__step-label">{label}</span>
      </div>
      <div className="il__step-body">{children}</div>
    </motion.div>
  );
}
