import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './event-enricher.css';

// The consume, enrich, produce loop runs inside one Kafka transaction with an
// idempotent producer and a stable transactional.id. Offsets are committed
// through sendOffsetsToTransaction, and the consumer reads read_committed, so
// the outbound topic sees each inbound event at most once even when the loop
// is hard-killed mid-batch and the broker is bounced. Enrichment joins a
// Postgres lookup behind a Caffeine cache.
//
// Real numbers from the project: warm-cache run hits 3,232 events/s with
// p50 819 ms and a 0.962 cache hit rate; cold-cache run hits 1,925 events/s.
const WARM = { rate: 3232, p50: 819, hit: 0.962 };
const COLD = { rate: 1925 };

type Stage = 'queued' | 'poll' | 'begin' | 'enrich' | 'send' | 'commit' | 'done';
const STAGES: { id: Stage; label: string }[] = [
  { id: 'poll', label: 'poll' },
  { id: 'begin', label: 'beginTransaction' },
  { id: 'enrich', label: 'enrich' },
  { id: 'send', label: 'send' },
  { id: 'commit', label: 'commit' },
];

type Ev = {
  id: number;
  key: string;
  stage: Stage;
  cacheHit: boolean | null; // resolved at enrich
  committed: boolean;
  aborted: boolean;
};

const KEYS = ['u-1042', 'u-2391', 'u-1042', 'u-7720', 'u-2391', 'u-9810', 'u-1042', 'u-5503'];

const ease = [0.22, 1, 0.36, 1] as const;

function makeBatch(): Ev[] {
  return KEYS.map((key, i) => ({
    id: i + 1,
    key,
    stage: 'queued' as Stage,
    cacheHit: null,
    committed: false,
    aborted: false,
  }));
}

export default function EventEnricherDemo() {
  const reduce = useReducedMotion();
  const [warm, setWarm] = useState(true);
  const [events, setEvents] = useState<Ev[]>(makeBatch);
  const [downstream, setDownstream] = useState<number[]>([]); // committed event ids
  const [cursor, setCursor] = useState(0); // index of the in-flight event
  const [running, setRunning] = useState(false);
  const [killed, setKilled] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const tickRef = useRef<number | null>(null);
  const seen = useRef<Set<number>>(new Set());
  const cacheSeen = useRef<Set<string>>(new Set());

  function stop() {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }
  useEffect(() => stop, []);

  function addLog(line: string) {
    setLog((l) => [line, ...l].slice(0, 7));
  }

  // Advance the in-flight event through one stage. On commit, the event_id is
  // appended downstream exactly once; a kill mid-transaction aborts and the
  // event is re-polled from the same offset on the next pass.
  function advanceOne() {
    setEvents((prev) => {
      const idx = prev.findIndex((e) => e.stage !== 'done' && e.stage !== 'queued');
      const startIdx = idx === -1 ? prev.findIndex((e) => e.stage === 'queued') : idx;
      if (startIdx === -1) {
        stop();
        setRunning(false);
        return prev;
      }
      const next = [...prev];
      const e = { ...next[startIdx] };

      const order: Stage[] = ['queued', 'poll', 'begin', 'enrich', 'send', 'commit', 'done'];
      const cur = order.indexOf(e.stage);
      const nextStage = order[cur + 1];

      if (nextStage === 'enrich') {
        const hit = warm ? cacheSeen.current.has(e.key) : false;
        e.cacheHit = hit;
        if (!hit) cacheSeen.current.add(e.key);
        addLog(
          hit
            ? `enrich ${e.key}: cache hit`
            : `enrich ${e.key}: Postgres lookup -> cache`,
        );
      }

      // A broker kill during begin/enrich/send aborts the open transaction.
      if (killed && (e.stage === 'begin' || e.stage === 'enrich' || e.stage === 'send')) {
        e.stage = 'queued'; // re-polled from the same offset
        e.cacheHit = null;
        e.aborted = true;
        addLog(`broker down: tx aborted, event ${e.id} re-polled from offset`);
        next[startIdx] = e;
        return next;
      }

      if (nextStage === 'commit') {
        // Commit is the only place the id reaches downstream, and only once.
        if (!seen.current.has(e.id)) {
          seen.current.add(e.id);
          setDownstream((d) => [...d, e.id]);
          addLog(`commit: event ${e.id} (${e.key}) sent downstream once`);
        }
        e.committed = true;
      }

      e.stage = nextStage;
      e.aborted = false;
      next[startIdx] = e;
      setCursor(startIdx);
      return next;
    });
  }

  function play() {
    if (running) return;
    setRunning(true);
    if (reduce) {
      // Run the whole batch to completion without interval animation.
      for (let i = 0; i < KEYS.length * 6 + 4; i += 1) advanceOne();
      setRunning(false);
      return;
    }
    tickRef.current = window.setInterval(() => {
      advanceOne();
    }, 520);
  }
  function pause() {
    stop();
    setRunning(false);
  }
  function reset() {
    stop();
    setRunning(false);
    setKilled(false);
    seen.current = new Set();
    cacheSeen.current = new Set();
    setEvents(makeBatch());
    setDownstream([]);
    setCursor(0);
    setLog([]);
  }
  function toggleKill() {
    setKilled((k) => {
      const nk = !k;
      addLog(nk ? 'broker killed mid-batch' : 'broker recovered');
      return nk;
    });
  }

  const stats = warm ? WARM : COLD;
  const committedCount = downstream.length;
  const uniqueDownstream = new Set(downstream).size;
  const hitRate = warm ? WARM.hit : 0;

  return (
    <div className="demo" aria-label="event-enricher transactional loop demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Exactly-once under broker restart</h3>
      <p className="demo__lede">
        Each event runs through poll, beginTransaction, enrich, send, commit
        inside one Kafka transaction. Kill the broker mid-batch: the open
        transaction aborts and the event is re-polled from the same offset, so
        the outbound topic still sees every event_id at most once.
      </p>

      <div className="ee__stage">
        <div className="ee__toggle-row">
          <div className="ee__cache" role="group" aria-label="cache state">
            <button
              type="button"
              className={`ee__cache-btn${warm ? ' ee__cache-btn--on' : ''}`}
              aria-pressed={warm}
              onClick={() => setWarm(true)}
            >
              warm cache
            </button>
            <button
              type="button"
              className={`ee__cache-btn${!warm ? ' ee__cache-btn--on' : ''}`}
              aria-pressed={!warm}
              onClick={() => setWarm(false)}
            >
              cold cache
            </button>
          </div>
          <div className="ee__throughput">
            <span className="ee__throughput-val">
              {stats.rate.toLocaleString()}
            </span>
            <span className="ee__throughput-unit">events/s</span>
            {warm && (
              <span className="ee__throughput-meta">
                p50 {WARM.p50}ms / hit {hitRate}
              </span>
            )}
          </div>
        </div>

        <ol className="ee__pipeline" aria-label="transactional loop stages">
          {STAGES.map((st) => {
            const here = events.filter((e) => e.stage === st.id);
            const inflight = events[cursor];
            const isActive = inflight && inflight.stage === st.id && running;
            return (
              <li
                key={st.id}
                className={`ee__stage-col${isActive ? ' ee__stage-col--active' : ''}${
                  killed && (st.id === 'begin' || st.id === 'enrich' || st.id === 'send')
                    ? ' ee__stage-col--danger'
                    : ''
                }`}
              >
                <span className="ee__stage-name">{st.label}</span>
                <div className="ee__stage-slot">
                  <AnimatePresence initial={false}>
                    {here.map((e) => (
                      <motion.span
                        key={e.id}
                        className={`ee__token${
                          e.cacheHit === true ? ' ee__token--hit' : ''
                        }${e.cacheHit === false ? ' ee__token--miss' : ''}${
                          e.aborted ? ' ee__token--abort' : ''
                        }`}
                        initial={{ opacity: 0, scale: reduce ? 1 : 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: reduce ? 1 : 0.5 }}
                        transition={{ duration: reduce ? 0 : 0.25, ease }}
                        title={`event ${e.id} (${e.key})`}
                      >
                        {e.id}
                      </motion.span>
                    ))}
                  </AnimatePresence>
                </div>
                {st.id === 'enrich' && (
                  <span className="ee__stage-sub">Caffeine / Postgres</span>
                )}
                {st.id === 'commit' && (
                  <span className="ee__stage-sub">sendOffsets</span>
                )}
              </li>
            );
          })}
        </ol>

        <div className="ee__downstream">
          <div className="ee__downstream-head">
            <span>outbound topic</span>
            <span className="ee__downstream-guard">
              {committedCount} sent / {uniqueDownstream} unique event_id
            </span>
          </div>
          <div className="ee__downstream-row">
            <AnimatePresence initial={false}>
              {downstream.map((id, i) => (
                <motion.span
                  key={`${id}-${i}`}
                  className="ee__out-token"
                  initial={{ opacity: 0, y: reduce ? 0 : 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduce ? 0 : 0.3, ease }}
                >
                  {id}
                </motion.span>
              ))}
            </AnimatePresence>
            {downstream.length === 0 && (
              <span className="ee__downstream-empty">no commits yet</span>
            )}
          </div>
          <div
            className={`ee__verdict${
              committedCount === uniqueDownstream
                ? ' ee__verdict--ok'
                : ' ee__verdict--bad'
            }`}
          >
            {committedCount === uniqueDownstream
              ? 'no duplicate event_id downstream'
              : 'duplicate detected'}
          </div>
        </div>

        <ul className="ee__log" aria-label="transaction log" aria-live="polite">
          {log.length === 0 && <li className="ee__log-empty">loop idle</li>}
          {log.map((line, i) => (
            <li key={`${line}-${i}`} className="ee__log-line">
              {line}
            </li>
          ))}
        </ul>
      </div>

      <div className="demo__controls">
        {running ? (
          <button type="button" className="demo__btn" onClick={pause}>
            Pause
          </button>
        ) : (
          <button type="button" className="demo__btn" onClick={play}>
            Run loop
          </button>
        )}
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={advanceOne}
          disabled={running}
        >
          Step
        </button>
        <button
          type="button"
          className={`demo__btn demo__btn--ghost${killed ? ' ee__kill--on' : ''}`}
          onClick={toggleKill}
          aria-pressed={killed}
        >
          {killed ? 'Recover broker' : 'Kill broker'}
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={reset}
        >
          Reset
        </button>
        <span className="demo__hint">
          {killed
            ? 'broker down: transactions abort and re-poll'
            : warm
              ? 'warm cache: lookups served from Caffeine'
              : 'cold cache: every key hits Postgres first'}
        </span>
      </div>
    </div>
  );
}
