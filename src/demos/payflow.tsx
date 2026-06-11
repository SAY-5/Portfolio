import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './payflow.css';

// Real behavior from the project: idempotency keys are scoped per merchant and
// matched on a request-body hash. Same key + same body replays the original
// 200, a different body returns 422, an in-flight key returns 409 with
// Retry-After: 5, and keys are retained for 7 days. Stripe webhooks are
// HMAC-SHA256 verified over raw bytes inside a 5-minute replay window, and a
// duplicate provider_event_id returns 200 with duplicate: true.
const RETRY_AFTER = 5;

type Body = 'same' | 'different';
type State = 'inflight' | 'settled';

type Outcome = {
  status: number;
  tag: 'replay' | 'created' | 'mismatch' | 'inflight';
  line: string;
};

function decide(body: Body, state: State): Outcome {
  if (state === 'inflight') {
    return {
      status: 409,
      tag: 'inflight',
      line: `409 Conflict, Retry-After: ${RETRY_AFTER}`,
    };
  }
  if (body === 'same') {
    return { status: 200, tag: 'replay', line: '200 OK, replayed original response' };
  }
  return { status: 422, tag: 'mismatch', line: '422 Unprocessable, body hash differs' };
}

type Step = { k: string; text: string };

export default function PayflowDemo() {
  const reduce = useReducedMotion();
  const [body, setBody] = useState<Body>('same');
  const [firstSettled, setFirstSettled] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [running, setRunning] = useState(false);
  const [whVerified, setWhVerified] = useState<null | 'first' | 'dup'>(null);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  // The original request must land before any replay can branch, so the
  // in-flight vs settled state is what the second request keys on.
  const state: State = firstSettled ? 'settled' : 'inflight';

  function sendFirst() {
    if (running) return;
    clearTimers();
    setRunning(true);
    setOutcome(null);
    const seq: Step[] = [
      { k: 'recv', text: 'POST /payment_intents  Idempotency-Key: idem_a1' },
      { k: 'hash', text: 'hash(body) stored, key marked in-flight' },
      { k: 'charge', text: 'intent created, charge captured' },
      { k: 'done', text: '201 Created, key marked settled (7-day retention)' },
    ];
    setSteps([]);
    if (reduce) {
      setSteps(seq);
      setFirstSettled(true);
      setRunning(false);
      return;
    }
    seq.forEach((s, i) => {
      const t = window.setTimeout(() => {
        setSteps((prev) => [...prev, s]);
        if (i === seq.length - 1) {
          setFirstSettled(true);
          setRunning(false);
        }
      }, 520 * (i + 1));
      timers.current.push(t);
    });
  }

  function replay() {
    if (running) return;
    clearTimers();
    setRunning(true);
    const out = decide(body, state);
    setOutcome(null);
    const seq: Step[] = [
      { k: 'recv', text: 'POST /payment_intents  Idempotency-Key: idem_a1 (replay)' },
      {
        k: 'lookup',
        text:
          state === 'inflight'
            ? 'key found in-flight, no second charge'
            : body === 'same'
              ? 'key found, body hash matches the original'
              : 'key found, body hash does NOT match the original',
      },
      { k: 'branch', text: out.line },
    ];
    setSteps([]);
    if (reduce) {
      setSteps(seq);
      setOutcome(out);
      setRunning(false);
      return;
    }
    seq.forEach((s, i) => {
      const t = window.setTimeout(() => {
        setSteps((prev) => [...prev, s]);
        if (i === seq.length - 1) {
          setOutcome(out);
          setRunning(false);
        }
      }, 560 * (i + 1));
      timers.current.push(t);
    });
  }

  function reset() {
    clearTimers();
    setRunning(false);
    setSteps([]);
    setOutcome(null);
    setFirstSettled(false);
    setWhVerified(null);
  }

  function sendWebhook(kind: 'first' | 'dup') {
    if (running) return;
    setWhVerified(kind);
  }

  return (
    <div className="demo" aria-label="PayFlow idempotency and webhook demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Idempotent payments, verified webhooks</h3>
      <p className="demo__lede">
        Send a payment intent, then replay its key. A matching body replays the
        original response, a different body returns 422, and an in-flight key
        returns 409 with Retry-After. The webhook track HMAC-verifies and dedupes
        provider events.
      </p>

      <div className="pf__grid">
        <section className="pf__col" aria-label="idempotency layer">
          <div className="pf__col-head">Idempotency layer</div>

          <div className="pf__key">
            <span className="pf__key-label">Idempotency-Key</span>
            <span className="pf__key-val">idem_a1</span>
            <span
              className={
                'pf__key-state' +
                (state === 'settled' ? ' pf__key-state--settled' : ' pf__key-state--inflight')
              }
            >
              {firstSettled ? 'settled' : steps.length ? 'in-flight' : 'unused'}
            </span>
          </div>

          <div className="pf__bodysel" role="radiogroup" aria-label="replay body">
            <span className="pf__bodysel-label">Replay body</span>
            <button
              role="radio"
              aria-checked={body === 'same'}
              className={'pf__chip' + (body === 'same' ? ' pf__chip--on' : '')}
              onClick={() => !running && setBody('same')}
              disabled={running}
            >
              same body
            </button>
            <button
              role="radio"
              aria-checked={body === 'different'}
              className={'pf__chip' + (body === 'different' ? ' pf__chip--on' : '')}
              onClick={() => !running && setBody('different')}
              disabled={running}
            >
              different body
            </button>
          </div>

          <ol className="pf__log" aria-live="polite">
            <AnimatePresence initial={false}>
              {steps.map((s) => (
                <motion.li
                  key={s.k + s.text}
                  className="pf__log-line"
                  initial={{ opacity: reduce ? 1 : 0, x: reduce ? 0 : -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: reduce ? 0 : 0.28 }}
                >
                  <span className="pf__log-arrow">&rsaquo;</span>
                  {s.text}
                </motion.li>
              ))}
            </AnimatePresence>
            {!steps.length && (
              <li className="pf__log-empty">Send the original request to begin.</li>
            )}
          </ol>

          <AnimatePresence>
            {outcome && (
              <motion.div
                key={outcome.tag}
                className={`pf__outcome pf__outcome--${outcome.tag}`}
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                role="status"
              >
                <span className="pf__outcome-code">{outcome.status}</span>
                <span className="pf__outcome-tag">{outcome.tag}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="pf__btns">
            <button
              className="demo__btn"
              onClick={sendFirst}
              disabled={running || firstSettled}
            >
              Send original
            </button>
            <button
              className="demo__btn demo__btn--ghost"
              onClick={replay}
              disabled={running || !steps.length}
            >
              Replay key
            </button>
          </div>
        </section>

        <section className="pf__col" aria-label="stripe webhook verification">
          <div className="pf__col-head">Stripe webhook</div>
          <p className="pf__wh-note">
            HMAC-SHA256 over raw bytes, 5-minute replay window, dedupe on
            provider_event_id.
          </p>

          <div className="pf__wh-track">
            <WhRow
              label="signature"
              ok={whVerified !== null}
              text={whVerified ? 'HMAC matches, within window' : 'awaiting event'}
            />
            <WhRow
              label="dedupe"
              ok={whVerified === 'first'}
              warn={whVerified === 'dup'}
              text={
                whVerified === 'dup'
                  ? 'provider_event_id seen, returns duplicate: true'
                  : whVerified === 'first'
                    ? 'new provider_event_id, processed once'
                    : 'awaiting event'
              }
            />
            <WhRow
              label="audit log"
              ok={whVerified === 'first'}
              text={
                whVerified === 'first'
                  ? 'append-only row written (REQUIRES_NEW)'
                  : whVerified === 'dup'
                    ? 'no new row, idempotent'
                    : 'awaiting event'
              }
            />
          </div>

          <AnimatePresence>
            {whVerified && (
              <motion.div
                className={
                  'pf__wh-result' + (whVerified === 'dup' ? ' pf__wh-result--dup' : '')
                }
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                role="status"
              >
                {whVerified === 'dup'
                  ? '200 OK { "duplicate": true }'
                  : '200 OK, event processed'}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="pf__btns">
            <button
              className="demo__btn"
              onClick={() => sendWebhook('first')}
              disabled={running}
            >
              Deliver event
            </button>
            <button
              className="demo__btn demo__btn--ghost"
              onClick={() => sendWebhook('dup')}
              disabled={running}
            >
              Redeliver (dup)
            </button>
          </div>
        </section>
      </div>

      <div className="demo__controls">
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={running}>
          Reset
        </button>
        <span className="demo__hint">
          same body replays, different returns 422, in-flight returns 409
        </span>
      </div>
    </div>
  );
}

function WhRow({
  label,
  text,
  ok,
  warn,
}: {
  label: string;
  text: string;
  ok?: boolean;
  warn?: boolean;
}) {
  const cls = warn ? 'pf__wh-row--warn' : ok ? 'pf__wh-row--ok' : '';
  return (
    <div className={'pf__wh-row ' + cls}>
      <span className="pf__wh-dot" aria-hidden="true" />
      <span className="pf__wh-label">{label}</span>
      <span className="pf__wh-text">{text}</span>
    </div>
  );
}
