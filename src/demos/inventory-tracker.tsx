import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './inventory-tracker.css';

// Real numbers from the project stress test: stock=50 with 100 parallel
// reservation requests yields exactly 50 successes and 50 insufficient_stock
// rejections with zero unexpected errors. Every reserve is a DynamoDB
// UpdateItem with ConditionExpression 'available >= :qty AND version = :exp';
// losers get ConditionalCheckFailedException and feed the retry loop.
const START_STOCK = 50;
const REQUESTS = 100;
const NODES = ['warehouse-a', 'warehouse-b', 'warehouse-c'] as const;

type ReqState = 'pending' | 'won' | 'retry' | 'rejected';
type Req = {
  id: number;
  node: number;
  state: ReqState;
  attempts: number;
};

const ease = [0.22, 1, 0.36, 1] as const;

function makeRequests(): Req[] {
  return Array.from({ length: REQUESTS }, (_, i) => ({
    id: i,
    node: i % NODES.length,
    state: 'pending' as ReqState,
    attempts: 0,
  }));
}

export default function InventoryTrackerDemo() {
  const reduce = useReducedMotion();
  const [reqs, setReqs] = useState<Req[]>(makeRequests);
  const [stock, setStock] = useState(START_STOCK);
  const [version, setVersion] = useState(0);
  const [won, setWon] = useState(0);
  const [rejected, setRejected] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const timerRef = useRef<number | null>(null);
  // Each "round" the queue races: one request per round wins the conditional
  // write and increments version; the rest of that round's contenders take a
  // ConditionalCheckFailedException and retry. We track a logical position so
  // the same model drives both animated and reduced-motion runs.
  const queueRef = useRef<number[]>([]);

  function stop() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }
  useEffect(() => stop, []);

  function reset() {
    stop();
    setReqs(makeRequests());
    setStock(START_STOCK);
    setVersion(0);
    setWon(0);
    setRejected(0);
    setConflicts(0);
    setRunning(false);
    setDone(false);
    queueRef.current = [];
  }

  function settleInstant() {
    // Reduced-motion: compute the deterministic outcome in one shot.
    setReqs((prev) =>
      prev.map((r, i) => ({
        ...r,
        state: i < START_STOCK ? 'won' : 'rejected',
        attempts: i < START_STOCK ? 1 : 2,
      })),
    );
    setStock(0);
    setVersion(START_STOCK);
    setWon(START_STOCK);
    setRejected(REQUESTS - START_STOCK);
    setConflicts(REQUESTS - START_STOCK);
    setRunning(false);
    setDone(true);
  }

  function run() {
    if (running) return;
    reset();
    setRunning(true);

    if (reduce) {
      settleInstant();
      return;
    }

    // Build the contention queue: every request id, contending for one item.
    queueRef.current = Array.from({ length: REQUESTS }, (_, i) => i);
    let liveStock = START_STOCK;
    let liveVersion = 0;
    let liveWon = 0;
    let liveRejected = 0;
    let liveConflicts = 0;

    timerRef.current = window.setInterval(() => {
      const queue = queueRef.current;
      if (queue.length === 0) {
        stop();
        setRunning(false);
        setDone(true);
        return;
      }

      // A round of contention: a small batch of requests hits the item at once.
      const batchSize = Math.min(queue.length, 6);
      const batch = queue.splice(0, batchSize);

      setReqs((prev) => {
        const next = prev.slice();
        if (liveStock > 0) {
          // One winner per round commits the conditional UpdateItem.
          const winnerId = batch[0];
          next[winnerId] = {
            ...next[winnerId],
            state: 'won',
            attempts: next[winnerId].attempts + 1,
          };
          liveStock -= 1;
          liveVersion += 1;
          liveWon += 1;
          // The losers of this round take a conditional-check failure.
          for (let k = 1; k < batch.length; k++) {
            const id = batch[k];
            liveConflicts += 1;
            if (liveStock > 0) {
              next[id] = {
                ...next[id],
                state: 'retry',
                attempts: next[id].attempts + 1,
              };
              queue.push(id); // bounce back into the retry loop
            } else {
              next[id] = {
                ...next[id],
                state: 'rejected',
                attempts: next[id].attempts + 1,
              };
              liveRejected += 1;
            }
          }
        } else {
          // Stock is gone: everyone left is rejected with insufficient_stock.
          for (const id of batch) {
            next[id] = {
              ...next[id],
              state: 'rejected',
              attempts: next[id].attempts + 1,
            };
            liveRejected += 1;
          }
        }
        return next;
      });

      setStock(liveStock);
      setVersion(liveVersion);
      setWon(liveWon);
      setRejected(liveRejected);
      setConflicts(liveConflicts);
    }, 110);
  }

  const stockPct = Math.round((stock / START_STOCK) * 100);

  return (
    <div className="demo" aria-label="inventory-tracker conditional write demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">No oversell under contention</h3>
      <p className="demo__lede">
        Stock starts at {START_STOCK} for one SKU. Run {REQUESTS} reservation
        requests across three warehouse nodes at once. Each reserve is a
        DynamoDB conditional UpdateItem: one winner per race increments the
        version, losers take a ConditionalCheckFailedException and bounce into
        the retry loop until stock hits zero.
      </p>

      <div className="iv__stage">
        <div className="iv__item">
          <div className="iv__item-row">
            <div className="iv__item-name">SKU widget-001</div>
            <div className="iv__item-ver" aria-live="polite">
              version {version}
            </div>
          </div>
          <div className="iv__gauge" role="img" aria-label={`Available stock ${stock} of ${START_STOCK}`}>
            <motion.div
              className="iv__gauge-fill"
              animate={{ width: `${stockPct}%` }}
              transition={{ duration: reduce ? 0 : 0.25, ease }}
            />
            <div className="iv__gauge-label">
              <span>available</span>
              <b>{stock}</b>
            </div>
          </div>
          <div className="iv__cond">
            ConditionExpression: available &gt;= :qty AND version = :exp
          </div>
        </div>

        <div className="iv__nodes">
          {NODES.map((name, ni) => {
            const mine = reqs.filter((r) => r.node === ni);
            const wins = mine.filter((r) => r.state === 'won').length;
            return (
              <div className="iv__node" key={name}>
                <div className="iv__node-head">
                  <span className="iv__node-name">{name}</span>
                  <span className="iv__node-wins">{wins} held</span>
                </div>
                <div className="iv__dots">
                  {mine.map((r) => (
                    <motion.span
                      key={r.id}
                      className={`iv__dot iv__dot--${r.state}`}
                      title={`request ${r.id}: ${r.state}, ${r.attempts} attempt(s)`}
                      animate={
                        r.state === 'retry' && !reduce
                          ? { scale: [1, 1.5, 1] }
                          : { scale: 1 }
                      }
                      transition={{ duration: 0.3 }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="iv__tallies">
          <div className="iv__tally iv__tally--ok">
            <div className="iv__tally-val">{won}</div>
            <div className="iv__tally-name">reserved</div>
          </div>
          <div className="iv__tally iv__tally--rej">
            <div className="iv__tally-val">{rejected}</div>
            <div className="iv__tally-name">insufficient_stock</div>
          </div>
          <div className="iv__tally">
            <div className="iv__tally-val">{conflicts}</div>
            <div className="iv__tally-name">conditional retries</div>
          </div>
        </div>

        <AnimatePresence>
          {done && (
            <motion.div
              className="iv__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="iv__verdict-head">
                {won} reserved, {rejected} rejected, 0 oversold
              </span>
              <span className="iv__verdict-text">
                Exactly {START_STOCK} of {REQUESTS} requests win the SKU and the
                version counter lands on {version}. The other{' '}
                {REQUESTS - START_STOCK} get insufficient_stock with no
                application-level lock, matching the stress test of 50 successes
                and 50 rejections with zero unexpected errors.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Racing…' : `Run ${REQUESTS} reservations`}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          available {stock} / {START_STOCK}
        </span>
      </div>
    </div>
  );
}
