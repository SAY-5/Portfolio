import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './marketdatafeed.css';

// Real mechanism from the project: a per-symbol best-bid-offer book ingests a
// flood of UDP quotes, marks each touched symbol dirty, and on each drain emits
// exactly one coalesced snapshot per dirty symbol rather than forwarding every
// quote. Sequence-gap detection and stale-quote detection raise flags on bad
// input. Drain cadence is whatever the publisher chooses, typically 10 to 100ms.
const SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'AMZN'] as const;
type Sym = (typeof SYMBOLS)[number];

const BASE: Record<Sym, { bid: number; ask: number }> = {
  AAPL: { bid: 227.41, ask: 227.43 },
  MSFT: { bid: 411.18, ask: 411.21 },
  NVDA: { bid: 121.07, ask: 121.09 },
  AMZN: { bid: 186.52, ask: 186.55 },
};

type Book = {
  bid: number;
  ask: number;
  dirty: boolean;
  seq: number;
  gap: boolean;
  stale: boolean;
  lastQuoteTick: number;
};

type Snapshot = {
  id: number;
  sym: Sym;
  bid: number;
  ask: number;
  flags: string[];
};

const ease = [0.22, 1, 0.36, 1] as const;
const STALE_TICKS = 4; // a symbol with no quote for this many ticks goes stale

function freshBooks(): Record<Sym, Book> {
  const b = {} as Record<Sym, Book>;
  for (const s of SYMBOLS) {
    b[s] = {
      bid: BASE[s].bid,
      ask: BASE[s].ask,
      dirty: false,
      seq: 0,
      gap: false,
      stale: false,
      lastQuoteTick: 0,
    };
  }
  return b;
}

export default function MarketDataFeedDemo() {
  const reduce = useReducedMotion();
  const [running, setRunning] = useState(false);
  const [books, setBooks] = useState<Record<Sym, Book>>(freshBooks);
  const [recent, setRecent] = useState<Snapshot[]>([]);
  const [drains, setDrains] = useState(0);
  const [rawQuotes, setRawQuotes] = useState(0);
  const [emitted, setEmitted] = useState(0);
  const [lastDrainSyms, setLastDrainSyms] = useState<Sym[]>([]);

  const booksRef = useRef(books);
  const tickRef = useRef(0);
  const snapId = useRef(0);
  const quoteTimer = useRef<number | null>(null);
  const drainTimer = useRef<number | null>(null);
  booksRef.current = books;

  const clearTimers = useCallback(() => {
    if (quoteTimer.current !== null) window.clearInterval(quoteTimer.current);
    if (drainTimer.current !== null) window.clearInterval(drainTimer.current);
    quoteTimer.current = null;
    drainTimer.current = null;
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  // One inbound quote: mutate the book, mark dirty, maybe inject a bad sequence.
  const ingestQuote = useCallback(() => {
    tickRef.current += 1;
    const tick = tickRef.current;
    const sym = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    setRawQuotes((n) => n + 1);
    setBooks((prev) => {
      const cur = prev[sym];
      const drift = (Math.random() - 0.5) * 0.06;
      const bid = +(cur.bid + drift).toFixed(2);
      const ask = +(bid + (cur.ask - cur.bid)).toFixed(2);
      // ~12% of quotes skip a sequence number, tripping gap detection.
      const skip = Math.random() < 0.12;
      const nextSeq = cur.seq + (skip ? 2 : 1);
      return {
        ...prev,
        [sym]: {
          ...cur,
          bid,
          ask,
          dirty: true,
          seq: nextSeq,
          gap: skip,
          stale: false,
          lastQuoteTick: tick,
        },
      };
    });
  }, []);

  // One drain: emit exactly one snapshot per dirty symbol, clear the dirty set,
  // and flag any symbol that has gone quiet as stale.
  const drain = useCallback(() => {
    const tick = tickRef.current;
    setBooks((prev) => {
      const next = { ...prev };
      const out: Snapshot[] = [];
      const drained: Sym[] = [];
      for (const s of SYMBOLS) {
        const b = prev[s];
        const stale = !b.dirty && tick - b.lastQuoteTick >= STALE_TICKS && b.seq > 0;
        if (b.dirty) {
          const flags: string[] = [];
          if (b.gap) flags.push('gap');
          out.push({ id: snapId.current++, sym: s, bid: b.bid, ask: b.ask, flags });
          drained.push(s);
          next[s] = { ...b, dirty: false, gap: false, stale: false };
        } else {
          next[s] = { ...b, stale };
        }
      }
      if (out.length > 0) {
        setEmitted((n) => n + out.length);
        setRecent((r) => [...out, ...r].slice(0, 6));
        setDrains((d) => d + 1);
        setLastDrainSyms(drained);
      } else {
        setLastDrainSyms([]);
      }
      return next;
    });
  }, []);

  const start = useCallback(() => {
    if (running) return;
    setRunning(true);
    // Quotes flood in fast; the drain fires at a steady, slower cadence so the
    // coalescing is visible. Real drains run 10 to 100ms; slowed for the eye.
    quoteTimer.current = window.setInterval(ingestQuote, 280);
    drainTimer.current = window.setInterval(drain, 1300);
  }, [running, ingestQuote, drain]);

  const stop = useCallback(() => {
    setRunning(false);
    clearTimers();
  }, [clearTimers]);

  const reset = useCallback(() => {
    stop();
    tickRef.current = 0;
    snapId.current = 0;
    setBooks(freshBooks());
    setRecent([]);
    setDrains(0);
    setRawQuotes(0);
    setEmitted(0);
    setLastDrainSyms([]);
  }, [stop]);

  const step = useCallback(() => {
    if (running) return;
    // One manual cycle: a burst of quotes, then a single drain.
    const burst = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < burst; i++) ingestQuote();
    window.setTimeout(drain, reduce ? 0 : 120);
  }, [running, ingestQuote, drain, reduce]);

  const dirtyCount = SYMBOLS.filter((s) => books[s].dirty).length;
  const coalesceRatio = emitted > 0 ? (rawQuotes / emitted).toFixed(1) : '0.0';

  return (
    <div className="demo" aria-label="marketdatafeed coalesced book demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Coalesced best-bid-offer book</h3>
      <p className="demo__lede">
        Quotes flood in per symbol and mark the touched book dirty. Each drain
        emits exactly one snapshot per dirty symbol instead of forwarding every
        quote. Sequence gaps and stale books raise flags on the way through.
      </p>

      <div className="mdf__stats" role="group" aria-label="feed counters">
        <Stat label="raw quotes in" value={rawQuotes} mono />
        <Stat label="snapshots out" value={emitted} mono accent />
        <Stat label="drains" value={drains} mono />
        <Stat label="coalesce ratio" value={`${coalesceRatio}x`} mono accent />
      </div>

      <div className="mdf__books">
        {SYMBOLS.map((s) => {
          const b = books[s];
          const justDrained = lastDrainSyms.includes(s);
          return (
            <div
              key={s}
              className={[
                'mdf__book',
                b.dirty ? 'is-dirty' : '',
                b.gap ? 'is-gap' : '',
                b.stale ? 'is-stale' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-label={`${s} book${b.dirty ? ', dirty' : ''}${
                b.gap ? ', sequence gap' : ''
              }${b.stale ? ', stale' : ''}`}
            >
              <div className="mdf__book-head">
                <span className="mdf__sym">{s}</span>
                <span className="mdf__seq">seq {b.seq}</span>
              </div>
              <div className="mdf__quote">
                <span className="mdf__side mdf__side--bid">
                  <span className="mdf__side-label">bid</span>
                  <span className="mdf__px">{b.bid.toFixed(2)}</span>
                </span>
                <span className="mdf__spread" aria-hidden="true">
                  {(b.ask - b.bid).toFixed(2)}
                </span>
                <span className="mdf__side mdf__side--ask">
                  <span className="mdf__side-label">ask</span>
                  <span className="mdf__px">{b.ask.toFixed(2)}</span>
                </span>
              </div>
              <div className="mdf__flags">
                {b.dirty && <span className="mdf__flag mdf__flag--dirty">dirty</span>}
                {b.gap && <span className="mdf__flag mdf__flag--gap">gap</span>}
                {b.stale && <span className="mdf__flag mdf__flag--stale">stale</span>}
                {!b.dirty && !b.gap && !b.stale && (
                  <span className="mdf__flag mdf__flag--clean">clean</span>
                )}
              </div>
              <AnimatePresence>
                {justDrained && (
                  <motion.span
                    key={`pulse-${s}-${drains}`}
                    className="mdf__drained"
                    initial={{ opacity: reduce ? 1 : 0, scale: reduce ? 1 : 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduce ? 0 : 0.4, ease }}
                  >
                    emitted
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <div className="mdf__drain-row" aria-live="polite">
        <span className="mdf__drain-label">dirty set</span>
        <span className="mdf__drain-set">
          {dirtyCount === 0
            ? 'empty, next drain emits nothing'
            : `${dirtyCount} dirty, next drain emits ${dirtyCount} snapshot${
                dirtyCount > 1 ? 's' : ''
              }`}
        </span>
      </div>

      <div className="mdf__stream" aria-label="recent snapshot stream">
        <div className="mdf__stream-head">snapshot stream (SSE)</div>
        <AnimatePresence initial={false}>
          {recent.length === 0 ? (
            <div className="mdf__stream-empty">no snapshots yet</div>
          ) : (
            recent.map((snap) => (
              <motion.div
                key={snap.id}
                className="mdf__frame"
                initial={{ opacity: reduce ? 1 : 0, x: reduce ? 0 : -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.3, ease }}
              >
                <span className="mdf__frame-sym">{snap.sym}</span>
                <span className="mdf__frame-px">
                  {snap.bid.toFixed(2)} / {snap.ask.toFixed(2)}
                </span>
                {snap.flags.map((f) => (
                  <span key={f} className="mdf__frame-flag">
                    {f}
                  </span>
                ))}
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        {!running ? (
          <button className="demo__btn" onClick={start}>
            Start feed
          </button>
        ) : (
          <button className="demo__btn" onClick={stop}>
            Pause feed
          </button>
        )}
        <button
          className="demo__btn demo__btn--ghost"
          onClick={step}
          disabled={running}
        >
          Step one drain
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={rawQuotes === 0 && !running}
        >
          Reset
        </button>
        <span className="demo__hint">
          11 C++ tests plus 4 Python tests cover the book and latency math
        </span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div className={`mdf__stat${accent ? ' mdf__stat--accent' : ''}`}>
      <div className="mdf__stat-val">{value}</div>
      <div className="mdf__stat-label">{label}</div>
    </div>
  );
}
