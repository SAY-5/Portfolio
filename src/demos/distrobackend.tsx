import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './distrobackend.css';

// Real mechanism from the project: messages publish over HTTP onto a topic and
// a worker consumes them. v3 adds idempotency keys (a duplicate key is rejected
// before delivery), exponential-backoff retry on a failing handler, and a
// dead-letter queue that catches a message once retries are exhausted. The bus
// contract is the seam: the in-memory implementation here matches the Kafka one.
const MAX_ATTEMPTS = 4; // attempt 1 plus 3 retries, then dead-letter
const BACKOFF_MS = [0, 100, 200, 400]; // exponential backoff per attempt

type Stage = 'published' | 'topic' | 'retrying' | 'delivered' | 'dlq' | 'rejected';

type Msg = {
  id: number;
  key: string;
  stage: Stage;
  attempt: number;
  willFail: boolean; // whether the worker rejects this message
  failsFor: number; // how many attempts fail before it would succeed
};

const ease = [0.22, 1, 0.36, 1] as const;
const KEYS = ['order-1', 'order-2', 'order-3', 'order-4', 'order-5'];

export default function DistroBackendDemo() {
  const reduce = useReducedMotion();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [seenKeys, setSeenKeys] = useState<Set<string>>(new Set());
  const [failMode, setFailMode] = useState(false);
  const [counts, setCounts] = useState({ delivered: 0, dlq: 0, rejected: 0, retries: 0 });
  const nextId = useRef(0);
  const keyCursor = useRef(0);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const schedule = useCallback(
    (fn: () => void, ms: number) => {
      const t = window.setTimeout(fn, reduce ? 0 : ms);
      timers.current.push(t);
    },
    [reduce],
  );

  const setStage = useCallback((id: number, patch: Partial<Msg>) => {
    setMsgs((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  // Drive one message through the bus: idempotency check, then attempt loop
  // with exponential backoff, ending in delivered or dead-lettered.
  const run = useCallback(
    (msg: Msg, duplicate: boolean) => {
      if (duplicate) {
        // Idempotency key already seen: the bus rejects before any delivery.
        schedule(() => {
          setStage(msg.id, { stage: 'rejected' });
          setCounts((c) => ({ ...c, rejected: c.rejected + 1 }));
        }, 360);
        return;
      }

      const attempt = (n: number) => {
        const backoff = BACKOFF_MS[Math.min(n, BACKOFF_MS.length - 1)];
        schedule(() => {
          setStage(msg.id, { stage: 'topic', attempt: n });
          schedule(() => {
            const fails = msg.willFail && n <= msg.failsFor;
            if (!fails) {
              setStage(msg.id, { stage: 'delivered', attempt: n });
              setCounts((c) => ({ ...c, delivered: c.delivered + 1 }));
              return;
            }
            if (n >= MAX_ATTEMPTS) {
              setStage(msg.id, { stage: 'dlq', attempt: n });
              setCounts((c) => ({ ...c, dlq: c.dlq + 1 }));
              return;
            }
            setStage(msg.id, { stage: 'retrying', attempt: n });
            setCounts((c) => ({ ...c, retries: c.retries + 1 }));
            attempt(n + 1);
          }, 360);
        }, 220 + backoff * 1.2);
      };
      attempt(1);
    },
    [schedule, setStage],
  );

  const publish = useCallback(
    (opts?: { forceKey?: string }) => {
      const key = opts?.forceKey ?? KEYS[keyCursor.current % KEYS.length];
      if (!opts?.forceKey) keyCursor.current += 1;
      const duplicate = seenKeys.has(key);
      // Whether this message's handler fails. In fail mode some fail past the
      // retry budget and land in the DLQ; others recover after a retry or two.
      const willFail = failMode && Math.random() < 0.6;
      const failsFor = willFail
        ? Math.random() < 0.45
          ? MAX_ATTEMPTS // never succeeds, ends in DLQ
          : 1 + Math.floor(Math.random() * 2) // recovers after 1 or 2 retries
        : 0;
      const msg: Msg = {
        id: nextId.current++,
        key,
        stage: 'published',
        attempt: 0,
        willFail,
        failsFor,
      };
      setMsgs((prev) => [msg, ...prev].slice(0, 7));
      if (!duplicate) setSeenKeys((s) => new Set(s).add(key));
      run(msg, duplicate);
    },
    [seenKeys, failMode, run],
  );

  const publishDuplicate = useCallback(() => {
    // Re-publish the most recent committed key to trip idempotency.
    const lastKey = KEYS[(keyCursor.current - 1 + KEYS.length * 2) % KEYS.length];
    publish({ forceKey: seenKeys.size > 0 ? lastKey : KEYS[0] });
  }, [publish, seenKeys]);

  const reset = useCallback(() => {
    clearTimers();
    nextId.current = 0;
    keyCursor.current = 0;
    setMsgs([]);
    setSeenKeys(new Set());
    setCounts({ delivered: 0, dlq: 0, rejected: 0, retries: 0 });
  }, [clearTimers]);

  return (
    <div className="demo" aria-label="distrobackend event bus demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Event bus: retry, dead-letter, idempotency</h3>
      <p className="demo__lede">
        Publish a message over HTTP onto the topic. A failing handler retries
        with exponential backoff and dead-letters once the budget is spent. A
        duplicate idempotency key is rejected before it is ever delivered.
      </p>

      <div className="db__pipeline" aria-hidden="true">
        <PipeStage label="HTTP publish" sub="POST /events" />
        <PipeArrow />
        <PipeStage label="topic" sub="in-memory bus" />
        <PipeArrow />
        <PipeStage label="worker" sub="handler" />
        <PipeArrow />
        <PipeStage label="delivered / DLQ" sub="terminal" />
      </div>

      <div className="db__counts" role="group" aria-label="bus counters">
        <Count label="delivered" value={counts.delivered} kind="ok" />
        <Count label="retries" value={counts.retries} kind="warn" />
        <Count label="dead-lettered" value={counts.dlq} kind="bad" />
        <Count label="dupes rejected" value={counts.rejected} kind="muted" />
      </div>

      <div className="db__stream" aria-label="message log" aria-live="polite">
        <AnimatePresence initial={false}>
          {msgs.length === 0 ? (
            <div className="db__empty">no messages published yet</div>
          ) : (
            msgs.map((m) => (
              <motion.div
                key={m.id}
                className={`db__msg db__msg--${m.stage}`}
                initial={{ opacity: reduce ? 1 : 0, y: reduce ? 0 : -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.3, ease }}
                layout={!reduce}
              >
                <span className="db__msg-key">{m.key}</span>
                <span className="db__msg-bar">
                  {Array.from({ length: MAX_ATTEMPTS }).map((_, i) => {
                    const n = i + 1;
                    const reached = m.attempt >= n && m.stage !== 'rejected';
                    const isFail =
                      reached &&
                      m.willFail &&
                      n <= m.failsFor &&
                      (m.stage === 'retrying' || m.stage === 'dlq' || n < m.attempt);
                    return (
                      <span
                        key={n}
                        className={[
                          'db__attempt',
                          reached ? 'is-on' : '',
                          isFail ? 'is-fail' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        title={`attempt ${n}, backoff ${BACKOFF_MS[Math.min(
                          n - 1,
                          BACKOFF_MS.length - 1,
                        )]}ms`}
                      />
                    );
                  })}
                </span>
                <span className="db__msg-stage">{stageLabel(m)}</span>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={() => publish()}>
          Publish message
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={publishDuplicate}
        >
          Publish duplicate key
        </button>
        <button
          className={`demo__btn demo__btn--ghost${failMode ? ' db__btn--on' : ''}`}
          onClick={() => setFailMode((v) => !v)}
          aria-pressed={failMode}
        >
          {failMode ? 'Flaky handler: on' : 'Flaky handler: off'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">
          backoff {BACKOFF_MS.slice(1).join('ms, ')}ms over {MAX_ATTEMPTS - 1}{' '}
          retries, then DLQ
        </span>
      </div>
    </div>
  );
}

function stageLabel(m: Msg): string {
  switch (m.stage) {
    case 'published':
      return 'published';
    case 'topic':
      return `attempt ${m.attempt}`;
    case 'retrying':
      return `retry after attempt ${m.attempt}`;
    case 'delivered':
      return `delivered on attempt ${m.attempt}`;
    case 'dlq':
      return 'dead-lettered';
    case 'rejected':
      return 'duplicate key rejected';
  }
}

function PipeStage({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="db__pipe">
      <span className="db__pipe-label">{label}</span>
      <span className="db__pipe-sub">{sub}</span>
    </div>
  );
}

function PipeArrow() {
  return <span className="db__pipe-arrow">{'>'}</span>;
}

function Count({
  label,
  value,
  kind,
}: {
  label: string;
  value: number;
  kind: 'ok' | 'warn' | 'bad' | 'muted';
}) {
  return (
    <div className={`db__count db__count--${kind}`}>
      <div className="db__count-val">{value}</div>
      <div className="db__count-label">{label}</div>
    </div>
  );
}
