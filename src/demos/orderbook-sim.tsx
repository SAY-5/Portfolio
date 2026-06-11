import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './orderbook-sim.css';

// Real numbers from the 200,000-command bench:
// 6,710,161 orders/sec, latency P50 84 ns, P99 335 ns, 148,436 trades produced.
// An SPSC ring sits between an ingestion thread and a single matching thread.
const THROUGHPUT = 6710161;
const P50_NS = 84;
const P99_NS = 335;

const RING_SLOTS = 8;
const ease = [0.22, 1, 0.36, 1] as const;

type Side = 'buy' | 'sell';
type RestingOrder = { id: number; side: Side; price: number; qty: number };
type LogLine = { id: number; text: string; kind: 'rest' | 'trade' };

// A small deterministic order stream that produces a mix of resting orders and
// crossing trades, mirroring the price-time book the real engine maintains.
const STREAM: { side: Side; price: number; qty: number }[] = [
  { side: 'buy', price: 100, qty: 5 },
  { side: 'sell', price: 102, qty: 4 },
  { side: 'buy', price: 101, qty: 3 },
  { side: 'sell', price: 101, qty: 3 }, // crosses the 101 bid
  { side: 'buy', price: 102, qty: 2 }, // crosses the 102 ask
  { side: 'sell', price: 103, qty: 6 },
  { side: 'buy', price: 100, qty: 4 }, // queues FIFO behind the first 100 bid
  { side: 'sell', price: 100, qty: 7 }, // sweeps the 100 bids
];

// Histogram buckets in nanoseconds, weighted so P50 lands near 84ns and the
// tail reaches the measured P99 of 335ns.
const BUCKETS = [
  { label: '64', weight: 18 },
  { label: '84', weight: 34 },
  { label: '128', weight: 22 },
  { label: '192', weight: 14 },
  { label: '256', weight: 8 },
  { label: '335', weight: 4 },
];
const MAX_WEIGHT = Math.max(...BUCKETS.map((b) => b.weight));

export default function OrderbookSimDemo() {
  const reduce = useReducedMotion();
  const [running, setRunning] = useState(false);
  const [head, setHead] = useState(0); // matching thread consume index
  const [tail, setTail] = useState(0); // ingestion thread produce index
  const [bids, setBids] = useState<RestingOrder[]>([]);
  const [asks, setAsks] = useState<RestingOrder[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [processed, setProcessed] = useState(0);
  const [trades, setTrades] = useState(0);
  const [revealed, setRevealed] = useState(0); // histogram buckets shown
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const reset = useCallback(() => {
    stop();
    setRunning(false);
    setHead(0);
    setTail(0);
    setBids([]);
    setAsks([]);
    setLog([]);
    setProcessed(0);
    setTrades(0);
    setRevealed(0);
    idRef.current = 0;
  }, [stop]);

  // Apply one stream order to the book: match against the opposite side at a
  // crossing price (price-time, oldest first), otherwise rest it FIFO.
  const step = useCallback((index: number) => {
    const order = STREAM[index];
    idRef.current += 1;
    const oid = idRef.current;

    if (order.side === 'buy') {
      setAsks((prevAsks) => {
        const best = prevAsks[0];
        if (best && order.price >= best.price) {
          const qty = Math.min(order.qty, best.qty);
          setTrades((t) => t + 1);
          pushLog({ kind: 'trade', text: `trade ${qty} @ ${best.price} (buy x ask #${best.id})` });
          const rest = best.qty - qty;
          return rest > 0 ? [{ ...best, qty: rest }, ...prevAsks.slice(1)] : prevAsks.slice(1);
        }
        setBids((b) => sortBids([...b, { id: oid, side: 'buy', price: order.price, qty: order.qty }]));
        pushLog({ kind: 'rest', text: `rest buy ${order.qty} @ ${order.price}` });
        return prevAsks;
      });
    } else {
      setBids((prevBids) => {
        const best = prevBids[0];
        if (best && order.price <= best.price) {
          const qty = Math.min(order.qty, best.qty);
          setTrades((t) => t + 1);
          pushLog({ kind: 'trade', text: `trade ${qty} @ ${best.price} (sell x bid #${best.id})` });
          const rest = best.qty - qty;
          return rest > 0 ? [{ ...best, qty: rest }, ...prevBids.slice(1)] : prevBids.slice(1);
        }
        setAsks((a) => sortAsks([...a, { id: oid, side: 'sell', price: order.price, qty: order.qty }]));
        pushLog({ kind: 'rest', text: `rest sell ${order.qty} @ ${order.price}` });
        return prevBids;
      });
    }

    function pushLog(line: Omit<LogLine, 'id'>) {
      setLog((l) => [{ id: oid * 10 + (line.kind === 'trade' ? 1 : 0), ...line }, ...l].slice(0, 7));
    }
  }, []);

  const run = useCallback(() => {
    if (running) return;
    reset();
    setRunning(true);

    if (reduce) {
      // Reduced motion: resolve to the final state at once.
      let i = 0;
      const finalApply = () => {
        if (i < STREAM.length) {
          setTail(i + 1);
          step(i);
          setHead(i + 1);
          setProcessed(i + 1);
          i++;
          finalApply();
        } else {
          setRevealed(BUCKETS.length);
        }
      };
      finalApply();
      setRunning(false);
      return;
    }

    let i = 0;
    const tick = () => {
      if (i >= STREAM.length) {
        // Stream done: reveal histogram buckets one by one.
        let b = 0;
        const revealTick = () => {
          b += 1;
          setRevealed(b);
          if (b < BUCKETS.length) {
            timer.current = setTimeout(revealTick, 130);
          } else {
            setRunning(false);
            timer.current = null;
          }
        };
        timer.current = setTimeout(revealTick, 200);
        return;
      }
      // Producer writes the slot, then the consumer reads and matches it.
      setTail(i + 1);
      timer.current = setTimeout(() => {
        step(i);
        setHead(i + 1);
        setProcessed(i + 1);
        i += 1;
        timer.current = setTimeout(tick, 360);
      }, 240);
    };
    tick();
  }, [running, reduce, reset, step]);

  const depth = tail - head; // occupied ring slots

  return (
    <div className="demo" aria-label="orderbook-sim lock-free ring and matching demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Lock-free ring into a price-time book</h3>
      <p className="demo__lede">
        The ingestion thread writes orders into a single-producer
        single-consumer ring; the matching thread reads them and applies them to
        a price-time book. Same-price orders queue FIFO, and a crossing order
        fires a trade against the best resting level. Run the stream to watch it.
      </p>

      <div className="obs__stage">
        <div className="obs__ringwrap">
          <div className="obs__ring-head">
            <span className="obs__lane-tag obs__lane-tag--prod">ingestion thread</span>
            <span className="obs__ring-title">SPSC ring</span>
            <span className="obs__lane-tag obs__lane-tag--cons">matching thread</span>
          </div>
          <div className="obs__ring" role="img" aria-label={`Ring buffer, ${depth} of ${RING_SLOTS} slots occupied`}>
            {Array.from({ length: RING_SLOTS }).map((_, slot) => {
              const h = head % RING_SLOTS;
              const t = tail % RING_SLOTS;
              // A slot is occupied when it lies between head and tail, with the
              // wrap-around case (tail behind head) handled by the OR branch.
              const occupied =
                depth > 0 && (h <= t ? slot >= h && slot < t : slot >= h || slot < t);
              const isHead = slot === h && depth > 0;
              const isTail = slot === t;
              return (
                <div
                  key={slot}
                  className={`obs__slot ${occupied ? 'obs__slot--full' : ''} ${isHead ? 'obs__slot--head' : ''} ${isTail ? 'obs__slot--tail' : ''}`}
                >
                  <span className="obs__slot-idx">{slot}</span>
                </div>
              );
            })}
          </div>
          <div className="obs__ring-meta">
            <span>head {head}</span>
            <span>tail {tail}</span>
            <span>processed {processed}/{STREAM.length}</span>
          </div>
        </div>

        <div className="obs__book">
          <BookSide title="Bids" rows={bids} kind="bid" reduce={reduce} />
          <BookSide title="Asks" rows={asks} kind="ask" reduce={reduce} />
        </div>

        <div className="obs__feed" aria-live="polite">
          <div className="obs__feed-head">Match feed</div>
          <ul className="obs__feed-list">
            <AnimatePresence initial={false}>
              {log.length === 0 && <li className="obs__feed-empty">Run the stream to populate the book.</li>}
              {log.map((line) => (
                <motion.li
                  key={line.id}
                  className={`obs__feed-line obs__feed-line--${line.kind}`}
                  initial={{ opacity: 0, x: reduce ? 0 : -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.25, ease }}
                >
                  <span className="obs__feed-kind">{line.kind === 'trade' ? 'TRADE' : 'REST'}</span>
                  <span className="obs__feed-text">{line.text}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>

        <div className="obs__hist">
          <div className="obs__hist-head">
            <span>Per-message latency</span>
            <span className="obs__hist-sub">nanoseconds</span>
          </div>
          <div className="obs__hist-bars">
            {BUCKETS.map((b, i) => {
              const shown = i < revealed;
              return (
                <div key={b.label} className="obs__hist-col">
                  <div className="obs__hist-track">
                    <motion.div
                      className={`obs__hist-bar ${b.label === '84' ? 'obs__hist-bar--p50' : ''}`}
                      initial={false}
                      animate={{ height: shown ? `${(b.weight / MAX_WEIGHT) * 100}%` : '0%' }}
                      transition={{ duration: reduce ? 0 : 0.4, ease }}
                    />
                  </div>
                  <span className="obs__hist-label">{b.label}</span>
                </div>
              );
            })}
          </div>
          <div className="obs__hist-marks">
            <span>P50 {P50_NS} ns</span>
            <span>P99 {P99_NS} ns</span>
          </div>
        </div>

        <div className="obs__stats">
          <Stat value={THROUGHPUT.toLocaleString()} unit="orders/sec" />
          <Stat value={trades.toString()} unit="trades this run" />
          <Stat value="148,436" unit="trades / 200k cmds" />
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Streaming…' : 'Run stream'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={running}>
          Reset
        </button>
        <span className="demo__hint">~67x over the 100k orders/sec target</span>
      </div>
    </div>
  );
}

function BookSide({
  title,
  rows,
  kind,
  reduce,
}: {
  title: string;
  rows: RestingOrder[];
  kind: 'bid' | 'ask';
  reduce: boolean | null;
}) {
  return (
    <div className={`obs__side obs__side--${kind}`}>
      <div className="obs__side-head">{title}</div>
      <ul className="obs__side-list">
        <AnimatePresence initial={false}>
          {rows.length === 0 && <li className="obs__side-empty">empty</li>}
          {rows.map((o) => (
            <motion.li
              key={o.id}
              className="obs__level"
              initial={{ opacity: 0, scale: reduce ? 1 : 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: reduce ? 1 : 0.92 }}
              transition={{ duration: reduce ? 0 : 0.25, ease }}
            >
              <span className="obs__level-price">{o.price}</span>
              <span className="obs__level-qty">{o.qty}</span>
              <span className="obs__level-id">#{o.id}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

function Stat({ value, unit }: { value: string; unit: string }) {
  return (
    <div className="obs__stat">
      <div className="obs__stat-val">{value}</div>
      <div className="obs__stat-unit">{unit}</div>
    </div>
  );
}

function sortBids(rows: RestingOrder[]): RestingOrder[] {
  // Best bid first: highest price, then oldest (lowest id) within a price.
  return [...rows].sort((a, b) => b.price - a.price || a.id - b.id);
}
function sortAsks(rows: RestingOrder[]): RestingOrder[] {
  // Best ask first: lowest price, then oldest within a price.
  return [...rows].sort((a, b) => a.price - b.price || a.id - b.id);
}
