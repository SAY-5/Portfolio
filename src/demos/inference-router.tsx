import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './inference-router.css';

// Real numbers from the project chaos test: 994 accepted, 994 completed,
// 0 errored, 0 dropped, with drain triggered at t=5s. Shutdown order is
// acceptor.stop, wait for in_flight==0 up to the grace window, then pool
// and backend shutdown. Post-drain dials bounce off the closed socket.
const GRACE_S = 30;
const TOTAL_TARGET = 994;
const WORKERS = 4;

const ease = [0.22, 1, 0.36, 1] as const;

type Phase = 'idle' | 'serving' | 'draining' | 'drained';

type Req = {
  id: number;
  // -1 means waiting in the bounded MPMC queue, 0..WORKERS-1 means on a worker
  worker: number;
  // progress 0..1 of the in-flight request on its worker
  prog: number;
};

let nextId = 1;

export default function InferenceRouterDemo() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [accepted, setAccepted] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [dropped, setDropped] = useState(0);
  const [bounced, setBounced] = useState(0);
  const [inFlight, setInFlight] = useState<Req[]>([]);
  const [queued, setQueued] = useState<number[]>([]);
  const [socketOpen, setSocketOpen] = useState(true);
  const [pulse, setPulse] = useState(0);

  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number>(0);
  const acceptAccumRef = useRef<number>(0);

  // Refs mirror state so the rAF loop reads current values without re-binding.
  const phaseRef = useRef<Phase>('idle');
  const inFlightRef = useRef<Req[]>([]);
  const queuedRef = useRef<number[]>([]);
  phaseRef.current = phase;
  inFlightRef.current = inFlight;
  queuedRef.current = queued;

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const reset = useCallback(() => {
    stop();
    setPhase('idle');
    setAccepted(0);
    setCompleted(0);
    setDropped(0);
    setBounced(0);
    setInFlight([]);
    setQueued([]);
    setSocketOpen(true);
    setPulse(0);
    acceptAccumRef.current = 0;
  }, [stop]);

  const loop = useCallback(
    (now: number) => {
      const dt = Math.min(0.05, (now - lastRef.current) / 1000);
      lastRef.current = now;

      const ph = phaseRef.current;
      const socketLive = ph === 'serving';

      // Acceptor: while the listening socket is open, take new connections
      // off the wire and push them into the bounded queue.
      if (socketLive) {
        acceptAccumRef.current += dt * 14; // arrivals per second
        let take = Math.floor(acceptAccumRef.current);
        if (take > 0) {
          acceptAccumRef.current -= take;
          setAccepted((a) => {
            const room = TOTAL_TARGET - a;
            take = Math.min(take, room);
            if (take > 0) {
              setQueued((q) => {
                const add: number[] = [];
                for (let i = 0; i < take; i++) add.push(nextId++);
                return [...q, ...add].slice(-40);
              });
            }
            return a + take;
          });
        }
      }

      // Workers advance in-flight requests; a finished one completes and the
      // worker pulls the next item from the queue (drain lets these finish).
      setInFlight((prev) => {
        const next: Req[] = [];
        let finished = 0;
        const freed: number[] = [];
        for (const r of prev) {
          const np = r.prog + dt * 0.9; // ~1.1s per request
          if (np >= 1) {
            finished++;
            freed.push(r.worker);
          } else {
            next.push({ ...r, prog: np });
          }
        }
        if (finished > 0) setCompleted((c) => c + finished);

        // Assign freed workers (and any idle workers) from the queue.
        const busy = new Set(next.map((r) => r.worker));
        const idleWorkers: number[] = [];
        for (let w = 0; w < WORKERS; w++) if (!busy.has(w)) idleWorkers.push(w);

        if (idleWorkers.length > 0) {
          setQueued((q) => {
            const q2 = [...q];
            for (const w of idleWorkers) {
              const id = q2.shift();
              if (id === undefined) break;
              next.push({ id, worker: w, prog: 0 });
            }
            return q2;
          });
        }
        return next;
      });

      // Post-drain: late dials hit the closed listening socket and bounce.
      if (ph === 'draining' || ph === 'drained') {
        acceptAccumRef.current += dt * 9;
        const b = Math.floor(acceptAccumRef.current);
        if (b > 0) {
          acceptAccumRef.current -= b;
          setBounced((x) => x + b);
          setPulse((p) => p + 1);
        }
      }

      // Drain completes once the queue is empty and no request is in flight.
      if (ph === 'draining') {
        if (queuedRef.current.length === 0 && inFlightRef.current.length === 0) {
          setPhase('drained');
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    },
    [],
  );

  function start() {
    if (phase === 'serving' || phase === 'draining') return;
    reset();
    setPhase('serving');
    phaseRef.current = 'serving';
    lastRef.current = performance.now();
    if (reduce) {
      // Reduced motion: jump straight to the settled, zero-drop result.
      stop();
      setAccepted(TOTAL_TARGET);
      setCompleted(TOTAL_TARGET);
      setDropped(0);
      setBounced(37);
      setQueued([]);
      setInFlight([]);
      setSocketOpen(false);
      setPhase('drained');
      return;
    }
    rafRef.current = requestAnimationFrame(loop);
  }

  function sigterm() {
    if (phase !== 'serving') return;
    // Shutdown step 1: acceptor.stop closes the listening socket. In-flight
    // and already-queued work is allowed to finish within the grace window.
    setSocketOpen(false);
    setPhase('draining');
    phaseRef.current = 'draining';
  }

  const draining = phase === 'draining';
  const drained = phase === 'drained';
  const serving = phase === 'serving';
  const graceUsed = draining || drained;

  return (
    <div className="demo" aria-label="inference-router drain protocol demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Zero-drop graceful shutdown</h3>
      <p className="demo__lede">
        Start the router and let requests flow through the epoll acceptor, the
        bounded queue, and four worker threads. Then send SIGTERM: the listening
        socket snaps shut, in-flight work drains to completion, and late dials
        bounce off the closed socket while the dropped counter holds at zero.
      </p>

      <div className="ir__stage">
        <div className="ir__pipeline" aria-hidden="true">
          {/* acceptor / listening socket */}
          <div className={`ir__sock ir__sock--${socketOpen ? 'open' : 'closed'}`}>
            <div className="ir__sock-name">epoll acceptor</div>
            <div className="ir__sock-state">
              {socketOpen ? 'listening :7000' : 'socket closed'}
            </div>
            <AnimatePresence>
              {!socketOpen && (
                <motion.div
                  key="bounce"
                  className="ir__bounce-burst"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: [0, 1.15, 1], opacity: [0, 1, 0.85] }}
                  transition={{ duration: 0.4, ease }}
                >
                  ECONNREFUSED
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* bounded MPMC queue */}
          <div className="ir__queue">
            <div className="ir__queue-head">
              <span>bounded queue</span>
              <span className="ir__queue-count">{queued.length}</span>
            </div>
            <div className="ir__queue-slots">
              <AnimatePresence initial={false}>
                {queued.slice(0, 12).map((id) => (
                  <motion.span
                    key={id}
                    className="ir__token"
                    layout
                    initial={{ scale: reduce ? 1 : 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: reduce ? 1 : 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease }}
                  />
                ))}
              </AnimatePresence>
              {queued.length === 0 && (
                <span className="ir__queue-empty">empty</span>
              )}
            </div>
          </div>

          {/* worker pool */}
          <div className="ir__workers">
            <div className="ir__queue-head">
              <span>worker pool</span>
              <span className="ir__queue-count">x{WORKERS}</span>
            </div>
            <div className="ir__worker-grid">
              {Array.from({ length: WORKERS }).map((_, w) => {
                const r = inFlight.find((x) => x.worker === w);
                return (
                  <div
                    key={w}
                    className={`ir__worker ${r ? 'ir__worker--busy' : ''}`}
                  >
                    <div className="ir__worker-name">w{w}</div>
                    <div className="ir__worker-bar">
                      <motion.div
                        className="ir__worker-fill"
                        animate={{ width: r ? `${Math.round(r.prog * 100)}%` : '0%' }}
                        transition={{ duration: reduce ? 0 : 0.12, ease: 'linear' }}
                      />
                    </div>
                    <div className="ir__worker-state">
                      {r ? 'forwarding' : 'idle'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="ir__counters">
          <div className="ir__counter">
            <div className="ir__counter-name">accepted</div>
            <div className="ir__counter-val">{accepted}</div>
          </div>
          <div className="ir__counter">
            <div className="ir__counter-name">completed</div>
            <div className="ir__counter-val">{completed}</div>
          </div>
          <div className="ir__counter ir__counter--zero">
            <div className="ir__counter-name">dropped</div>
            <motion.div
              className="ir__counter-val"
              key={dropped}
              animate={pulse > 0 && !reduce ? { scale: [1, 1.06, 1] } : undefined}
              transition={{ duration: 0.3 }}
            >
              {dropped}
            </motion.div>
          </div>
          <div className="ir__counter">
            <div className="ir__counter-name">refused</div>
            <div className="ir__counter-val">{bounced}</div>
          </div>
        </div>

        <div className={`ir__phase ir__phase--${phase}`} role="status" aria-live="polite">
          {serving && 'serving: acceptor open, workers forwarding to backends'}
          {draining &&
            `draining: acceptor.stop sent, waiting for in_flight==0 within ${GRACE_S}s grace`}
          {drained &&
            'drained: in_flight==0, pool and backend shut down in order, 0 dropped'}
          {phase === 'idle' && 'idle: press Start to open the listening socket'}
        </div>

        <AnimatePresence>
          {drained && (
            <motion.div
              className="ir__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="ir__verdict-x">0 dropped</span>
              <span className="ir__verdict-text">
                Every accepted request completed before the pool stopped, and
                CI enforces dropped_total == 0 on every push. The chaos test
                lands 994 accepted, 994 completed, 0 errored, 0 dropped with
                drain triggered at t=5s.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={start} disabled={serving || draining}>
          {serving || draining ? 'Running…' : 'Start router'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={sigterm}
          disabled={!serving}
        >
          Send SIGTERM
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">
          {graceUsed ? `grace window ${GRACE_S}s` : 'shutdown order: acceptor, pool, backend'}
        </span>
      </div>
    </div>
  );
}
