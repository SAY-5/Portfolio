import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './task-processor.css';

// Real numbers from the project: a 1000-task integration test with 3 consumer
// replicas recorded 950 completed, 50 routed to DLQ, 0 task_id present in both
// tables, with a 45.9 s processing wall. Effective exactly-once comes from a
// DynamoDB PutItem with ConditionExpression attribute_not_exists(task_id) as
// the only critical section, no locks or Redis.
const TOTAL = 1000;
const COMPLETED = 950;
const DLQ = 50;
const WALL_S = 45.9;
const REPLICAS = 3;

type Step = {
  id: number;
  label: string;
  detail: string;
};

// One representative task per outcome, stepped so the viewer can see the
// conditional put win, a duplicate lose, and a poison task fall to the DLQ.
type Outcome = 'unique' | 'duplicate' | 'poison';

const scenarios: Record<Outcome, Step[]> = {
  unique: [
    { id: 0, label: 'SQS receive', detail: 'task t-417 pulled by consumer-2' },
    {
      id: 1,
      label: 'Conditional put',
      detail: 'PutItem attribute_not_exists(task_id) succeeds',
    },
    { id: 2, label: 'Process', detail: 'handler runs, state = COMPLETED' },
    { id: 3, label: 'Ack', detail: 'message deleted from queue' },
  ],
  duplicate: [
    {
      id: 0,
      label: 'SQS receive',
      detail: 'task t-417 redelivered to consumer-0',
    },
    {
      id: 1,
      label: 'Conditional put',
      detail: 'ConditionalCheckFailed, task_id already present',
    },
    { id: 2, label: 'Skip', detail: 'duplicate dropped, no second run' },
    { id: 3, label: 'Ack', detail: 'redelivery deleted, exactly-once held' },
  ],
  poison: [
    { id: 0, label: 'SQS receive', detail: 'task t-883 pulled by consumer-1' },
    {
      id: 1,
      label: 'Conditional put',
      detail: 'PutItem succeeds, state = IN_PROGRESS',
    },
    {
      id: 2,
      label: 'Retry',
      detail: 'handler throws, attempts exhausted (3/3)',
    },
    {
      id: 3,
      label: 'DLQ route',
      detail: 'written to tasks_dlq table and tasks-dlq queue',
    },
  ],
};

const outcomeLabels: Record<Outcome, string> = {
  unique: 'Unique task',
  duplicate: 'Duplicate delivery',
  poison: 'Poison task',
};

const ease = [0.22, 1, 0.36, 1] as const;

export default function TaskProcessorDemo() {
  const reduce = useReducedMotion();
  const [outcome, setOutcome] = useState<Outcome>('duplicate');
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [replayed, setReplayed] = useState(false);
  const timerRef = useRef<number | null>(null);

  const steps = scenarios[outcome];
  const finished = step >= steps.length - 1;
  const isPoison = outcome === 'poison';

  function stop() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }
  useEffect(() => stop, []);

  function pick(o: Outcome) {
    if (playing) return;
    stop();
    setOutcome(o);
    setStep(-1);
    setReplayed(false);
  }

  function play() {
    if (playing) return;
    setStep(-1);
    setReplayed(false);
    setPlaying(true);

    if (reduce) {
      setStep(steps.length - 1);
      setPlaying(false);
      return;
    }

    let s = -1;
    timerRef.current = window.setInterval(() => {
      s += 1;
      setStep(s);
      if (s >= steps.length - 1) {
        stop();
        setPlaying(false);
      }
    }, 720);
  }

  function stepForward() {
    if (playing) return;
    setStep((s) => Math.min(steps.length - 1, s + 1));
  }

  function replay() {
    setReplayed(true);
    setOutcome('unique');
    setStep(-1);
  }

  return (
    <div className="demo" aria-label="task-processor pipeline demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Exactly-once from at-least-once SQS</h3>
      <p className="demo__lede">
        Pick a task and step it through the pipeline. The only critical section
        is a DynamoDB PutItem with ConditionExpression
        attribute_not_exists(task_id): a unique task commits, a duplicate
        delivery loses the race, and a poison task retries then routes to the
        dual dead-letter queue you can replay.
      </p>

      <div className="tp__picker" role="tablist" aria-label="Task outcome">
        {(Object.keys(scenarios) as Outcome[]).map((o) => (
          <button
            key={o}
            role="tab"
            aria-selected={outcome === o}
            className={`tp__pick ${outcome === o ? 'tp__pick--on' : ''}`}
            onClick={() => pick(o)}
            disabled={playing}
          >
            {outcomeLabels[o]}
          </button>
        ))}
      </div>

      <div className="tp__stage">
        <div className="tp__lane" aria-label="consumer replicas">
          <div className="tp__source">
            <span className="tp__source-name">tasks SQS</span>
            <span className="tp__source-sub">at-least-once</span>
          </div>
          <div className="tp__consumers">
            {Array.from({ length: REPLICAS }, (_, i) => (
              <div
                key={i}
                className={`tp__consumer ${
                  step >= 0 && i === (outcome === 'duplicate' ? 0 : outcome === 'poison' ? 1 : 2)
                    ? 'tp__consumer--active'
                    : ''
                }`}
              >
                consumer-{i}
              </div>
            ))}
          </div>
          <div
            className={`tp__sink ${
              isPoison && finished ? 'tp__sink--dlq' : finished ? 'tp__sink--done' : ''
            }`}
          >
            <span className="tp__sink-name">
              {isPoison ? 'dual DLQ' : 'DynamoDB tasks'}
            </span>
            <span className="tp__sink-sub">
              {isPoison ? 'table + queue' : 'source of truth'}
            </span>
          </div>
        </div>

        <ol className="tp__steps">
          {steps.map((st, i) => {
            const active = i === step;
            const passed = i < step || finished;
            const isConflict =
              outcome === 'duplicate' && st.label === 'Conditional put';
            return (
              <motion.li
                key={st.id}
                className={`tp__step ${active ? 'tp__step--active' : ''} ${
                  passed ? 'tp__step--passed' : ''
                } ${isConflict && (active || passed) ? 'tp__step--conflict' : ''}`}
                initial={false}
                animate={{
                  opacity: i <= step ? 1 : 0.4,
                  x: active && !reduce ? [6, 0] : 0,
                }}
                transition={{ duration: reduce ? 0 : 0.3, ease }}
              >
                <span className="tp__step-idx">{i + 1}</span>
                <span className="tp__step-body">
                  <span className="tp__step-label">{st.label}</span>
                  <span className="tp__step-detail">{st.detail}</span>
                </span>
              </motion.li>
            );
          })}
        </ol>

        <AnimatePresence>
          {finished && (
            <motion.div
              className={`tp__result ${isPoison ? 'tp__result--dlq' : ''}`}
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease }}
            >
              {outcome === 'unique' && (
                <span className="tp__result-text">
                  {replayed
                    ? 'Replayed task re-entered the main queue and completed cleanly.'
                    : 'Task committed once and acked. No duplicate run, state COMPLETED.'}
                </span>
              )}
              {outcome === 'duplicate' && (
                <span className="tp__result-text">
                  The conditional put failed because task_id already existed, so
                  the redelivery was dropped. That is how a task never lands in
                  both tables.
                </span>
              )}
              {isPoison && (
                <div className="tp__result-dlqrow">
                  <span className="tp__result-text">
                    Retries exhausted. Task t-883 sits in the queryable
                    tasks_dlq table and the replayable tasks-dlq queue.
                  </span>
                  <button
                    className="demo__btn"
                    onClick={replay}
                    disabled={playing}
                  >
                    Replay from DLQ
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="tp__metrics">
          <div className="tp__metric">
            <div className="tp__metric-val">{COMPLETED}</div>
            <div className="tp__metric-name">completed</div>
          </div>
          <div className="tp__metric tp__metric--dlq">
            <div className="tp__metric-val">{DLQ}</div>
            <div className="tp__metric-name">routed to DLQ</div>
          </div>
          <div className="tp__metric">
            <div className="tp__metric-val">0</div>
            <div className="tp__metric-name">task_id in both tables</div>
          </div>
          <div className="tp__metric">
            <div className="tp__metric-val">{WALL_S}s</div>
            <div className="tp__metric-name">wall, {TOTAL} tasks</div>
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={play} disabled={playing}>
          {playing ? 'Running…' : 'Play pipeline'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={stepForward}
          disabled={playing || finished}
        >
          Step
        </button>
        <span className="demo__hint">
          {step < 0
            ? 'press play or step'
            : `step ${step + 1} of ${steps.length}`}
        </span>
      </div>
    </div>
  );
}
