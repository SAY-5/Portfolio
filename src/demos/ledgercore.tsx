import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './ledgercore.css';

// Real mechanism: each transaction lands in a per-worker lock-free SPSC ring
// buffer (partitioned by account), is serialized and fsync'd to the WAL before
// any state mutation, then applied as a balanced debit/credit pair. Three-layer
// idempotency (LRU of seen keys, Postgres mirror, UNIQUE index) drops repeats.

const ease = [0.22, 1, 0.36, 1] as const;

type Txn = {
  id: string;
  key: string;
  worker: number;
  amount: number;
  debit: string;
  credit: string;
  dup: boolean;
};

// A fixed feed so the demo is deterministic. The fourth item reuses idem key
// idem-7a3 from the first, so it is the one silently rejected at the LRU.
const FEED: Txn[] = [
  { id: 'tx-01', key: 'idem-7a3', worker: 0, amount: 1200, debit: 'cash', credit: 'rev', dup: false },
  { id: 'tx-02', key: 'idem-b18', worker: 1, amount: 450, debit: 'fees', credit: 'cash', dup: false },
  { id: 'tx-03', key: 'idem-c52', worker: 0, amount: 980, debit: 'cash', credit: 'rev', dup: false },
  { id: 'tx-04', key: 'idem-7a3', worker: 1, amount: 1200, debit: 'cash', credit: 'rev', dup: true },
  { id: 'tx-05', key: 'idem-d09', worker: 2, amount: 300, debit: 'refund', credit: 'cash', dup: false },
  { id: 'tx-06', key: 'idem-e71', worker: 1, amount: 760, debit: 'cash', credit: 'rev', dup: false },
  { id: 'tx-07', key: 'idem-f44', worker: 2, amount: 540, debit: 'fees', credit: 'cash', dup: false },
  { id: 'tx-08', key: 'idem-a90', worker: 0, amount: 1500, debit: 'cash', credit: 'rev', dup: false },
];

const WORKERS = [0, 1, 2];

type Applied = Txn & { seq: number };

export default function LedgercoreDemo() {
  const reduce = useReducedMotion();
  const [running, setRunning] = useState(false);
  const [idx, setIdx] = useState(0);
  const [inFlight, setInFlight] = useState<Txn | null>(null);
  const [gateActive, setGateActive] = useState(false);
  const [applied, setApplied] = useState<Applied[]>([]);
  const [fsyncs, setFsyncs] = useState(0);
  const [rejected, setRejected] = useState(0);
  const timers = useRef<number[]>([]);

  const totalDebit = applied
    .filter((a) => !a.dup)
    .reduce((s, a) => s + a.amount, 0);
  const totalCredit = totalDebit; // double-entry: debits == credits by construction

  function clearTimers() {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }

  useEffect(() => clearTimers, []);

  function reset() {
    clearTimers();
    setRunning(false);
    setIdx(0);
    setInFlight(null);
    setGateActive(false);
    setApplied([]);
    setFsyncs(0);
    setRejected(0);
  }

  function settle(txn: Txn, seq: number) {
    if (txn.dup) {
      setRejected((r) => r + 1);
      setApplied((prev) => [...prev, { ...txn, seq }]);
      return;
    }
    setFsyncs((f) => f + 1);
    setApplied((prev) => [...prev, { ...txn, seq }]);
  }

  function step(i: number) {
    if (i >= FEED.length) {
      setRunning(false);
      setInFlight(null);
      setGateActive(false);
      return;
    }
    const txn = FEED[i];
    setIdx(i + 1);
    setInFlight(txn);
    setGateActive(false);

    if (reduce) {
      setGateActive(true);
      settle(txn, i);
      setInFlight(null);
      setGateActive(false);
      const t = window.setTimeout(() => step(i + 1), 0);
      timers.current.push(t);
      return;
    }

    // travel through the ring, hit the fsync gate, then settle
    const tGate = window.setTimeout(() => setGateActive(true), 520);
    const tSettle = window.setTimeout(() => {
      settle(txn, i);
      setInFlight(null);
      setGateActive(false);
    }, 900);
    const tNext = window.setTimeout(() => step(i + 1), 1180);
    timers.current.push(tGate, tSettle, tNext);
  }

  function run() {
    if (running) return;
    reset();
    setRunning(true);
    const t = window.setTimeout(() => step(0), reduce ? 0 : 60);
    timers.current.push(t);
  }

  return (
    <div className="demo" aria-label="ledgercore transaction pipeline demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Through the ring, past the WAL, into balance</h3>
      <p className="demo__lede">
        Play the feed to watch transactions enter per-worker ring buffers,
        serialize and fsync to the write-ahead log before any state changes,
        then settle as balanced debit and credit pairs. A reused idempotency key
        is dropped at the seen-keys layer with nothing written.
      </p>

      <div className="lc__stage">
        <div className="lc__pipeline">
          <div className="lc__workers">
            {WORKERS.map((w) => {
              const here = inFlight && inFlight.worker === w;
              return (
                <div className="lc__worker" key={w}>
                  <span className="lc__worker-tag">
                    <b>worker {w}</b>
                    SPSC ring
                  </span>
                  <div className="lc__ring" aria-label={`worker ${w} ring buffer`}>
                    {[0, 1, 2, 3, 4].map((s) => (
                      <span className="lc__slot" key={s} />
                    ))}
                    <AnimatePresence>
                      {here && inFlight && (
                        <motion.span
                          key={inFlight.id}
                          className={`lc__txn${inFlight.dup ? ' lc__txn--dup' : ''}`}
                          initial={{ left: reduce ? '78%' : '6%', opacity: 0 }}
                          animate={{ left: '78%', opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: reduce ? 0 : 0.5, ease }}
                        >
                          {inFlight.id.replace('tx-', '#')}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              );
            })}
          </div>

          <div className={`lc__gate${gateActive ? ' lc__gate--active' : ''}`}>
            <span className="lc__gate-icon" />
            <span className="lc__gate-label">
              <b>WAL fsync gate</b> serialize, fsync, then apply
            </span>
            <span className="lc__gate-count">{fsyncs} committed</span>
          </div>
        </div>

        <div className="lc__ledger">
          <div className="lc__ledger-head">
            <span>Ledger (double-entry)</span>
            <span className="lc__ledger-balance">
              dr {totalDebit.toLocaleString()} = cr {totalCredit.toLocaleString()}
            </span>
          </div>
          <ul className="lc__rows">
            {applied.length === 0 && (
              <li className="lc__rows-empty">No entries yet. Press Play feed.</li>
            )}
            <AnimatePresence initial={false}>
              {applied.map((a) => (
                <motion.li
                  key={a.id + a.seq}
                  className={`lc__row${a.dup ? ' lc__row--dup' : ''}`}
                  initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduce ? 0 : 0.32, ease }}
                >
                  <span className="lc__row-id">{a.id}</span>
                  <span className="lc__row-pair">
                    {a.debit} → {a.credit}
                  </span>
                  {a.dup ? (
                    <span className="lc__row-flag">
                      duplicate {a.key} rejected, no write
                    </span>
                  ) : (
                    <>
                      <span className="lc__row-dr">dr {a.amount.toLocaleString()}</span>
                      <span className="lc__row-cr">cr {a.amount.toLocaleString()}</span>
                    </>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>

        <div className="lc__stats">
          <div className="lc__stat">
            <span className="lc__stat-val">{fsyncs}</span>
            <span className="lc__stat-label">WAL records fsync'd</span>
          </div>
          <div className="lc__stat">
            <span className="lc__stat-val">{idx}</span>
            <span className="lc__stat-label">intake of {FEED.length}</span>
          </div>
          <div className="lc__stat lc__stat--dedup">
            <span className="lc__stat-val">{rejected}</span>
            <span className="lc__stat-label">duplicate keys dropped</span>
          </div>
        </div>

        <div className="lc__invariant" role="status">
          <span className="lc__invariant-eq">debits = credits</span>
          <span className="lc__invariant-text">
            The balanced invariant is checked at intake, at WAL append, and at
            apply time, where a mismatch aborts on memory corruption. Idempotency
            runs three layers deep: a bounded LRU of seen keys, a Postgres mirror,
            and a UNIQUE index as the final net.
          </span>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Running…' : 'Play feed'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {FEED.length} transactions, 1 duplicate key, 3 partitioned workers
        </span>
      </div>
    </div>
  );
}
