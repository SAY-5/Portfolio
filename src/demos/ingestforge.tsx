import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './ingestforge.css';

// Real mechanism: Kafka work-items fan into a partitioned worker pool. Each
// document's type is sniffed from its magic bytes when content_type=auto, then
// routed to a pluggable extractor (PDF, DOCX, HTML, text, email). A dedup_key
// recorded in Postgres before any work makes a repeat a no-op. Benchmarked at
// 10362 plain-text docs/s (~6.2M docs/hour) on a 10-core Apple M1 Pro.

const ease = [0.22, 1, 0.36, 1] as const;
const PEAK_RATE = 10362; // plain-text docs/s, real benchmark
const TARGET_HOUR = 200000; // single-node design target, docs/hour

type Kind = 'pdf' | 'docx' | 'html' | 'text' | 'email';

const KIND_META: Record<Kind, { ext: string; magic: string }> = {
  pdf: { ext: 'PdfPig', magic: '25 50 44 46' },
  docx: { ext: 'OpenXml', magic: '50 4B 03 04' },
  html: { ext: 'HtmlAgility', magic: '3C 21 2D 2D' },
  text: { ext: 'PlainText', magic: 'utf-8' },
  email: { ext: 'MimeKit', magic: 'Return-Path' },
};

type Item = {
  id: number;
  kind: Kind;
  worker: number;
  dedup: string;
  dup: boolean;
  poison: boolean;
};

// Deterministic feed of 14 items: a mix of types, one repeated dedup key
// (#3 reuses dk-a1 so it is a no-op), and one poison message routed to the DLQ.
const FEED: Item[] = [
  { id: 1, kind: 'text', worker: 0, dedup: 'dk-a1', dup: false, poison: false },
  { id: 2, kind: 'pdf', worker: 1, dedup: 'dk-b2', dup: false, poison: false },
  { id: 3, kind: 'text', worker: 2, dedup: 'dk-a1', dup: true, poison: false },
  { id: 4, kind: 'html', worker: 3, dedup: 'dk-c3', dup: false, poison: false },
  { id: 5, kind: 'docx', worker: 0, dedup: 'dk-d4', dup: false, poison: false },
  { id: 6, kind: 'email', worker: 1, dedup: 'dk-e5', dup: false, poison: false },
  { id: 7, kind: 'text', worker: 2, dedup: 'dk-f6', dup: false, poison: false },
  { id: 8, kind: 'pdf', worker: 3, dedup: 'dk-g7', dup: false, poison: true },
  { id: 9, kind: 'text', worker: 0, dedup: 'dk-h8', dup: false, poison: false },
  { id: 10, kind: 'html', worker: 1, dedup: 'dk-i9', dup: false, poison: false },
  { id: 11, kind: 'text', worker: 2, dedup: 'dk-j0', dup: false, poison: false },
  { id: 12, kind: 'docx', worker: 3, dedup: 'dk-k1', dup: false, poison: false },
  { id: 13, kind: 'text', worker: 0, dedup: 'dk-l2', dup: false, poison: false },
  { id: 14, kind: 'email', worker: 1, dedup: 'dk-m3', dup: false, poison: false },
];

const WORKERS = [0, 1, 2, 3];

export default function IngestforgeDemo() {
  const reduce = useReducedMotion();
  const [running, setRunning] = useState(false);
  const [inFlight, setInFlight] = useState<Item | null>(null);
  const [slots, setSlots] = useState<Record<number, Item | null>>({
    0: null,
    1: null,
    2: null,
    3: null,
  });
  const [processed, setProcessed] = useState(0);
  const [deduped, setDeduped] = useState(0);
  const [poison, setPoison] = useState(0);
  const [dlqHit, setDlqHit] = useState(false);
  const [rate, setRate] = useState(0);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function reset() {
    clearTimers();
    setRunning(false);
    setInFlight(null);
    setSlots({ 0: null, 1: null, 2: null, 3: null });
    setProcessed(0);
    setDeduped(0);
    setPoison(0);
    setDlqHit(false);
    setRate(0);
  }

  function land(item: Item) {
    setSlots((prev) => ({ ...prev, [item.worker]: item }));
    if (item.dup) {
      setDeduped((d) => d + 1);
      return;
    }
    if (item.poison) {
      setPoison((p) => p + 1);
      setDlqHit(true);
      const t = window.setTimeout(() => setDlqHit(false), reduce ? 0 : 600);
      timers.current.push(t);
      return;
    }
    setProcessed((p) => p + 1);
    // ramp the live docs/sec toward the real benchmark peak as the pool fills
    setRate((r) => Math.min(PEAK_RATE, Math.round(r + (PEAK_RATE - r) * 0.34 + 380)));
  }

  function step(i: number) {
    if (i >= FEED.length) {
      setRunning(false);
      setInFlight(null);
      setRate(PEAK_RATE);
      return;
    }
    const item = FEED[i];
    setInFlight(item);

    if (reduce) {
      land(item);
      setInFlight(null);
      const t = window.setTimeout(() => step(i + 1), 0);
      timers.current.push(t);
      return;
    }

    const tLand = window.setTimeout(() => {
      land(item);
      setInFlight(null);
    }, 520);
    const tNext = window.setTimeout(() => step(i + 1), 720);
    timers.current.push(tLand, tNext);
  }

  function run() {
    if (running) return;
    reset();
    setRunning(true);
    const t = window.setTimeout(() => step(0), reduce ? 0 : 60);
    timers.current.push(t);
  }

  const projectedHour = Math.round((rate * 3600) / 1000) * 1000;

  return (
    <div className="demo" aria-label="ingestforge document pipeline demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Sniff, route, extract, count</h3>
      <p className="demo__lede">
        Run the stream to watch Kafka work-items fan into a partitioned worker
        pool. Each document's type is detected from its magic bytes, routed to
        the matching extractor, and counted toward a live docs per second rate.
        A repeated dedup key is a no-op, and a poison message lands in the
        dead-letter topic.
      </p>

      <div className="if__stage">
        <div className="if__flow">
          <div className="if__source">
            <span className="if__source-label">
              <b>Kafka</b> documents.in
            </span>
            <div className="if__belt" aria-label="incoming work items">
              <AnimatePresence>
                {inFlight && (
                  <motion.span
                    key={inFlight.id}
                    className={`if__item${inFlight.dup ? ' if__item--dup' : ''}`}
                    initial={{ left: reduce ? '82%' : '2%', opacity: 0 }}
                    animate={{ left: '82%', opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduce ? 0 : 0.5, ease }}
                  >
                    doc#{inFlight.id} · {KIND_META[inFlight.kind].magic}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="if__workers">
            {WORKERS.map((w) => {
              const item = slots[w];
              const hot = inFlight?.worker === w || (item && running);
              return (
                <div
                  className={`if__worker${hot ? ' if__worker--hot' : ''}`}
                  key={w}
                >
                  <div className="if__worker-head">
                    <span className="if__worker-name">worker {w}</span>
                    <span className="if__worker-part">partition {w}</span>
                  </div>
                  <AnimatePresence mode="wait">
                    {item ? (
                      <motion.div
                        key={item.id}
                        className="if__extractor"
                        initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: reduce ? 0 : 0.26, ease }}
                      >
                        <span className="if__ext-badge">{item.kind}</span>
                        {item.dup
                          ? 'dedup hit, no-op'
                          : item.poison
                            ? 'parse failed → DLQ'
                            : KIND_META[item.kind].ext}
                      </motion.div>
                    ) : (
                      <div className="if__extractor if__extractor--empty">
                        idle
                      </div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>

          <div className={`if__dlq${dlqHit ? ' if__dlq--hit' : ''}`}>
            <span className="if__dlq-icon" />
            <span className="if__dlq-label">
              <b>dead-letter topic</b> after N failed attempts
            </span>
            <span className="if__dlq-count">{poison} routed</span>
          </div>
        </div>

        <div className="if__meters">
          <div className="if__meter if__meter--rate">
            <span className="if__meter-val">
              {rate.toLocaleString()}
              <span className="if__meter-unit">docs/sec</span>
            </span>
            <span className="if__meter-label">
              live rate, peaks at {PEAK_RATE.toLocaleString()}
            </span>
          </div>
          <div className="if__meter">
            <span className="if__meter-val">{processed}</span>
            <span className="if__meter-label">extracted</span>
          </div>
          <div className="if__meter">
            <span className="if__meter-val">{deduped}</span>
            <span className="if__meter-label">dedup no-ops</span>
          </div>
        </div>

        <div className="if__dedup" role="status">
          <span className="if__dedup-tag">
            {rate >= PEAK_RATE
              ? `~${(projectedHour / 1_000_000).toFixed(1)}M/hour`
              : 'exactly-once'}
          </span>
          <span className="if__dedup-text">
            Each dedup_key is recorded in Postgres before any work, so a repeated
            message does nothing. The plain-text path benchmarks at{' '}
            {PEAK_RATE.toLocaleString()} docs/s, roughly 6.2M per hour, against a
            single-node design target of {TARGET_HOUR.toLocaleString()} docs/hour
            on mixed PDF-heavy loads.
          </span>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Streaming…' : 'Run stream'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          {FEED.length} messages, 4 partitions, 1 duplicate, 1 poison
        </span>
      </div>
    </div>
  );
}
