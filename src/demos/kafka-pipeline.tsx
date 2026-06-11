import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './kafka-pipeline.css';

// Real mechanism from the project. Events are consumed from Kafka, validated
// against a schema, transformed by a declarative rule engine compiled once at
// startup, then written to Postgres via an idempotent UPSERT keyed by
// (source_topic, partition, record_offset). Schema violations and transform
// failures both route to a dead-letter topic carrying structured reason and
// detail headers. Rule kinds: lookup, regex, aggregate, coalesce, case_convert,
// to_iso8601, enum_constant.

type Stage = 'queued' | 'validate' | 'transform' | 'upsert' | 'dlq';

type Rec = {
  id: string;
  offset: number;
  topic: string;
  payload: Record<string, string>;
  // If set, this record fails at the named stage with a structured violation.
  fail?: {
    at: 'validate' | 'transform';
    field: string;
    expected: string;
    actual: string;
    reason: string;
    rule?: string;
  };
};

const TOPIC = 'orders.v1';
const PARTITION = 3;

const RECORDS: Rec[] = [
  {
    id: 'r0',
    offset: 8801,
    topic: TOPIC,
    payload: { region: 'emea', status: 'PAID', amount: '42.00' },
  },
  {
    id: 'r1',
    offset: 8802,
    topic: TOPIC,
    payload: { region: 'us', status: 'pending', amount: '120.50' },
    fail: {
      at: 'transform',
      field: 'status',
      expected: 'enum{PAID,PENDING,VOID}',
      actual: 'pending',
      reason: 'case_convert produced value outside enum_constant set',
      rule: 'enum_constant',
    },
  },
  {
    id: 'r2',
    offset: 8803,
    topic: TOPIC,
    payload: { region: 'apac', status: 'PAID', amount: '7.25' },
  },
  {
    id: 'r3',
    offset: 8804,
    topic: TOPIC,
    payload: { region: 'emea', status: 'VOID', amount: 'NaN' },
    fail: {
      at: 'validate',
      field: 'amount',
      expected: 'number',
      actual: '"NaN"',
      reason: 'schema type mismatch',
    },
  },
  {
    id: 'r4',
    offset: 8805,
    topic: TOPIC,
    payload: { region: 'us', status: 'PAID', amount: '310.00' },
  },
  {
    id: 'r5',
    offset: 8806,
    topic: TOPIC,
    payload: { region: 'latam', status: 'PAID', amount: '15.00' },
  },
];

const STAGE_LABEL: Record<Stage, string> = {
  queued: 'consumed',
  validate: 'schema validate',
  transform: 'rule engine',
  upsert: 'postgres upsert',
  dlq: 'dead-letter',
};

const RULE_KINDS = [
  'lookup',
  'regex',
  'aggregate',
  'coalesce',
  'case_convert',
  'to_iso8601',
  'enum_constant',
];

const ease = [0.22, 1, 0.36, 1] as const;

export default function KafkaPipelineDemo() {
  const reduce = useReducedMotion();
  const [stageOf, setStageOf] = useState<Record<string, Stage>>(() =>
    Object.fromEntries(RECORDS.map((r) => [r.id, 'queued' as Stage])),
  );
  const [running, setRunning] = useState(false);
  const [cursor, setCursor] = useState(-1); // index of the record in flight
  const [inspect, setInspect] = useState<string | null>('r1');
  const timer = useRef<number | null>(null);

  function stop() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => stop, []);

  function setStage(id: string, s: Stage) {
    setStageOf((prev) => ({ ...prev, [id]: s }));
  }

  function reset() {
    stop();
    setRunning(false);
    setCursor(-1);
    setStageOf(Object.fromEntries(RECORDS.map((r) => [r.id, 'queued' as Stage])));
  }

  function finalStage(r: Rec): Stage {
    return r.fail ? 'dlq' : 'upsert';
  }

  function run() {
    stop();
    setRunning(true);
    setCursor(-1);
    setStageOf(Object.fromEntries(RECORDS.map((r) => [r.id, 'queued' as Stage])));

    if (reduce) {
      const final: Record<string, Stage> = {};
      RECORDS.forEach((r) => {
        final[r.id] = finalStage(r);
      });
      setStageOf(final);
      setCursor(RECORDS.length - 1);
      setRunning(false);
      return;
    }

    let i = 0;
    let phase = 0; // 0 validate, 1 transform, 2 final
    const advance = () => {
      const r = RECORDS[i];
      if (phase === 0) {
        setCursor(i);
        setStage(r.id, 'validate');
        if (r.fail?.at === 'validate') {
          phase = 2;
          timer.current = window.setTimeout(() => {
            setStage(r.id, 'dlq');
            nextRecord();
          }, 360);
          return;
        }
        phase = 1;
        timer.current = window.setTimeout(advance, 300);
      } else if (phase === 1) {
        setStage(r.id, 'transform');
        if (r.fail?.at === 'transform') {
          phase = 2;
          timer.current = window.setTimeout(() => {
            setStage(r.id, 'dlq');
            nextRecord();
          }, 360);
          return;
        }
        phase = 2;
        timer.current = window.setTimeout(advance, 300);
      } else {
        setStage(r.id, 'upsert');
        timer.current = window.setTimeout(nextRecord, 300);
      }
    };
    const nextRecord = () => {
      i += 1;
      phase = 0;
      if (i >= RECORDS.length) {
        setRunning(false);
        setCursor(RECORDS.length - 1);
        timer.current = null;
        return;
      }
      timer.current = window.setTimeout(advance, 160);
    };
    timer.current = window.setTimeout(advance, 200);
  }

  const written = RECORDS.filter((r) => stageOf[r.id] === 'upsert').length;
  const dead = RECORDS.filter((r) => stageOf[r.id] === 'dlq').length;
  const inspectRec = inspect ? RECORDS.find((r) => r.id === inspect) : null;

  return (
    <div className="demo" aria-label="kafka-pipeline event flow demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Validate, transform, then fork the bad ones</h3>
      <p className="demo__lede">
        Play a batch through schema validation and the YAML rule engine into
        Postgres. Clean records land via an idempotent UPSERT keyed by
        (source_topic, partition, record_offset). Schema violations and transform
        failures fork to a dead-letter topic tagged with a structured reason.
        Click any record to inspect its outcome.
      </p>

      <div className="kp__flow" aria-hidden="true">
        {(['queued', 'validate', 'transform', 'upsert'] as Stage[]).map((s, i) => (
          <div className="kp__flow-step" key={s}>
            <span className="kp__flow-name">{STAGE_LABEL[s]}</span>
            {i < 3 && <span className="kp__flow-arrow">{'->'}</span>}
          </div>
        ))}
        <div className="kp__flow-step kp__flow-step--dlq">
          <span className="kp__flow-fork">{'⤷'}</span>
          <span className="kp__flow-name">{STAGE_LABEL.dlq}</span>
        </div>
      </div>

      <ul className="kp__records">
        {RECORDS.map((r, i) => {
          const stage = stageOf[r.id];
          const inFlight = running && cursor === i && stage !== 'upsert' && stage !== 'dlq';
          return (
            <li key={r.id}>
              <motion.button
                type="button"
                className={`kp__rec kp__rec--${stage} ${
                  inspect === r.id ? 'kp__rec--sel' : ''
                } ${inFlight ? 'kp__rec--flight' : ''}`}
                onClick={() => setInspect(r.id)}
                aria-pressed={inspect === r.id}
                aria-label={`offset ${r.offset}, ${STAGE_LABEL[stage]}`}
                initial={false}
                animate={{ x: 0 }}
                transition={{ duration: reduce ? 0 : 0.25, ease }}
              >
                <span className="kp__rec-off">@{r.offset}</span>
                <span className="kp__rec-pay">
                  {r.payload.region} / {r.payload.status} / {r.payload.amount}
                </span>
                <span className="kp__rec-stage">{STAGE_LABEL[stage]}</span>
              </motion.button>
            </li>
          );
        })}
      </ul>

      <div className="kp__bins">
        <div className="kp__bin kp__bin--db">
          <div className="kp__bin-head">
            postgres
            <span className="kp__bin-count">{written}</span>
          </div>
          <div className="kp__bin-sub">idempotent UPSERT, at-least-once safe</div>
        </div>
        <div className="kp__bin kp__bin--dlq">
          <div className="kp__bin-head">
            dead-letter topic
            <span className="kp__bin-count">{dead}</span>
          </div>
          <div className="kp__bin-sub">reason + detail headers attached</div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {inspectRec && (
          <motion.div
            className="kp__inspect"
            key={inspectRec.id}
            initial={{ opacity: 0, y: reduce ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -6 }}
            transition={{ duration: reduce ? 0 : 0.22, ease }}
          >
            <div className="kp__inspect-head">
              <span className="kp__inspect-key">
                {inspectRec.topic} / p{PARTITION} / @{inspectRec.offset}
              </span>
              <span
                className={`kp__inspect-tag ${
                  inspectRec.fail ? 'kp__inspect-tag--dlq' : 'kp__inspect-tag--ok'
                }`}
              >
                {inspectRec.fail ? 'dead-letter' : 'upserted'}
              </span>
            </div>
            {inspectRec.fail ? (
              <dl className="kp__violation">
                <div>
                  <dt>field</dt>
                  <dd>{inspectRec.fail.field}</dd>
                </div>
                <div>
                  <dt>expected</dt>
                  <dd>{inspectRec.fail.expected}</dd>
                </div>
                <div>
                  <dt>actual</dt>
                  <dd>{inspectRec.fail.actual}</dd>
                </div>
                <div>
                  <dt>reason</dt>
                  <dd>{inspectRec.fail.reason}</dd>
                </div>
                {inspectRec.fail.rule && (
                  <div>
                    <dt>rule</dt>
                    <dd>{inspectRec.fail.rule}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="kp__inspect-ok">
                Passed schema validation and the rule engine, then written with
                ON CONFLICT (source_topic, partition, record_offset) DO UPDATE so
                a redelivery cannot double-write.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="kp__rules" aria-label="available rule kinds">
        {RULE_KINDS.map((k) => (
          <span
            key={k}
            className={`kp__rule ${
              inspectRec?.fail?.rule === k ? 'kp__rule--hit' : ''
            }`}
          >
            {k}
          </span>
        ))}
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Streaming…' : 'Play the batch'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {written + dead === RECORDS.length && !running
            ? `${written} upserted, ${dead} to dead-letter`
            : `${RECORDS.length} records on ${TOPIC} partition ${PARTITION}`}
        </span>
      </div>
    </div>
  );
}
