import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './mdfeed-handler.css';

// Real numbers from the 200,000-message loopback bench:
// 0 drops, 0 parse errors, wire-to-normalized P50 167 ns, P95 292 ns, P99 542 ns.
// Two wire formats normalize into one MdMessage: a 27-byte little-endian binary
// format and a pipe-delimited ASCII format. Two latency streams are measured
// separately: the sub-microsecond parse cost vs the microsecond-range syscall path.
const PARSE_P50_NS = 167;
const PARSE_P95_NS = 292;
const PARSE_P99_NS = 542;

const ease = [0.22, 1, 0.36, 1] as const;

type Venue = 'binary' | 'ascii';
type Tick = { sym: string; bid: number; ask: number; venue: Venue };

// A deterministic interleaved stream from two synthetic venues. Venue A speaks
// a 27-byte little-endian binary format; venue B speaks pipe-delimited ASCII.
const STREAM: Tick[] = [
  { sym: 'AAPL', bid: 187.42, ask: 187.45, venue: 'binary' },
  { sym: 'MSFT', bid: 412.18, ask: 412.23, venue: 'ascii' },
  { sym: 'AAPL', bid: 187.44, ask: 187.46, venue: 'ascii' },
  { sym: 'NVDA', bid: 121.07, ask: 121.11, venue: 'binary' },
  { sym: 'MSFT', bid: 412.2, ask: 412.22, venue: 'binary' },
  { sym: 'NVDA', bid: 121.09, ask: 121.1, venue: 'ascii' },
  { sym: 'AAPL', bid: 187.45, ask: 187.47, venue: 'binary' },
  { sym: 'MSFT', bid: 412.21, ask: 412.24, venue: 'ascii' },
];

const SYMBOLS = ['AAPL', 'MSFT', 'NVDA'];

// Sample wire bytes shown for the active tick, illustrating the two formats.
function binaryWire(t: Tick): string {
  // 27-byte frame: shown as a compact hex preview of the symbol + prices.
  const head = t.sym
    .padEnd(4, ' ')
    .split('')
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join(' ');
  const px = Math.round(t.bid * 100)
    .toString(16)
    .padStart(8, '0');
  return `${head} ${px.match(/../g)!.reverse().join(' ')} ..`;
}
function asciiWire(t: Tick): string {
  return `${t.sym}|${t.bid.toFixed(2)}|${t.ask.toFixed(2)}|B`;
}

// Two HDR-style streams. Parse stream is sub-microsecond; the recv stream is in
// the microsecond range (venue-to-recv syscall path), shown as a contrast.
const PARSE_BUCKETS = [
  { label: '128', weight: 14 },
  { label: '167', weight: 30 },
  { label: '224', weight: 24 },
  { label: '292', weight: 16 },
  { label: '420', weight: 9 },
  { label: '542', weight: 4 },
];
const RECV_BUCKETS = [
  { label: '1.1', weight: 10 },
  { label: '1.8', weight: 26 },
  { label: '2.6', weight: 28 },
  { label: '3.9', weight: 18 },
  { label: '5.4', weight: 10 },
  { label: '7.2', weight: 5 },
];
const PARSE_MAX = Math.max(...PARSE_BUCKETS.map((b) => b.weight));
const RECV_MAX = Math.max(...RECV_BUCKETS.map((b) => b.weight));

export default function MdfeedHandlerDemo() {
  const reduce = useReducedMotion();
  const [running, setRunning] = useState(false);
  const [idx, setIdx] = useState(-1);
  const [book, setBook] = useState<Record<string, Tick>>({});
  const [count, setCount] = useState(0);
  const [revealed, setRevealed] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const reset = useCallback(() => {
    stop();
    setRunning(false);
    setIdx(-1);
    setBook({});
    setCount(0);
    setRevealed(0);
  }, [stop]);

  const apply = useCallback((i: number) => {
    const t = STREAM[i];
    setBook((b) => ({ ...b, [t.sym]: t }));
    setCount((c) => c + 1);
  }, []);

  const run = useCallback(() => {
    if (running) return;
    reset();
    setRunning(true);

    if (reduce) {
      STREAM.forEach((_, i) => apply(i));
      setIdx(STREAM.length - 1);
      setRevealed(PARSE_BUCKETS.length);
      setRunning(false);
      return;
    }

    let i = 0;
    const tick = () => {
      if (i >= STREAM.length) {
        let b = 0;
        const revealTick = () => {
          b += 1;
          setRevealed(b);
          if (b < PARSE_BUCKETS.length) {
            timer.current = setTimeout(revealTick, 120);
          } else {
            setRunning(false);
            timer.current = null;
          }
        };
        timer.current = setTimeout(revealTick, 220);
        return;
      }
      setIdx(i);
      timer.current = setTimeout(() => {
        apply(i);
        i += 1;
        timer.current = setTimeout(tick, 430);
      }, 280);
    };
    tick();
  }, [running, reduce, reset, apply]);

  const active = idx >= 0 ? STREAM[idx] : null;

  return (
    <div className="demo" aria-label="mdfeed-handler normalization and latency demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Two wire formats, one normalized book</h3>
      <p className="demo__lede">
        Two synthetic venues send the same market data in different formats: a
        27-byte little-endian binary frame and a pipe-delimited ASCII line. The
        handler parses both into one internal message and updates a per-symbol
        best-bid best-offer book. Run the feed to watch ticks normalize.
      </p>

      <div className="mdf__stage">
        <div className="mdf__wires">
          <WireCard
            label="Venue A"
            sub="27-byte LE binary"
            kind="binary"
            active={active?.venue === 'binary' ? active : null}
            render={binaryWire}
            reduce={reduce}
          />
          <WireCard
            label="Venue B"
            sub="pipe-delimited ASCII"
            kind="ascii"
            active={active?.venue === 'ascii' ? active : null}
            render={asciiWire}
            reduce={reduce}
          />
        </div>

        <div className="mdf__pipe" aria-hidden="true">
          <span className="mdf__pipe-label">normalize to MdMessage</span>
          <motion.span
            className="mdf__pipe-dot"
            key={idx}
            initial={{ opacity: 0, scale: reduce ? 1 : 0.4 }}
            animate={{ opacity: active ? 1 : 0.3, scale: 1 }}
            transition={{ duration: reduce ? 0 : 0.3, ease }}
          />
        </div>

        <div className="mdf__book">
          <div className="mdf__book-head">
            <span>Normalized BBO book</span>
            <span className="mdf__book-count">{count} msgs</span>
          </div>
          <div className="mdf__book-grid">
            {SYMBOLS.map((sym) => {
              const row = book[sym];
              const isActive = active?.sym === sym;
              return (
                <motion.div
                  key={sym}
                  className={`mdf__bbo ${isActive ? 'mdf__bbo--active' : ''} ${row ? 'mdf__bbo--set' : ''}`}
                  animate={isActive && !reduce ? { scale: [1, 1.03, 1] } : { scale: 1 }}
                  transition={{ duration: 0.4, ease }}
                >
                  <div className="mdf__bbo-sym">{sym}</div>
                  <div className="mdf__bbo-prices">
                    <span className="mdf__bbo-bid">{row ? row.bid.toFixed(2) : '--'}</span>
                    <span className="mdf__bbo-x">/</span>
                    <span className="mdf__bbo-ask">{row ? row.ask.toFixed(2) : '--'}</span>
                  </div>
                  <div className="mdf__bbo-venue">
                    {row ? (row.venue === 'binary' ? 'venue A' : 'venue B') : 'waiting'}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        <div className="mdf__hists">
          <Hist
            title="Wire to normalized"
            sub="parse cost, ns"
            buckets={PARSE_BUCKETS}
            max={PARSE_MAX}
            revealed={revealed}
            highlight="167"
            accent
            reduce={reduce}
          />
          <Hist
            title="Venue to recv"
            sub="syscall path, µs"
            buckets={RECV_BUCKETS}
            max={RECV_MAX}
            revealed={revealed}
            highlight="2.6"
            reduce={reduce}
          />
        </div>

        <div className="mdf__stats">
          <Stat value={PARSE_P50_NS.toString()} unit="ns P50 parse" />
          <Stat value={PARSE_P95_NS.toString()} unit="ns P95 parse" />
          <Stat value={PARSE_P99_NS.toString()} unit="ns P99 parse" />
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Streaming…' : 'Run feed'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={running}>
          Reset
        </button>
        <span className="demo__hint">200k-message bench: 0 drops, 0 parse errors</span>
      </div>
    </div>
  );
}

function WireCard({
  label,
  sub,
  kind,
  active,
  render,
  reduce,
}: {
  label: string;
  sub: string;
  kind: Venue;
  active: Tick | null;
  render: (t: Tick) => string;
  reduce: boolean | null;
}) {
  return (
    <div className={`mdf__wire mdf__wire--${kind} ${active ? 'mdf__wire--live' : ''}`}>
      <div className="mdf__wire-head">
        <span className="mdf__wire-label">{label}</span>
        <span className="mdf__wire-sub">{sub}</span>
      </div>
      <div className="mdf__wire-frame" aria-live="polite">
        <AnimatePresence mode="wait">
          {active ? (
            <motion.code
              key={`${active.sym}-${active.bid}`}
              className="mdf__wire-bytes"
              initial={{ opacity: 0, y: reduce ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.22, ease }}
            >
              {render(active)}
            </motion.code>
          ) : (
            <span className="mdf__wire-idle">idle</span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Hist({
  title,
  sub,
  buckets,
  max,
  revealed,
  highlight,
  accent,
  reduce,
}: {
  title: string;
  sub: string;
  buckets: { label: string; weight: number }[];
  max: number;
  revealed: number;
  highlight: string;
  accent?: boolean;
  reduce: boolean | null;
}) {
  return (
    <div className={`mdf__hist ${accent ? 'mdf__hist--accent' : ''}`}>
      <div className="mdf__hist-head">
        <span>{title}</span>
        <span className="mdf__hist-sub">{sub}</span>
      </div>
      <div className="mdf__hist-bars">
        {buckets.map((b, i) => {
          const shown = i < revealed;
          return (
            <div key={b.label} className="mdf__hist-col">
              <div className="mdf__hist-track">
                <motion.div
                  className={`mdf__hist-bar ${b.label === highlight ? 'mdf__hist-bar--hi' : ''}`}
                  initial={false}
                  animate={{ height: shown ? `${(b.weight / max) * 100}%` : '0%' }}
                  transition={{ duration: reduce ? 0 : 0.4, ease }}
                />
              </div>
              <span className="mdf__hist-label">{b.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ value, unit }: { value: string; unit: string }) {
  return (
    <div className="mdf__stat">
      <div className="mdf__stat-val">{value}</div>
      <div className="mdf__stat-unit">{unit}</div>
    </div>
  );
}
