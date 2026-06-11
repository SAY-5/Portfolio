import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';

// Real mechanism from the project. Order placement is a saga: reserve units per
// line and push a compensating release on a stack, then write the order in its
// own transaction. Any failure runs compensations in reverse so no units stay
// reserved and no order row is left. The gateway wraps each route in a
// Resilience4j circuit breaker with a timeout and 503 fallback, so a failing
// downstream trips the breaker OPEN and the gateway answers from the fallback
// instead of hanging. Local benchmark over 2000 placements: p50 2.925ms,
// p95 3.774ms, 329 placements/sec.
const P50_MS = 2.925;
const P95_MS = 3.774;
const PER_SEC = 329;
const TRIP_THRESHOLD = 3; // consecutive failures that trip the breaker open

type Line = { id: string; sku: string; qty: number; service: string };
const lines: Line[] = [
  { id: 'l1', sku: 'KB-87', qty: 1, service: 'catalog' },
  { id: 'l2', sku: 'MS-12', qty: 2, service: 'catalog' },
  { id: 'l3', sku: 'PD-04', qty: 1, service: 'catalog' },
];

type Phase = 'idle' | 'reserving' | 'unwinding' | 'committed' | 'rolledback';
type Tab = 'saga' | 'breaker';
type BreakerState = 'closed' | 'open';
type Outcome = 'ok' | 'fail' | 'fallback';
type Call = { id: number; outcome: Outcome };
const ease = [0.22, 1, 0.36, 1] as const;

export default function ShopflowDemo() {
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<Tab>('saga');

  // ----- saga state -----
  const [failLine, setFailLine] = useState<string>('l2');
  const [reserved, setReserved] = useState<string[]>([]); // compensation stack
  const [phase, setPhase] = useState<Phase>('idle');
  const timers = useRef<number[]>([]);

  // ----- breaker state -----
  const [downHealthy, setDownHealthy] = useState(true);
  const [breaker, setBreaker] = useState<BreakerState>('closed');
  const [fails, setFails] = useState(0);
  const [calls, setCalls] = useState<Call[]>([]);
  const callId = useRef(0);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);
  function at(ms: number, fn: () => void) {
    timers.current.push(window.setTimeout(fn, reduce ? 0 : ms));
  }

  function resetSaga() {
    clearTimers();
    setReserved([]);
    setPhase('idle');
  }

  function runSaga(inject: boolean) {
    if (phase === 'reserving' || phase === 'unwinding') return;
    resetSaga();
    setPhase('reserving');
    const stack: string[] = [];

    lines.forEach((line, i) => {
      at(250 + i * 550, () => {
        if (inject && line.id === failLine) {
          // reservation fails here: begin compensating in reverse
          setPhase('unwinding');
          unwind(stack);
          return;
        }
        stack.push(line.id);
        setReserved([...stack]);
      });
    });

    if (!inject) {
      at(250 + lines.length * 550 + 300, () => {
        // all reservations held, write the order in its own transaction
        setPhase('committed');
      });
    }
  }

  function unwind(stack: string[]) {
    // pop the compensation stack in reverse, releasing each prior reservation
    const popOrder = [...stack].reverse();
    popOrder.forEach((_, i) => {
      at(350 + i * 500, () => {
        setReserved((prev) => prev.slice(0, prev.length - 1));
      });
    });
    at(350 + popOrder.length * 500 + 200, () => {
      setReserved([]);
      setPhase('rolledback');
    });
  }

  // ----- breaker actions -----
  function resetBreaker() {
    setBreaker('closed');
    setFails(0);
    setCalls([]);
    callId.current = 0;
    setDownHealthy(true);
  }

  function sendRequest() {
    callId.current += 1;
    const id = callId.current;

    const push = (outcome: Outcome) =>
      setCalls((p) => [...p, { id, outcome }].slice(-7));

    if (breaker === 'open') {
      // breaker is open: gateway answers from the 503 fallback, no hang
      push('fallback');
      return;
    }
    if (downHealthy) {
      setFails(0);
      push('ok');
      return;
    }
    // downstream is failing while breaker still closed
    const next = fails + 1;
    setFails(next);
    push('fail');
    if (next >= TRIP_THRESHOLD) setBreaker('open');
  }

  const orderState =
    phase === 'committed'
      ? 'order row written'
      : phase === 'rolledback'
        ? 'no order row written'
        : phase === 'idle'
          ? 'not placed'
          : 'pending';

  return (
    <div className="demo" aria-label="ShopFlow saga and circuit breaker demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Saga and circuit breaker</h3>
      <p className="demo__lede">
        Two parts of the order path. The saga reserves inventory line by line and
        pushes a compensating release on a stack; inject a failure and the
        releases unwind in reverse, leaving no units reserved and no order row.
        The gateway breaker trips open after repeated downstream failures and
        answers from a 503 fallback instead of hanging.
      </p>

      <div className="sf__tabs" role="tablist" aria-label="Demo part">
        <button
          role="tab"
          aria-selected={tab === 'saga'}
          className={`sf__tab ${tab === 'saga' ? 'sf__tab--on' : ''}`}
          onClick={() => setTab('saga')}
        >
          Saga
        </button>
        <button
          role="tab"
          aria-selected={tab === 'breaker'}
          className={`sf__tab ${tab === 'breaker' ? 'sf__tab--on' : ''}`}
          onClick={() => setTab('breaker')}
        >
          Circuit breaker
        </button>
      </div>

      {tab === 'saga' && (
        <div className="sf__stage">
          <div className="sf__lines">
            {lines.map((line) => {
              const isReserved = reserved.includes(line.id);
              const isFailPick = failLine === line.id;
              return (
                <button
                  key={line.id}
                  className={`sf__line ${isReserved ? 'sf__line--res' : ''} ${
                    isFailPick ? 'sf__line--fail-pick' : ''
                  }`}
                  onClick={() => {
                    if (phase === 'reserving' || phase === 'unwinding') return;
                    setFailLine(line.id);
                  }}
                  aria-pressed={isFailPick}
                  aria-label={`Line ${line.sku}, ${
                    isFailPick ? 'selected as failure line' : 'select to fail'
                  }`}
                >
                  <span className="sf__line-sku">{line.sku}</span>
                  <span className="sf__line-qty">x{line.qty}</span>
                  <span className="sf__line-svc">{line.service}</span>
                  <span className="sf__line-state">
                    {isReserved ? 'reserved' : isFailPick ? 'fail here' : 'idle'}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="sf__stackwrap">
            <div className="sf__stack-head">
              compensation stack
              <span className="sf__stack-count">{reserved.length}</span>
            </div>
            <div className="sf__stack">
              <AnimatePresence initial={false}>
                {reserved.map((id, i) => {
                  const line = lines.find((l) => l.id === id)!;
                  return (
                    <motion.div
                      key={id}
                      className="sf__stack-item"
                      initial={{ opacity: 0, y: reduce ? 0 : -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: reduce ? 0 : 14 }}
                      transition={{ duration: reduce ? 0 : 0.3, ease }}
                    >
                      <span className="sf__stack-idx">{i + 1}</span>
                      release {line.sku} (x{line.qty})
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {reserved.length === 0 && (
                <span className="sf__stack-empty">empty: nothing to release</span>
              )}
            </div>
            <div className="sf__order" data-state={phase}>
              <span className="sf__order-label">orders db</span>
              <span className="sf__order-state">{orderState}</span>
            </div>
          </div>

          <AnimatePresence>
            {(phase === 'committed' || phase === 'rolledback') && (
              <motion.div
                className={`sf__verdict ${
                  phase === 'rolledback' ? 'sf__verdict--roll' : ''
                }`}
                initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease }}
              >
                <span className="sf__verdict-head">
                  {phase === 'committed' ? 'Order placed' : 'No partial order'}
                </span>
                <span className="sf__verdict-text">
                  {phase === 'committed'
                    ? `All lines reserved and the order row was written. p50 ${P50_MS}ms, p95 ${P95_MS}ms over 2000 placements.`
                    : `Compensations ran in reverse: every prior reservation released, no units stay reserved and no order row was written.`}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="demo__controls">
            <button
              className="demo__btn"
              onClick={() => runSaga(false)}
              disabled={phase === 'reserving' || phase === 'unwinding'}
            >
              Place order
            </button>
            <button
              className="demo__btn demo__btn--ghost"
              onClick={() => runSaga(true)}
              disabled={phase === 'reserving' || phase === 'unwinding'}
            >
              Inject failure
            </button>
            <button
              className="demo__btn demo__btn--ghost"
              onClick={resetSaga}
              disabled={phase === 'reserving' || phase === 'unwinding'}
            >
              Reset
            </button>
            <span className="demo__hint">fail line: {failLine.toUpperCase()}</span>
          </div>
        </div>
      )}

      {tab === 'breaker' && (
        <div className="sf__stage">
          <div className="sf__breaker-row">
            <div className="sf__node">
              <span className="sf__node-name">gateway</span>
              <span className="sf__node-sub">Resilience4j</span>
            </div>
            <div className={`sf__breaker sf__breaker--${breaker}`}>
              <span className="sf__breaker-state">{breaker}</span>
              <span className="sf__breaker-meta">
                {breaker === 'open'
                  ? '503 fallback, no downstream call'
                  : `${fails}/${TRIP_THRESHOLD} consecutive fails`}
              </span>
            </div>
            <button
              className={`sf__node sf__node--svc ${
                downHealthy ? 'sf__node--up' : 'sf__node--down'
              }`}
              onClick={() => setDownHealthy((v) => !v)}
              aria-pressed={!downHealthy}
              aria-label={`Downstream service, currently ${
                downHealthy ? 'healthy' : 'failing'
              }. Toggle.`}
            >
              <span className="sf__node-name">catalog svc</span>
              <span className="sf__node-sub">
                {downHealthy ? 'healthy' : 'failing'}
              </span>
            </button>
          </div>

          <div className="sf__calls" aria-label="Recent gateway responses">
            <AnimatePresence initial={false}>
              {calls.map((c) => (
                <motion.span
                  key={c.id}
                  className={`sf__call sf__call--${c.outcome}`}
                  initial={{ opacity: 0, scale: reduce ? 1 : 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: reduce ? 0 : 0.25, ease }}
                >
                  {c.outcome === 'ok'
                    ? '200'
                    : c.outcome === 'fail'
                      ? 'timeout'
                      : '503'}
                </motion.span>
              ))}
            </AnimatePresence>
            {calls.length === 0 && (
              <span className="sf__call-empty">
                Send requests. Fail the downstream to trip the breaker.
              </span>
            )}
          </div>

          <div className="sf__stats">
            <div className="sf__stat">
              <span className="sf__stat-val">{P50_MS}</span>
              <span className="sf__stat-unit">ms p50</span>
            </div>
            <div className="sf__stat">
              <span className="sf__stat-val">{P95_MS}</span>
              <span className="sf__stat-unit">ms p95</span>
            </div>
            <div className="sf__stat">
              <span className="sf__stat-val">{PER_SEC}</span>
              <span className="sf__stat-unit">placements/sec</span>
            </div>
          </div>

          <div className="demo__controls">
            <button className="demo__btn" onClick={sendRequest}>
              Send request
            </button>
            <button
              className="demo__btn demo__btn--ghost"
              onClick={resetBreaker}
            >
              Reset
            </button>
            <span className="demo__hint">
              breaker {breaker}
              {breaker === 'open' ? ', serving 503 fallback' : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
