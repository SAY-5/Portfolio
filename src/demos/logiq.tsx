import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import type { Transition } from 'framer-motion';
import '../styles/demo.css';
import './logiq.css';

// Real mechanism: partition keys are the start of a fixed one-hour window
// formatted as YYYYMMDDHH. A bounded query restricts itself to overlapping
// partitions with a partition_key IN (...) predicate, so out-of-range
// partitions are never read. Pruning never changes results. Crash recovery
// replays the write-ahead log idempotently; store writes ignore record ids
// that already exist, so a replayed batch lands exactly once.

const ease = [0.22, 1, 0.36, 1] as const;
const spring: Transition = { type: 'spring', stiffness: 320, damping: 30 };

// Twelve consecutive one-hour partitions on a single day, with the row count
// each partition holds. The key is the window start formatted YYYYMMDDHH.
const DAY = '20260601';
const partitions = [
  { hour: 0, rows: 412 },
  { hour: 1, rows: 388 },
  { hour: 2, rows: 351 },
  { hour: 3, rows: 297 },
  { hour: 4, rows: 264 },
  { hour: 5, rows: 419 },
  { hour: 6, rows: 906 },
  { hour: 7, rows: 1284 },
  { hour: 8, rows: 1671 },
  { hour: 9, rows: 1548 },
  { hour: 10, rows: 1402 },
  { hour: 11, rows: 1190 },
];
const TOTAL_ROWS = partitions.reduce((s, p) => s + p.rows, 0);

function keyOf(hour: number) {
  return `${DAY}${String(hour).padStart(2, '0')}`;
}

type WalEntry = { id: number; label: string };
const walBatch: WalEntry[] = [
  { id: 8801, label: 'rec 8801' },
  { id: 8802, label: 'rec 8802' },
  { id: 8803, label: 'rec 8803' },
  { id: 8804, label: 'rec 8804' },
];

export default function LogiqDemo() {
  const reduce = useReducedMotion();
  // Inclusive partition-hour bounds for the bounded query.
  const [lo, setLo] = useState(4);
  const [hi, setHi] = useState(8);

  // The overlapping partitions the planner keeps in partition_key IN (...).
  const lowH = Math.min(lo, hi);
  const highH = Math.max(lo, hi);
  const scanned = partitions.filter((p) => p.hour >= lowH && p.hour <= highH);
  const scannedRows = scanned.reduce((s, p) => s + p.rows, 0);
  const prunedCount = partitions.length - scanned.length;
  const readPct = Math.round((scannedRows / TOTAL_ROWS) * 100);

  return (
    <div className="demo" aria-label="LogIQ partition pruning and crash recovery demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Partition pruning and crash replay</h3>
      <p className="demo__lede">
        Each bucket is a one-hour partition keyed by its window start as
        YYYYMMDDHH. Move the query bounds: only partitions that overlap the
        range stay lit, the rest are skipped by a partition_key IN (...)
        predicate. The same records come back either way. Below, replay a
        write-ahead log after a crash and watch it refill the store once.
      </p>

      <Pruning
        reduce={!!reduce}
        lo={lo}
        hi={hi}
        setLo={setLo}
        setHi={setHi}
        lowH={lowH}
        highH={highH}
        scanned={scanned}
        scannedRows={scannedRows}
        prunedCount={prunedCount}
        readPct={readPct}
      />

      <Replay reduce={!!reduce} />
    </div>
  );
}

function Pruning(props: {
  reduce: boolean;
  lo: number;
  hi: number;
  setLo: (n: number) => void;
  setHi: (n: number) => void;
  lowH: number;
  highH: number;
  scanned: { hour: number; rows: number }[];
  scannedRows: number;
  prunedCount: number;
  readPct: number;
}) {
  const {
    reduce,
    lo,
    hi,
    setLo,
    setHi,
    lowH,
    highH,
    scanned,
    scannedRows,
    prunedCount,
    readPct,
  } = props;

  return (
    <section className="lq__block" aria-label="partition pruning">
      <div className="lq__timeline" role="group" aria-label="hourly partition timeline">
        {partitions.map((p) => {
          const inRange = p.hour >= lowH && p.hour <= highH;
          const h = Math.max(10, Math.round((p.rows / 1671) * 64));
          return (
            <div key={p.hour} className="lq__col">
              <div className="lq__bar-wrap">
                <motion.div
                  className={`lq__bar ${inRange ? 'lq__bar--on' : 'lq__bar--off'}`}
                  style={{ height: h }}
                  animate={{ opacity: inRange ? 1 : 0.28 }}
                  transition={{ duration: reduce ? 0 : 0.25, ease }}
                  aria-hidden="true"
                />
              </div>
              <div className={`lq__key ${inRange ? 'lq__key--on' : ''}`}>
                {String(p.hour).padStart(2, '0')}
              </div>
            </div>
          );
        })}
      </div>

      <div className="lq__sliders">
        <label className="lq__slider-row">
          <span className="lq__slider-label">
            range start <b>{keyOf(lo)}</b>
          </span>
          <input
            className="lq__slider"
            type="range"
            min={0}
            max={partitions.length - 1}
            value={lo}
            onChange={(e) => setLo(Number(e.target.value))}
            aria-label="query range start partition"
          />
        </label>
        <label className="lq__slider-row">
          <span className="lq__slider-label">
            range end <b>{keyOf(hi)}</b>
          </span>
          <input
            className="lq__slider"
            type="range"
            min={0}
            max={partitions.length - 1}
            value={hi}
            onChange={(e) => setHi(Number(e.target.value))}
            aria-label="query range end partition"
          />
        </label>
      </div>

      <pre className="lq__sql" aria-label="generated predicate">
        <span className="lq__sql-kw">SELECT</span> * <span className="lq__sql-kw">FROM</span> logs
        {'\n'}
        <span className="lq__sql-kw">WHERE</span> partition_key{' '}
        <span className="lq__sql-kw">IN</span> (
        {scanned.map((p) => keyOf(p.hour)).join(', ')})
      </pre>

      <div className="lq__stats">
        <div className="lq__stat">
          <div className="lq__stat-val">{scanned.length}</div>
          <div className="lq__stat-unit">partitions scanned</div>
        </div>
        <div className="lq__stat lq__stat--pruned">
          <div className="lq__stat-val">{prunedCount}</div>
          <div className="lq__stat-unit">pruned, never read</div>
        </div>
        <div className="lq__stat">
          <div className="lq__stat-val">
            {readPct}
            <span className="lq__stat-pct">%</span>
          </div>
          <div className="lq__stat-unit">
            {scannedRows.toLocaleString()} of {TOTAL_ROWS.toLocaleString()} rows
          </div>
        </div>
      </div>
    </section>
  );
}

type Phase = 'idle' | 'crash' | 'replay' | 'done';

function Replay({ reduce }: { reduce: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle');
  // Index of the next WAL entry to apply; ids already in the store are skipped.
  const [applied, setApplied] = useState(0);
  // One entry from this batch was already committed before the crash, so on
  // replay it is recognized as a duplicate and ignored, landing exactly once.
  const committedBefore = useRef<Set<number>>(new Set([8801]));
  const [duplicatesSkipped, setDuplicatesSkipped] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => clearTimer, []);

  function reset() {
    clearTimer();
    setPhase('idle');
    setApplied(0);
    setDuplicatesSkipped(0);
    committedBefore.current = new Set([8801]);
  }

  function run() {
    if (phase === 'replay') return;
    clearTimer();
    setPhase('crash');
    setApplied(0);
    setDuplicatesSkipped(0);

    if (reduce) {
      // Collapse to the settled state instantly.
      setDuplicatesSkipped(1);
      setApplied(walBatch.length);
      setPhase('done');
      return;
    }

    const stepDelay = 620;
    timer.current = setTimeout(() => setPhase('replay'), 760);

    const apply = (idx: number) => {
      if (idx >= walBatch.length) {
        setPhase('done');
        return;
      }
      const entry = walBatch[idx];
      if (committedBefore.current.has(entry.id)) {
        setDuplicatesSkipped((d) => d + 1);
      } else {
        committedBefore.current.add(entry.id);
      }
      setApplied(idx + 1);
      timer.current = setTimeout(() => apply(idx + 1), stepDelay);
    };

    timer.current = setTimeout(() => {
      setPhase('replay');
      apply(0);
    }, 900);
  }

  const storeIds = walBatch.slice(0, applied).map((e) => e.id);
  const uniqueLanded = new Set(storeIds).size;

  return (
    <section className="lq__block lq__replay" aria-label="crash and write-ahead log replay">
      <div className="lq__replay-head">
        <span className="lq__replay-title">Write-ahead log replay</span>
        <span
          className={`lq__replay-phase lq__replay-phase--${phase}`}
          aria-live="polite"
        >
          {phase === 'idle' && 'ready'}
          {phase === 'crash' && 'process crashed mid-batch'}
          {phase === 'replay' && 'replaying log'}
          {phase === 'done' && 'store recovered'}
        </span>
      </div>

      <div className="lq__replay-grid">
        <div className="lq__wal">
          <div className="lq__col-head">acknowledged WAL batch</div>
          <div className="lq__wal-list">
            {walBatch.map((e, i) => {
              const isApplied = i < applied;
              const wasDup = e.id === 8801;
              return (
                <motion.div
                  key={e.id}
                  className={`lq__wal-item ${isApplied ? 'lq__wal-item--applied' : ''}`}
                  animate={{
                    opacity: phase === 'crash' ? 0.5 : 1,
                    x: isApplied && !reduce ? 4 : 0,
                  }}
                  transition={spring}
                >
                  <span className="lq__wal-id">{e.label}</span>
                  <span className="lq__wal-flag">
                    {isApplied
                      ? wasDup
                        ? 'duplicate, skipped'
                        : 'written'
                      : 'pending'}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </div>

        <div className="lq__arrow" aria-hidden="true">
          <motion.span
            animate={{ opacity: phase === 'replay' ? [0.3, 1, 0.3] : 0.4 }}
            transition={{
              duration: 1.1,
              repeat: phase === 'replay' && !reduce ? Infinity : 0,
              ease: 'linear',
            }}
          >
            replay
          </motion.span>
        </div>

        <div className="lq__store">
          <div className="lq__col-head">store after replay</div>
          <div className="lq__store-list">
            <AnimatePresence>
              {storeIds.map((id) => (
                <motion.div
                  key={id}
                  className="lq__store-item"
                  initial={{ opacity: 0, scale: reduce ? 1 : 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={spring}
                >
                  rec {id}
                </motion.div>
              ))}
            </AnimatePresence>
            {storeIds.length === 0 && (
              <span className="lq__store-empty">empty</span>
            )}
          </div>
          <div className="lq__store-meta">
            {uniqueLanded} unique row{uniqueLanded === 1 ? '' : 's'} landed
            {duplicatesSkipped > 0 && `, ${duplicatesSkipped} duplicate skipped`}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {phase === 'done' && (
          <motion.div
            className="lq__verdict"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            <span className="lq__verdict-head">No loss, no duplication</span>
            <span className="lq__verdict-text">
              The batch was acknowledged only after it was flushed to the log.
              On restart the log replayed; the already-committed record was
              recognized by id and ignored, so all {walBatch.length} records
              land exactly once.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={run}
          disabled={phase === 'crash' || phase === 'replay'}
        >
          {phase === 'crash' || phase === 'replay' ? 'Replaying…' : 'Crash and replay'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={phase === 'crash' || phase === 'replay'}
        >
          Reset
        </button>
      </div>
    </section>
  );
}
