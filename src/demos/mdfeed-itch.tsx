import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './mdfeed-itch.css';

// Real numbers from the project:
// single-threaded parse + book-apply sustains 1,590,991 msgs/sec, P50 250 ns,
// P99 664 ns; the gap-fill test drops every 100th of 1,500 multicast packets,
// detects every gap, applies a TCP snapshot, and converges to byte-equal state.
const THROUGHPUT = 1_590_991;
const P50_NS = 250;
const P99_NS = 664;
const SYMBOL = 'AAPL';

type Side = 'bid' | 'ask';
type Level = { px: string; qty: number };

// A small depth-10 book split as 5 bid + 5 ask price levels.
const BIDS: Level[] = [
  { px: '189.42', qty: 1200 },
  { px: '189.41', qty: 2600 },
  { px: '189.40', qty: 800 },
  { px: '189.39', qty: 4100 },
  { px: '189.38', qty: 1500 },
];
const ASKS: Level[] = [
  { px: '189.43', qty: 950 },
  { px: '189.44', qty: 3300 },
  { px: '189.45', qty: 1100 },
  { px: '189.46', qty: 2000 },
  { px: '189.47', qty: 700 },
];

const MAX_QTY = Math.max(
  ...BIDS.map((l) => l.qty),
  ...ASKS.map((l) => l.qty),
);

type Phase = 'idle' | 'live' | 'gap' | 'recover' | 'synced';

type Pkt = {
  id: number;
  seq: number;
  kind: 'add' | 'exec' | 'dropped' | 'snapshot';
  label: string;
};

const STATUS_TEXT: Record<Phase, string> = {
  idle: 'synced',
  live: 'synced',
  gap: 'gap detected',
  recover: 'recovering',
  synced: 'synced',
};

const STATUS_STATE: Record<Phase, string> = {
  idle: 'live',
  live: 'live',
  gap: 'gap',
  recover: 'recover',
  synced: 'synced',
};

export default function MdfeedItchDemo() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [seq, setSeq] = useState(100);
  const [expectedSeq, setExpectedSeq] = useState(100);
  const [mcast, setMcast] = useState<Pkt[]>([]);
  const [tcp, setTcp] = useState<Pkt[]>([]);
  const [staleSide, setStaleSide] = useState<Side | null>(null);
  const [done, setDone] = useState(false);
  const timers = useRef<number[]>([]);
  const pktId = useRef(0);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  function after(ms: number, fn: () => void) {
    const t = window.setTimeout(fn, reduce ? 0 : ms);
    timers.current.push(t);
  }

  useEffect(() => clearTimers, []);

  function reset() {
    clearTimers();
    pktId.current = 0;
    setPhase('idle');
    setSeq(100);
    setExpectedSeq(100);
    setMcast([]);
    setTcp([]);
    setStaleSide(null);
    setDone(false);
  }

  function pushMcast(kind: Pkt['kind'], label: string, s: number) {
    pktId.current += 1;
    setMcast((prev) =>
      [{ id: pktId.current, seq: s, kind, label }, ...prev].slice(0, 7),
    );
  }
  function pushTcp(kind: Pkt['kind'], label: string, s: number) {
    pktId.current += 1;
    setTcp((prev) =>
      [{ id: pktId.current, seq: s, kind, label }, ...prev].slice(0, 5),
    );
  }

  function run() {
    if (phase !== 'idle' && phase !== 'synced') return;
    reset();
    setPhase('live');

    // A few clean in-order packets advance the sequence number.
    after(250, () => {
      pushMcast('add', 'Add 101', 101);
      setSeq(101);
      setExpectedSeq(102);
    });
    after(620, () => {
      pushMcast('exec', 'Exec 102', 102);
      setSeq(102);
      setExpectedSeq(103);
    });

    // Sequence 103 is dropped on the wire. The handler receives 104 next and
    // sees the per-stock-locate sequence jump, so it flags a gap.
    after(1050, () => {
      pushMcast('dropped', 'drop 103', 103);
    });
    after(1450, () => {
      pushMcast('add', 'recv 104', 104);
      setPhase('gap');
      setStaleSide('ask');
    });

    // Recovery: request a snapshot plus gap-fill over the TCP control channel.
    after(2050, () => {
      setPhase('recover');
      pushTcp('snapshot', 'REQ snapshot @103', 103);
    });
    after(2650, () => {
      pushTcp('snapshot', 'SNAP book + seq', 103);
    });
    after(3150, () => {
      pushTcp('add', 'fill 103', 103);
    });
    after(3650, () => {
      pushTcp('add', 'fill 104', 104);
    });

    // Book converges to a byte-equal verified state and live resumes at 104.
    after(4250, () => {
      setStaleSide(null);
      setSeq(104);
      setExpectedSeq(105);
      setPhase('synced');
      setDone(true);
    });
  }

  const running = phase === 'live' || phase === 'gap' || phase === 'recover';

  return (
    <div className="demo" aria-label="mdfeed-itch order book gap-fill demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">ITCH book, gap, and recovery</h3>
      <p className="demo__lede">
        A depth-10 book for {SYMBOL} rebuilt from the ITCH multicast feed. Run
        the feed to drop a packet on the wire, watch the sequence gap trip
        recovery over the TCP control channel, and see the book converge back to
        a byte-equal verified state.
      </p>

      <div className="itch__stage">
        <div className="itch__topbar">
          <span className="itch__seq">
            symbol <b>{SYMBOL}</b>
          </span>
          <span className="itch__seq">
            applied seq <b>{seq}</b>
          </span>
          <span className="itch__seq">
            expected next <b>{expectedSeq}</b>
          </span>
          <span
            className="itch__status"
            data-state={STATUS_STATE[phase]}
            role="status"
          >
            <span className="itch__status-dot" />
            {STATUS_TEXT[phase]}
          </span>
        </div>

        <div className="itch__book">
          <div className="itch__book-head">
            <span className="itch__side-label itch__side-label--bid">
              bids
            </span>
            <span className="itch__side-label itch__side-label--ask">
              asks
            </span>
          </div>
          <div className="itch__book-head" aria-hidden="true" style={{ marginTop: -4 }} />
          <div className="itch__ladder">
            {BIDS.map((bid, i) => {
              const ask = ASKS[i];
              const bidStale = staleSide === 'bid';
              const askStale = staleSide === 'ask';
              return (
                <div className="itch__level" key={i}>
                  <span
                    className="itch__qty--bid"
                    style={{ gridColumn: 1 }}
                  >
                    <span className={bidStale ? 'itch__stale' : undefined}>
                      {bid.qty.toLocaleString()}
                    </span>
                  </span>
                  <span className="itch__px">{bid.px}</span>
                  <span className="itch__px">{ask.px}</span>
                  <span className="itch__qty--ask">
                    <span className={askStale ? 'itch__stale' : undefined}>
                      {ask.qty.toLocaleString()}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="itch__ladder" aria-hidden="true" style={{ marginTop: 6 }}>
            {BIDS.map((bid, i) => {
              const ask = ASKS[i];
              return (
                <div className="itch__level" key={`d${i}`}>
                  <motion.span
                    className="itch__depth itch__depth--bid"
                    style={{ width: `${(bid.qty / MAX_QTY) * 100}%`, gridColumn: 1 }}
                    initial={false}
                  />
                  <span />
                  <span />
                  <motion.span
                    className="itch__depth itch__depth--ask"
                    style={{ width: `${(ask.qty / MAX_QTY) * 100}%`, gridColumn: 4 }}
                    initial={false}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="itch__wire">
          <div className="itch__channel">
            <div className="itch__channel-head">
              UDP multicast
              <span className="itch__channel-tag">239.1.1.1 group</span>
            </div>
            <div className="itch__packets">
              <AnimatePresence initial={false}>
                {mcast.length === 0 ? (
                  <span className="itch__pkt-empty">idle</span>
                ) : (
                  mcast.map((p) => (
                    <motion.span
                      key={p.id}
                      className={`itch__pkt itch__pkt--${p.kind}`}
                      initial={{ opacity: 0, y: reduce ? 0 : -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: reduce ? 0 : 0.25 }}
                    >
                      {p.label}
                    </motion.span>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="itch__channel">
            <div className="itch__channel-head">
              TCP control channel
              <span className="itch__channel-tag">snapshot + gap-fill</span>
            </div>
            <div className="itch__packets">
              <AnimatePresence initial={false}>
                {tcp.length === 0 ? (
                  <span className="itch__pkt-empty">
                    no recovery in flight
                  </span>
                ) : (
                  tcp.map((p) => (
                    <motion.span
                      key={p.id}
                      className={`itch__pkt itch__pkt--${p.kind}`}
                      initial={{ opacity: 0, x: reduce ? 0 : -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: reduce ? 0 : 0.25 }}
                    >
                      {p.label}
                    </motion.span>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="itch__stats">
          <div className="itch__stat">
            <span className="itch__stat-val">
              {(THROUGHPUT / 1_000_000).toFixed(2)}M
            </span>
            <span className="itch__stat-unit">msgs/sec, one thread</span>
          </div>
          <div className="itch__stat">
            <span className="itch__stat-val">{P50_NS} ns</span>
            <span className="itch__stat-unit">parse + apply P50</span>
          </div>
          <div className="itch__stat">
            <span className="itch__stat-val">{P99_NS} ns</span>
            <span className="itch__stat-unit">parse + apply P99</span>
          </div>
        </div>

        <AnimatePresence>
          {done && (
            <motion.div
              className="itch__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <span className="itch__verdict-head">Book converged, byte-equal</span>
              <span className="itch__verdict-text">
                The dropped sequence 103 was filled from the TCP snapshot and
                gap-fill, and the rebuilt book matches the live path byte for
                byte. The recovery test drops every 100th of 1,500 packets and
                detects every gap.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Streaming feed…' : 'Run feed with a drop'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {phase === 'gap'
            ? 'sequence jump 102 to 104: gap on 103'
            : phase === 'recover'
              ? 'TCP snapshot + gap-fill in flight'
              : `depth-10 book, ${BIDS.length + ASKS.length} levels`}
        </span>
      </div>
    </div>
  );
}
