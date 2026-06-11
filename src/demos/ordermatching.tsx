import { useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './ordermatching.css';

// Real engine traits from the project: integer tick prices (floats break
// std::map ordering on NaN and drift on cumulative-volume math), price-time
// priority, partial fills, and Stop / StopLimit / Iceberg order types.
// Prices below are integer ticks; one tick is shown as 0.01 in the display.
const TICK = 0.01;

type Side = 'buy' | 'sell';

// A resting limit order keeps a sequence number so that, within a price level,
// the earliest order fills first. That is the "time" half of price-time.
type Resting = {
  id: number;
  side: Side;
  px: number; // integer ticks
  qty: number; // visible quantity
  hidden: number; // iceberg reserve, refreshed into qty when a slice fills
  slice: number; // iceberg display slice size, 0 for plain limit
  seq: number;
};

type Trade = { id: number; px: number; qty: number; note: string };

type StopOrder = {
  id: number;
  side: Side;
  trigger: number; // integer ticks, fires when last crosses it
  qty: number;
};

type Level = { px: number; qty: number; orders: number };

// Seed book: bids descending, asks ascending, all in integer ticks.
const SEED: Resting[] = [
  { id: 1, side: 'buy', px: 9998, qty: 5, hidden: 0, slice: 0, seq: 1 },
  { id: 2, side: 'buy', px: 9998, qty: 3, hidden: 0, slice: 0, seq: 2 },
  { id: 3, side: 'buy', px: 9997, qty: 8, hidden: 0, slice: 0, seq: 3 },
  { id: 4, side: 'buy', px: 9995, qty: 12, hidden: 0, slice: 0, seq: 4 },
  { id: 5, side: 'sell', px: 10002, qty: 4, hidden: 0, slice: 0, seq: 5 },
  { id: 6, side: 'sell', px: 10003, qty: 7, hidden: 0, slice: 0, seq: 6 },
  // An iceberg ask: shows 2 at a time, refreshing from a 10-lot reserve.
  { id: 7, side: 'sell', px: 10004, qty: 2, hidden: 8, slice: 2, seq: 7 },
];

const fmt = (ticks: number) => (ticks * TICK + 100).toFixed(2);
const ease = [0.22, 1, 0.36, 1] as const;

function buildLevels(book: Resting[], side: Side): Level[] {
  const map = new Map<number, Level>();
  for (const o of book) {
    if (o.side !== side) continue;
    const lvl = map.get(o.px) ?? { px: o.px, qty: 0, orders: 0 };
    lvl.qty += o.qty;
    lvl.orders += 1;
    map.set(o.px, lvl);
  }
  const levels = [...map.values()];
  levels.sort((a, b) => (side === 'buy' ? b.px - a.px : a.px - b.px));
  return levels;
}

export default function OrderMatchingDemo() {
  const reduce = useReducedMotion();
  const [book, setBook] = useState<Resting[]>(SEED);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stops, setStops] = useState<StopOrder[]>([
    { id: 50, side: 'sell', trigger: 9994, qty: 6 },
  ]);
  const [last, setLast] = useState<number | null>(null);
  const [side, setSide] = useState<Side>('buy');
  const [qty, setQty] = useState(6);
  const [limitOffset, setLimitOffset] = useState(4); // ticks past the touch
  const seqRef = useState(() => ({ n: 100 }))[0];
  const tradeRef = useState(() => ({ n: 0 }))[0];

  const bids = useMemo(() => buildLevels(book, 'buy'), [book]);
  const asks = useMemo(() => buildLevels(book, 'sell'), [book]);

  const bestBid = bids[0]?.px;
  const bestAsk = asks[0]?.px;
  const spread =
    bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
  const maxLevelQty = Math.max(
    1,
    ...bids.map((l) => l.qty),
    ...asks.map((l) => l.qty)
  );

  // Core match loop: cross an aggressor against the resting book in
  // price-time order, produce trades, apply partial fills, and refresh
  // iceberg slices. Returns the new book, the new trades, and last price.
  function match(
    startBook: Resting[],
    aggrSide: Side,
    aggrQty: number,
    limitPx: number | null
  ) {
    let working = startBook.map((o) => ({ ...o }));
    const newTrades: Trade[] = [];
    let remaining = aggrQty;
    let lastPx: number | null = null;

    const restingSide: Side = aggrSide === 'buy' ? 'sell' : 'buy';

    while (remaining > 0) {
      // Candidate resting orders on the opposite side, best price first,
      // then earliest sequence (time priority) inside a price level.
      const candidates = working
        .filter((o) => o.side === restingSide)
        .sort((a, b) =>
          restingSide === 'sell' ? a.px - b.px || a.seq - b.seq : b.px - a.px || a.seq - b.seq
        );
      const top = candidates[0];
      if (!top) break;

      // Limit price gate: a buy only lifts asks at or below its limit,
      // a sell only hits bids at or above its limit. null means market.
      if (limitPx != null) {
        if (aggrSide === 'buy' && top.px > limitPx) break;
        if (aggrSide === 'sell' && top.px < limitPx) break;
      }

      const fill = Math.min(remaining, top.qty);
      remaining -= fill;
      top.qty -= fill;
      lastPx = top.px;

      let note = aggrSide === 'buy' ? 'buy lifts ask' : 'sell hits bid';
      // Iceberg refresh: when the visible slice empties, pull the next
      // slice out of the hidden reserve so the level keeps quoting.
      if (top.qty === 0 && top.hidden > 0 && top.slice > 0) {
        const refill = Math.min(top.slice, top.hidden);
        top.qty = refill;
        top.hidden -= refill;
        top.seq = ++seqRef.n; // refreshed slice goes to back of the queue
        note = 'iceberg slice refreshed';
      }
      newTrades.push({ id: ++tradeRef.n, px: top.px, qty: fill, note });
    }

    // Drop fully consumed orders (qty 0 and no reserve left).
    working = working.filter((o) => o.qty > 0 || o.hidden > 0);

    // Any unfilled remainder of a limit order rests in the book.
    if (remaining > 0 && limitPx != null) {
      working.push({
        id: ++seqRef.n,
        side: aggrSide,
        px: limitPx,
        qty: remaining,
        hidden: 0,
        slice: 0,
        seq: ++seqRef.n,
      });
    }
    return { working, newTrades, lastPx };
  }

  // After any trade prints, check stop orders against the last price and
  // fire those that are triggered, matching them as market orders.
  function applyStops(
    startBook: Resting[],
    lastPx: number | null,
    accTrades: Trade[]
  ) {
    if (lastPx == null || stops.length === 0)
      return { working: startBook, fired: [] as number[], trades: accTrades, lastPx };
    let working = startBook;
    let curLast = lastPx;
    const fired: number[] = [];
    const trades = [...accTrades];
    for (const s of stops) {
      // Sell stop fires when last falls to or below trigger; buy stop fires
      // when last rises to or above trigger.
      const hit =
        s.side === 'sell' ? curLast <= s.trigger : curLast >= s.trigger;
      if (!hit) continue;
      fired.push(s.id);
      const res = match(working, s.side, s.qty, null);
      working = res.working;
      if (res.lastPx != null) curLast = res.lastPx;
      for (const t of res.newTrades)
        trades.push({ ...t, note: 'stop triggered, ' + t.note });
    }
    return { working, fired, trades, lastPx: curLast };
  }

  function send(asMarket: boolean) {
    const limitPx = asMarket
      ? null
      : side === 'buy'
        ? (bestAsk ?? bestBid ?? 10000) + limitOffset
        : (bestBid ?? bestAsk ?? 10000) - limitOffset;

    const first = match(book, side, qty, limitPx);
    const stopped = applyStops(first.working, first.lastPx, first.newTrades);

    setBook(stopped.working);
    setStops((prev) => prev.filter((s) => !stopped.fired.includes(s.id)));
    if (stopped.lastPx != null) setLast(stopped.lastPx);
    if (stopped.trades.length) {
      setTrades((prev) => [...stopped.trades.reverse(), ...prev].slice(0, 40));
    }
  }

  function reset() {
    setBook(SEED);
    setTrades([]);
    setStops([{ id: 50, side: 'sell', trigger: 9994, qty: 6 }]);
    setLast(null);
    seqRef.n = 100;
    tradeRef.n = 0;
  }

  const stopArmed = (s: StopOrder) =>
    last != null &&
    (s.side === 'sell' ? last - 30 <= s.trigger : last + 30 >= s.trigger);

  const iceberg = book.find((o) => o.slice > 0);

  return (
    <div className="demo" aria-label="ordermatching engine demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Price-time priority, live</h3>
      <p className="demo__lede">
        Send a limit or market order and watch it cross the resting book. Fills
        go best price first, then earliest order within a level. Prices are
        integer ticks, so the book never drifts on float math. Drive the last
        price down to arm the resting sell stop, or eat the iceberg ask to see
        it refresh its hidden slice.
      </p>

      <div className="om__stage">
        <div className="om__book">
          <div className="om__side om__side--bids" aria-label="bids">
            <div className="om__side-head">
              <span>Bid qty</span>
              <span>Price</span>
            </div>
            {bids.length === 0 && <div className="om__empty">no bids</div>}
            <AnimatePresence initial={false}>
              {bids.map((l) => (
                <motion.div
                  key={`bid-${l.px}`}
                  className="om__level"
                  layout={!reduce}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.25, ease }}
                >
                  <span
                    className="om__level-bar"
                    style={{ width: `${(l.qty / maxLevelQty) * 100}%` }}
                  />
                  <span className="om__level-qty">{l.qty}</span>
                  <span className="om__level-px">{fmt(l.px)}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <div className="om__mid">
            <span className="om__mid-label">spread</span>
            <span className="om__mid-spread">
              {spread != null ? spread : '--'}
            </span>
            <span className="om__mid-label">last</span>
            <span className="om__mid-last">
              {last != null ? fmt(last) : '--'}
            </span>
          </div>

          <div className="om__side om__side--asks" aria-label="asks">
            <div className="om__side-head">
              <span>Price</span>
              <span>Ask qty</span>
            </div>
            {asks.length === 0 && <div className="om__empty">no asks</div>}
            <AnimatePresence initial={false}>
              {asks.map((l) => (
                <motion.div
                  key={`ask-${l.px}`}
                  className="om__level"
                  layout={!reduce}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.25, ease }}
                >
                  <span
                    className="om__level-bar"
                    style={{ width: `${(l.qty / maxLevelQty) * 100}%` }}
                  />
                  <span className="om__level-px">{fmt(l.px)}</span>
                  <span className="om__level-qty">{l.qty}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        <div className="om__panels">
          <div className="om__tape">
            <div className="om__tape-head">
              <span>Trade tape</span>
              <span className="om__tape-count">{trades.length}</span>
            </div>
            {trades.length === 0 ? (
              <div className="om__tape-empty">no prints yet</div>
            ) : (
              <ul className="om__tape-list">
                <AnimatePresence initial={false}>
                  {trades.map((t) => (
                    <motion.li
                      key={t.id}
                      className="om__tape-line"
                      initial={{ opacity: 0, x: reduce ? 0 : -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: reduce ? 0 : 0.25, ease }}
                    >
                      <span className="om__tape-px">{fmt(t.px)}</span>
                      <span className="om__tape-qty">x {t.qty}</span>
                      <span className="om__tape-note">{t.note}</span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>

          <div className="om__special">
            <div className="om__special-head">Resting triggers</div>
            {stops.length === 0 && iceberg == null ? (
              <div className="om__tape-empty">all triggers cleared</div>
            ) : null}
            {stops.map((s) => (
              <div
                key={s.id}
                className={`om__resting om__resting--stop${
                  stopArmed(s) ? ' om__resting--armed' : ''
                }`}
              >
                <span className="om__resting-kind">STOP</span>
                <span>
                  {s.side} {s.qty}
                </span>
                <span className="om__resting-detail">
                  fires at {fmt(s.trigger)}
                  {stopArmed(s) ? ' (armed)' : ''}
                </span>
              </div>
            ))}
            {iceberg && (
              <div className="om__resting om__resting--ice">
                <span className="om__resting-kind">ICEBERG</span>
                <span>
                  ask {fmt(iceberg.px)}
                </span>
                <span className="om__resting-detail">
                  {iceberg.qty} shown, {iceberg.hidden} hidden
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="om__forms">
          <div className="om__inputs">
            <div className="om__sidebtns" role="group" aria-label="order side">
              <button
                className={`om__sidebtn om__sidebtn--buy${
                  side === 'buy' ? ' om__sidebtn--on' : ''
                }`}
                onClick={() => setSide('buy')}
                aria-pressed={side === 'buy'}
              >
                Buy
              </button>
              <button
                className={`om__sidebtn om__sidebtn--sell${
                  side === 'sell' ? ' om__sidebtn--on' : ''
                }`}
                onClick={() => setSide('sell')}
                aria-pressed={side === 'sell'}
              >
                Sell
              </button>
            </div>

            <div className="om__field">
              <span className="om__field-label">Quantity</span>
              <div className="om__field-val">
                <button
                  className="om__step"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  aria-label="decrease quantity"
                >
                  -
                </button>
                <span className="om__num">{qty}</span>
                <button
                  className="om__step"
                  onClick={() => setQty((q) => Math.min(30, q + 1))}
                  aria-label="increase quantity"
                >
                  +
                </button>
              </div>
            </div>

            <div className="om__field">
              <span className="om__field-label">Limit ticks past touch</span>
              <div className="om__field-val">
                <button
                  className="om__step"
                  onClick={() => setLimitOffset((o) => Math.max(0, o - 1))}
                  aria-label="decrease limit offset"
                >
                  -
                </button>
                <span className="om__num">{limitOffset}</span>
                <button
                  className="om__step"
                  onClick={() => setLimitOffset((o) => Math.min(20, o + 1))}
                  aria-label="increase limit offset"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <p className="om__note">
            A <b>limit</b> order crosses only up to its price, then rests the
            remainder in the book. A <b>market</b> order sweeps levels until the
            quantity is filled. Each fill prints to the tape and updates last,
            which is what triggers stop orders.
          </p>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={() => send(false)}>
          Send limit
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={() => send(true)}>
          Send market
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset book
        </button>
        <span className="demo__hint">
          {side} {qty} {side === 'buy' ? 'lifts asks' : 'hits bids'}
        </span>
      </div>
    </div>
  );
}
