import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './subscription-portal.css';

// Real numbers from the project: state changes fan out as HMAC-SHA256 signed
// webhooks, retried on a 1, 2, 4, 8, 16 minute schedule before a dead-letter
// queue. Each order also has a byte-deterministic PDF receipt.
const RETRY_SCHEDULE = [1, 2, 4, 8, 16]; // minutes
const ease = [0.22, 1, 0.36, 1] as const;

type Action = { id: string; label: string; verb: string; event: string };

const actions: Action[] = [
  { id: 'skip', label: 'Skip next order', verb: 'skipped', event: 'order.skipped' },
  { id: 'resch', label: 'Reschedule to Fri', verb: 'rescheduled', event: 'order.rescheduled' },
  { id: 'pause', label: 'Pause plan', verb: 'paused', event: 'subscription.paused' },
];

// Three tenant endpoints the webhook fans out to. The flaky one drives the
// retry-then-DLQ path so the schedule is visible.
type Endpoint = { id: string; name: string; behavior: 'ok' | 'flaky' };
const endpoints: Endpoint[] = [
  { id: 'crm', name: 'crm.tenant-a', behavior: 'ok' },
  { id: 'billing', name: 'billing.tenant-b', behavior: 'flaky' },
  { id: 'analytics', name: 'analytics.tenant-c', behavior: 'ok' },
];

type Phase = 'idle' | 'signing' | 'delivering' | 'done';
type EpStatus = 'idle' | 'pending' | 'ok' | 'retry' | 'dlq';
type EpState = {
  status: Exclude<EpStatus, 'idle'>;
  attempt: number;
};

// A small deterministic signature stub so the UI shows a stable HMAC-shaped
// hex string per event without any crypto at runtime.
function fakeSig(event: string, nonce: number) {
  let h = 0x811c9dc5;
  const s = `${event}:${nonce}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 16; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    out += (h & 0xff).toString(16).padStart(2, '0');
  }
  return out;
}

export default function SubscriptionPortalDemo() {
  const reduce = useReducedMotion();
  const [action, setAction] = useState<Action>(actions[0]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [nonce, setNonce] = useState(1);
  const [eps, setEps] = useState<Record<string, EpState>>({});
  const [pdfRenders, setPdfRenders] = useState<string[]>([]);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  const sig = fakeSig(action.event, nonce);

  function reset() {
    clearTimers();
    setPhase('idle');
    setEps({});
  }

  function selectAction(a: Action) {
    if (phase === 'signing' || phase === 'delivering') return;
    setAction(a);
    setPhase('idle');
    setEps({});
  }

  function run() {
    if (phase === 'signing' || phase === 'delivering') return;
    clearTimers();
    const base: Record<string, EpState> = {};
    endpoints.forEach((e) => (base[e.id] = { status: 'pending', attempt: 0 }));
    setEps(base);
    setPhase('signing');

    const step = (fn: () => void, ms: number) => {
      timers.current.push(window.setTimeout(fn, reduce ? 0 : ms));
    };

    // Sign, then deliver. Healthy endpoints land on attempt 1. The flaky one
    // fails attempts 1 and 2 (showing the 1 then 2 minute backoff) then lands
    // on attempt 3, while a separate run could exhaust to the DLQ.
    step(() => setPhase('delivering'), 650);

    step(() => {
      setEps((prev) => ({
        ...prev,
        crm: { status: 'ok', attempt: 1 },
        analytics: { status: 'ok', attempt: 1 },
        billing: { status: 'retry', attempt: 1 },
      }));
    }, 1100);

    step(() => {
      setEps((prev) => ({ ...prev, billing: { status: 'retry', attempt: 2 } }));
    }, 1900);

    step(() => {
      setEps((prev) => ({ ...prev, billing: { status: 'ok', attempt: 3 } }));
      setPhase('done');
    }, 2700);
  }

  // Render the receipt: push two identical hashes to show byte-determinism.
  function renderReceipt() {
    // SOURCE_DATE_EPOCH pinned and canvas invariant means the same bytes every
    // time, so both renders hash identically.
    const digest = fakeSig(`receipt:${action.id}`, 7).slice(0, 12);
    setPdfRenders((prev) => [...prev, digest].slice(-2));
  }

  const identical =
    pdfRenders.length === 2 && pdfRenders[0] === pdfRenders[1];

  return (
    <div className="demo" aria-label="subscription portal webhook demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">A state change, signed and fanned out</h3>
      <p className="demo__lede">
        Skip or reschedule an order from the account dashboard. The change is
        signed with HMAC-SHA256 and fanned out to tenant endpoints. A flaky
        endpoint retries on a 1, 2, 4, 8, 16 minute schedule before the
        dead-letter queue.
      </p>

      <div className="sp__stage">
        <div className="sp__panel sp__account">
          <div className="sp__panel-head">Account dashboard</div>
          <div className="sp__plan">
            <div className="sp__plan-row">
              <span className="sp__plan-k">Plan</span>
              <span className="sp__plan-v">Weekly box</span>
            </div>
            <div className="sp__plan-row">
              <span className="sp__plan-k">Next order</span>
              <span className="sp__plan-v">Tue, 8:00</span>
            </div>
            <div className="sp__plan-row">
              <span className="sp__plan-k">Payment</span>
              <span className="sp__plan-v">card ending 4242</span>
            </div>
          </div>
          <div className="sp__actions" role="group" aria-label="Order actions">
            {actions.map((a) => (
              <button
                key={a.id}
                className={`sp__action${action.id === a.id ? ' sp__action--on' : ''}`}
                aria-pressed={action.id === a.id}
                onClick={() => selectAction(a)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sp__panel sp__event">
          <div className="sp__panel-head">Signed payload</div>
          <pre className="sp__payload" aria-label="webhook payload">
            <span className="sp__pl-line">{'{'}</span>
            <span className="sp__pl-line">
              {'  '}"event": <span className="sp__hi">"{action.event}"</span>,
            </span>
            <span className="sp__pl-line">
              {'  '}"nonce": <span className="sp__num">{nonce}</span>
            </span>
            <span className="sp__pl-line">{'}'}</span>
          </pre>
          <div className="sp__sig">
            <span className="sp__sig-k">X-Signature</span>
            <code className="sp__sig-v">
              sha256={phase === 'idle' ? '-'.repeat(8) : sig}
            </code>
          </div>
        </div>
      </div>

      <div className="sp__fanout" role="group" aria-label="webhook fan-out">
        {endpoints.map((e) => {
          const st: EpState | undefined = eps[e.id];
          const status: EpStatus = st ? st.status : 'idle';
          return (
            <motion.div
              key={e.id}
              className={`sp__ep sp__ep--${status}`}
              initial={false}
              animate={{
                scale:
                  !reduce && (status === 'ok' || status === 'retry') ? [1, 1.02, 1] : 1,
              }}
              transition={{ duration: 0.35, ease }}
            >
              <div className="sp__ep-top">
                <span className="sp__ep-name">{e.name}</span>
                <span className="sp__ep-state">
                  {status === 'idle' && 'waiting'}
                  {status === 'pending' && 'POST...'}
                  {status === 'ok' && '200 OK'}
                  {status === 'retry' && '503 retry'}
                  {status === 'dlq' && 'DLQ'}
                </span>
              </div>
              <div className="sp__ep-retries" aria-hidden="true">
                {RETRY_SCHEDULE.map((m, i) => {
                  const reached = st ? st.attempt > i : false;
                  const failing =
                    st && status === 'retry' && st.attempt === i + 1;
                  return (
                    <span
                      key={m}
                      className={`sp__retry${reached ? ' sp__retry--hit' : ''}${
                        failing ? ' sp__retry--live' : ''
                      }`}
                      title={`attempt after ${m} min`}
                    >
                      {m}m
                    </span>
                  );
                })}
                <span className="sp__retry sp__retry--dlq">DLQ</span>
              </div>
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {phase === 'done' && (
          <motion.div
            className="sp__verdict"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            Order {action.verb}. Two endpoints accepted on the first attempt;
            billing.tenant-b cleared on attempt 3 after the 1 and 2 minute
            backoffs. The signature on every delivery is the same HMAC, so a
            tampered body fails verification.
          </motion.div>
        )}
      </AnimatePresence>

      <div className="sp__receipt">
        <div className="sp__panel-head">Deterministic receipt</div>
        <p className="sp__receipt-note">
          The PDF pins SOURCE_DATE_EPOCH and a canvas invariant, so it is
          byte-identical on every render. Render it twice and compare the
          digest.
        </p>
        <div className="sp__receipt-row">
          {[0, 1].map((i) => (
            <div
              key={i}
              className={`sp__digest${pdfRenders[i] ? ' sp__digest--set' : ''}`}
            >
              <span className="sp__digest-label">render {i + 1}</span>
              <code className="sp__digest-val">
                {pdfRenders[i] ?? 'not rendered'}
              </code>
            </div>
          ))}
          {identical && (
            <span className="sp__digest-match">bytes match</span>
          )}
        </div>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={run}
          disabled={phase === 'signing' || phase === 'delivering'}
        >
          {phase === 'signing'
            ? 'Signing...'
            : phase === 'delivering'
              ? 'Delivering...'
              : 'Apply and fan out'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={renderReceipt}
        >
          Render receipt
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => {
            reset();
            setNonce((n) => n + 1);
          }}
          disabled={phase === 'signing' || phase === 'delivering'}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
