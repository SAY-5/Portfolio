import { useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './adstream.css';

// Real numbers from the project: Vickrey second-price auction (clearing price
// is the second-highest bid), sliding-window per-user frequency cap, atomic
// per-bidder budget guard. Bench reached ~50,000 req/sec with ~25 us p99.
const FREQ_CAP = 3; // impressions per user in the sliding window
const ease = [0.22, 1, 0.36, 1] as const;

type Bidder = {
  id: string;
  name: string;
  bid: number; // bid in cents
  budget: number; // remaining budget in cents
  color: string;
};

const initialBidders: Bidder[] = [
  { id: 'b1', name: 'NorthRoast', bid: 142, budget: 600, color: '#ff5b29' },
  { id: 'b2', name: 'Loamwear', bid: 118, budget: 420, color: '#4fd08a' },
  { id: 'b3', name: 'Tidescript', bid: 96, budget: 250, color: '#5b9bff' },
];

const START_BUDGET: Record<string, number> = {
  b1: 600,
  b2: 420,
  b3: 250,
};

const userPool = ['user-7', 'user-7', 'user-7', 'user-7', 'user-2', 'user-9'];

type Result = {
  winner: string;
  winnerName: string;
  topBid: number;
  clearing: number;
  user: string;
  capped: boolean;
  budgetBlocked: string | null;
};

export default function AdStreamDemo() {
  const reduce = useReducedMotion();
  const [bidders, setBidders] = useState<Bidder[]>(initialBidders);
  const [seen, setSeen] = useState<Record<string, number>>({});
  const [round, setRound] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [streaming, setStreaming] = useState(false);

  function setBid(id: string, bid: number) {
    setBidders((prev) => prev.map((b) => (b.id === id ? { ...b, bid } : b)));
  }

  function reset() {
    setBidders(initialBidders);
    setSeen({});
    setRound(0);
    setResult(null);
    setStreaming(false);
  }

  function runAuction() {
    if (streaming) return;
    const user = userPool[round % userPool.length];
    const seenCount = seen[user] ?? 0;
    const capped = seenCount >= FREQ_CAP;

    // Eligible bidders: enough budget to cover their own bid. The budget guard
    // uses an atomic tryReserve so a bidder cannot be pushed over cap.
    const eligible = bidders.filter((b) => b.budget >= b.bid);
    const budgetBlocked = bidders.find((b) => b.budget < b.bid)?.name ?? null;

    setStreaming(true);
    setResult(null);

    const finish = () => {
      if (capped || eligible.length < 1) {
        setResult({
          winner: '',
          winnerName: '',
          topBid: 0,
          clearing: 0,
          user,
          capped,
          budgetBlocked,
        });
        setRound((r) => r + 1);
        setStreaming(false);
        return;
      }

      const sorted = [...eligible].sort((a, b) => b.bid - a.bid);
      const winner = sorted[0];
      const topBid = winner.bid;
      // Second-price: winner pays the runner-up's bid, or its own if alone.
      const clearing = sorted.length > 1 ? sorted[1].bid : winner.bid;

      setBidders((prev) =>
        prev.map((b) =>
          b.id === winner.id ? { ...b, budget: b.budget - clearing } : b,
        ),
      );
      setSeen((prev) => ({ ...prev, [user]: (prev[user] ?? 0) + 1 }));
      setResult({
        winner: winner.id,
        winnerName: winner.name,
        topBid,
        clearing,
        user,
        capped: false,
        budgetBlocked,
      });
      setRound((r) => r + 1);
      setStreaming(false);
    };

    if (reduce) finish();
    else window.setTimeout(finish, 850);
  }

  function refund(id: string) {
    // Refund returns the last clearing charge to the bidder budget, capped at
    // the starting budget, mirroring the atomic guard releasing a reservation.
    setBidders((prev) =>
      prev.map((b) =>
        b.id === id
          ? { ...b, budget: Math.min(START_BUDGET[id], b.budget + 30) }
          : b,
      ),
    );
  }

  const nextUser = userPool[round % userPool.length];
  const nextCapped = (seen[nextUser] ?? 0) >= FREQ_CAP;

  return (
    <div className="demo" aria-label="adstream second-price auction demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Second-price, capped, and budgeted</h3>
      <p className="demo__lede">
        Bids stream into one placement. The Vickrey auction clears at the
        second-highest bid, so the winner pays the runner-up. A sliding-window
        cap greys out a user after {FREQ_CAP} impressions, and each bidder
        budget drains by the clearing price.
      </p>

      <div className="as__bidders" role="group" aria-label="bidders">
        {bidders.map((b) => {
          const isWinner = result?.winner === b.id;
          const pct = Math.round((b.budget / START_BUDGET[b.id]) * 100);
          const blocked = b.budget < b.bid;
          return (
            <motion.div
              key={b.id}
              className={`as__bidder${isWinner ? ' as__bidder--win' : ''}${
                blocked ? ' as__bidder--blocked' : ''
              }`}
              initial={false}
              animate={{
                scale: !reduce && isWinner ? [1, 1.03, 1] : 1,
              }}
              transition={{ duration: 0.4, ease }}
            >
              <div className="as__bidder-top">
                <span
                  className="as__bidder-dot"
                  style={{ background: b.color }}
                  aria-hidden="true"
                />
                <span className="as__bidder-name">{b.name}</span>
                {isWinner && <span className="as__bidder-badge">won</span>}
                {blocked && (
                  <span className="as__bidder-badge as__bidder-badge--block">
                    over budget
                  </span>
                )}
              </div>

              <label className="as__bid-label" htmlFor={`bid-${b.id}`}>
                bid <b>{(b.bid / 100).toFixed(2)}</b>
              </label>
              <input
                id={`bid-${b.id}`}
                className="as__slider"
                type="range"
                min={50}
                max={200}
                step={1}
                value={b.bid}
                disabled={streaming}
                onChange={(e) => setBid(b.id, Number(e.target.value))}
                aria-label={`${b.name} bid in cents`}
              />

              <div className="as__budget-label">
                <span>budget</span>
                <b style={{ color: b.color }}>{(b.budget / 100).toFixed(2)}</b>
              </div>
              <div className="as__budget-bar">
                <motion.div
                  className="as__budget-fill"
                  style={{ background: b.color }}
                  initial={false}
                  animate={{ width: `${Math.max(0, pct)}%` }}
                  transition={{ duration: reduce ? 0 : 0.5, ease }}
                />
              </div>
              <button
                className="as__refund"
                onClick={() => refund(b.id)}
                disabled={streaming || b.budget >= START_BUDGET[b.id]}
              >
                refund
              </button>
            </motion.div>
          );
        })}
      </div>

      <div className="as__placement">
        <div className="as__placement-head">
          <span>Placement</span>
          <span className="as__next-user">
            next request: <b>{nextUser}</b>
            {nextCapped && <span className="as__cap-flag"> cap reached</span>}
          </span>
        </div>

        <div className="as__users" aria-label="per-user frequency caps">
          {Array.from(new Set(userPool)).map((u) => {
            const c = seen[u] ?? 0;
            const isCapped = c >= FREQ_CAP;
            return (
              <div
                key={u}
                className={`as__user${isCapped ? ' as__user--capped' : ''}`}
              >
                <span className="as__user-name">{u}</span>
                <span className="as__user-count">
                  {c}/{FREQ_CAP}
                </span>
              </div>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          {streaming && (
            <motion.div
              key="streaming"
              className="as__clearing as__clearing--live"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              collecting bids...
            </motion.div>
          )}
          {!streaming && result && (
            <motion.div
              key={`r-${round}`}
              className={`as__clearing${
                result.capped ? ' as__clearing--capped' : ''
              }`}
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease }}
            >
              {result.capped ? (
                <span>
                  {result.user} hit the {FREQ_CAP}-impression cap, no ad served.
                </span>
              ) : (
                <>
                  <span className="as__clearing-line">
                    <b>{result.winnerName}</b> wins for {result.user}. Top bid{' '}
                    {(result.topBid / 100).toFixed(2)}, clears at the
                    runner-up&apos;s{' '}
                    <span className="as__hi">
                      {(result.clearing / 100).toFixed(2)}
                    </span>
                    .
                  </span>
                  {result.budgetBlocked && (
                    <span className="as__clearing-sub">
                      {result.budgetBlocked} excluded by the budget guard.
                    </span>
                  )}
                </>
              )}
            </motion.div>
          )}
          {!streaming && !result && (
            <motion.div key="idle" className="as__clearing as__clearing--idle">
              run an auction to clear the placement
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={runAuction} disabled={streaming}>
          {streaming ? 'Clearing...' : 'Run auction'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={streaming}
        >
          Reset
        </button>
        <span className="demo__hint">
          second price &middot; cap {FREQ_CAP} &middot; ~50K req/sec at ~25 us p99
        </span>
      </div>
    </div>
  );
}
