import { useMemo, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './orderbook-fix.css';

// Real numbers from the project bench on Apple M2 Pro:
// FIFO 6,798 msgs/sec (P50 65,536 ns) vs pro-rata 2,641 msgs/sec (P50 524,288 ns).
// Pro-rata pays ~2.5x in throughput because it snapshots every resting order at
// the touched level (O(level depth) per match). The rounding residual goes FIFO
// to the oldest order, pinned by the ProportionalAllocationWithRounding test.
const FIFO_THROUGHPUT = 6798;
const PRORATA_THROUGHPUT = 2641;
const FIFO_P50_NS = 65536;
const PRORATA_P50_NS = 524288;

type Mode = 'prorata' | 'fifo';

// A single resting price level: oldest order first (top of the FIFO queue).
type Resting = { id: string; party: string; qty: number };

const LEVEL_PRICE = 101.25;
const RESTING: Resting[] = [
  { id: 'o1', party: 'A', qty: 400 },
  { id: 'o2', party: 'B', qty: 250 },
  { id: 'o3', party: 'C', qty: 150 },
  { id: 'o4', party: 'D', qty: 100 },
];

const TOTAL_RESTING = RESTING.reduce((s, o) => s + o.qty, 0); // 900
const ease = [0.22, 1, 0.36, 1] as const;

type Fill = { id: string; party: string; raw: number; fill: number; residual: number };

// Pro-rata: each resting order gets floor(incoming * qty / total). The leftover
// rounding residual is handed FIFO to the oldest order at the level.
function allocateProrata(incoming: number): Fill[] {
  const fills = RESTING.map((o) => {
    const raw = (incoming * o.qty) / TOTAL_RESTING;
    const fill = Math.min(o.qty, Math.floor(raw));
    return { id: o.id, party: o.party, raw, fill, residual: 0 };
  });
  const allocated = fills.reduce((s, f) => s + f.fill, 0);
  let residual = Math.min(incoming, TOTAL_RESTING) - allocated;
  // Residual hops FIFO down the queue, oldest first, capped by remaining qty.
  for (let i = 0; i < fills.length && residual > 0; i++) {
    const cap = RESTING[i].qty - fills[i].fill;
    const give = Math.min(cap, residual);
    fills[i].fill += give;
    fills[i].residual = give;
    residual -= give;
  }
  return fills;
}

// FIFO: fill the oldest order fully, then the next, until the incoming runs out.
function allocateFifo(incoming: number): Fill[] {
  let remaining = incoming;
  return RESTING.map((o) => {
    const fill = Math.min(o.qty, remaining);
    remaining -= fill;
    return { id: o.id, party: o.party, raw: fill, fill, residual: 0 };
  });
}

export default function OrderbookFixDemo() {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<Mode>('prorata');
  const [incoming, setIncoming] = useState(500);
  const [matched, setMatched] = useState(false);

  const fills = useMemo(
    () => (mode === 'prorata' ? allocateProrata(incoming) : allocateFifo(incoming)),
    [mode, incoming],
  );

  const filledTotal = fills.reduce((s, f) => s + f.fill, 0);
  const throughput = mode === 'prorata' ? PRORATA_THROUGHPUT : FIFO_THROUGHPUT;
  const p50 = mode === 'prorata' ? PRORATA_P50_NS : FIFO_P50_NS;
  const residualOrder = fills.find((f) => f.residual > 0);

  function setModeReset(m: Mode) {
    setMode(m);
    setMatched(false);
  }

  return (
    <div className="demo" aria-label="orderbook-fix pro-rata allocation demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Pro-rata allocation at a price level</h3>
      <p className="demo__lede">
        An aggressor order hits one price level holding four resting orders. In
        pro-rata mode each resting order takes a share of the fill in proportion
        to its size, and the rounding residual hops FIFO to the oldest order.
        Toggle to FIFO to fill strictly oldest first. Drag the size and match.
      </p>

      <div className="obf__modes" role="tablist" aria-label="Matching mode">
        <button
          role="tab"
          aria-selected={mode === 'prorata'}
          className={`obf__mode ${mode === 'prorata' ? 'obf__mode--on' : ''}`}
          onClick={() => setModeReset('prorata')}
        >
          Pro-rata
        </button>
        <button
          role="tab"
          aria-selected={mode === 'fifo'}
          className={`obf__mode ${mode === 'fifo' ? 'obf__mode--on' : ''}`}
          onClick={() => setModeReset('fifo')}
        >
          FIFO
        </button>
      </div>

      <div className="obf__stage">
        <div className="obf__incoming">
          <div className="obf__incoming-head">
            <span>Aggressor sell</span>
            <span className="obf__incoming-price">@ {LEVEL_PRICE.toFixed(2)}</span>
          </div>
          <label className="obf__slider-label" htmlFor="obf-size">
            <span>Order size</span>
            <b>{incoming} qty</b>
          </label>
          <input
            id="obf-size"
            className="obf__slider"
            type="range"
            min={100}
            max={900}
            step={50}
            value={incoming}
            onChange={(e) => {
              setIncoming(Number(e.target.value));
              setMatched(false);
            }}
            aria-valuetext={`${incoming} quantity`}
          />
          <div className="obf__incoming-meta">
            level depth {TOTAL_RESTING} qty across {RESTING.length} resting orders
          </div>
        </div>

        <ul className="obf__ladder" aria-label={`Resting orders at ${LEVEL_PRICE}`}>
          {RESTING.map((o, i) => {
            const f = fills[i];
            const pct = matched ? (f.fill / o.qty) * 100 : 0;
            const sharePct = ((o.qty / TOTAL_RESTING) * 100).toFixed(1);
            return (
              <li
                key={o.id}
                className={`obf__row ${matched && f.fill > 0 ? 'obf__row--hit' : ''}`}
              >
                <div className="obf__row-head">
                  <span className="obf__row-party">Party {o.party}</span>
                  <span className="obf__row-qty">{o.qty} resting</span>
                  {i === 0 && <span className="obf__row-tag">oldest</span>}
                </div>
                <div className="obf__bar" role="img" aria-label={`Filled ${f.fill} of ${o.qty}`}>
                  <motion.div
                    className="obf__bar-fill"
                    initial={false}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: reduce ? 0 : 0.55, delay: reduce ? 0 : i * 0.1, ease }}
                  />
                  {matched && f.residual > 0 && (
                    <motion.div
                      className="obf__bar-residual"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : 0.7 }}
                      style={{
                        left: `${((f.fill - f.residual) / o.qty) * 100}%`,
                        width: `${(f.residual / o.qty) * 100}%`,
                      }}
                    />
                  )}
                </div>
                <div className="obf__row-foot">
                  <span>{mode === 'prorata' ? `${sharePct}% share` : 'fill oldest first'}</span>
                  {matched && (
                    <span className="obf__row-fill">
                      {f.fill} filled
                      {f.residual > 0 && <em> (+{f.residual} residual)</em>}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <AnimatePresence>
          {matched && (
            <motion.div
              className="obf__result"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <div className="obf__result-line">
                <b>{filledTotal}</b> of {incoming} matched at {LEVEL_PRICE.toFixed(2)}
                {mode === 'prorata' && residualOrder && (
                  <>
                    , rounding residual went to the oldest order (Party{' '}
                    <span className="obf__hi">{residualOrder.party}</span>)
                  </>
                )}
                {mode === 'fifo' && ', oldest orders filled first'}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="obf__bench">
          <div className="obf__bench-cell">
            <div className="obf__bench-name">{mode === 'prorata' ? 'Pro-rata' : 'FIFO'} throughput</div>
            <div className="obf__bench-val">
              {throughput.toLocaleString()}
              <span className="obf__bench-unit">msgs/sec</span>
            </div>
          </div>
          <div className="obf__bench-cell">
            <div className="obf__bench-name">P50 latency</div>
            <div className="obf__bench-val">
              {p50.toLocaleString()}
              <span className="obf__bench-unit">ns</span>
            </div>
          </div>
        </div>
        <p className="obf__note">
          Pro-rata pays about 2.5x in throughput because it snapshots every
          resting order at the touched level, O(level depth) per match. Bench on
          Apple M2 Pro over a full FIX 4.4 session.
        </p>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={() => setMatched(true)} disabled={matched}>
          {matched ? 'Matched' : 'Match order'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => setMatched(false)}
          disabled={!matched}
        >
          Reset
        </button>
        <span className="demo__hint">
          {mode === 'prorata' ? 'proportional split, FIFO residual' : 'strict price-time'}
        </span>
      </div>
    </div>
  );
}
