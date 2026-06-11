import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './clouddrive.css';

// CloudDrive mirrors objects across S3, Azure Blob, and GCS. It canonicalizes
// content on its own SHA-256 hash because no two providers' etags compare
// across providers, then runs chunked parallel multipart uploads with
// adaptive concurrency that backs off under throttling. Live progress streams
// over SSE with a per-job bandwidth meter. Sustained 1.8 GB/s in load tests.
const PROVIDERS = ['S3', 'Azure Blob', 'GCS'] as const;
const TOTAL_CHUNKS = 12; // chunks the object is split into for multipart
const PEAK_GBPS = 1.8; // sustained ceiling from load tests
const MAX_CONC = 6; // adaptive concurrency window when healthy
const THROTTLED_CONC = 2; // window after backing off on 429s

type ChunkState = 'pending' | 'active' | 'done';
type FeedLine = { id: number; text: string; kind: 'sha' | 'chunk' | 'throttle' | 'done' };

const ease = [0.22, 1, 0.36, 1] as const;

function fakeHash(seed: number) {
  const hex = '0123456789abcdef';
  let s = '';
  let x = seed * 2654435761;
  for (let i = 0; i < 12; i++) {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >> 17)) >>> 0;
    s += hex[x & 15];
  }
  return s;
}

export default function ClouddriveDemo() {
  const reduce = useReducedMotion();
  const [throttled, setThrottled] = useState(false);
  const [running, setRunning] = useState(true);
  const [chunks, setChunks] = useState<ChunkState[]>(
    () => new Array<ChunkState>(TOTAL_CHUNKS).fill('pending')
  );
  const [gbps, setGbps] = useState(0);
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const [objCount, setObjCount] = useState(0);
  const [hash, setHash] = useState(() => fakeHash(1));

  const throttledRef = useRef(false);
  const chunksRef = useRef<ChunkState[]>(new Array<ChunkState>(TOTAL_CHUNKS).fill('pending'));
  const feedIdRef = useRef(0);
  const objRef = useRef(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    throttledRef.current = throttled;
  }, [throttled]);

  function pushFeed(text: string, kind: FeedLine['kind']) {
    const id = feedIdRef.current++;
    setFeed((prev) => [{ id, text, kind }, ...prev].slice(0, 6));
  }

  function startObject() {
    objRef.current += 1;
    setObjCount(objRef.current);
    const h = fakeHash(objRef.current + 1);
    setHash(h);
    chunksRef.current = new Array<ChunkState>(TOTAL_CHUNKS).fill('pending');
    setChunks([...chunksRef.current]);
    pushFeed(`sha256 ${h}.. matched across 3 providers`, 'sha');
  }

  function tick() {
    const conc = throttledRef.current ? THROTTLED_CONC : MAX_CONC;
    const c = chunksRef.current;

    // finish whatever is currently active
    const active = c.map((s, i) => (s === 'active' ? i : -1)).filter((i) => i >= 0);
    for (const i of active) c[i] = 'done';

    // throttling injects a 429 backoff event roughly each window
    if (throttledRef.current && Math.random() < 0.5) {
      pushFeed(`429 from provider, concurrency ${MAX_CONC} -> ${THROTTLED_CONC}`, 'throttle');
    }

    // start up to `conc` pending chunks in parallel
    const pending = c.map((s, i) => (s === 'pending' ? i : -1)).filter((i) => i >= 0);
    const starting = pending.slice(0, conc);
    for (const i of starting) c[i] = 'active';
    if (starting.length) {
      pushFeed(`upload chunks ${starting.map((i) => i + 1).join(', ')}`, 'chunk');
    }

    const doneCount = c.filter((s) => s === 'done').length;
    if (doneCount >= TOTAL_CHUNKS) {
      pushFeed(`object synced, ${TOTAL_CHUNKS} chunks committed`, 'done');
      setChunks([...c]);
      window.setTimeout(() => startObject(), reduce ? 0 : 260);
      // bandwidth dips to zero between objects
      setGbps(0);
      return;
    }

    // bandwidth scales with concurrency, capped at the load-test ceiling
    const frac = conc / MAX_CONC;
    const wob = 1 + (Math.random() - 0.5) * 0.12;
    setGbps(+(PEAK_GBPS * frac * wob).toFixed(2));
    setChunks([...c]);
  }

  useEffect(() => {
    if (!running) {
      if (timer.current) window.clearInterval(timer.current);
      timer.current = null;
      return;
    }
    if (objRef.current === 0) startObject();
    const ms = reduce ? 420 : 520;
    timer.current = window.setInterval(tick, ms);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, reduce]);

  function reset() {
    objRef.current = 0;
    feedIdRef.current = 0;
    chunksRef.current = new Array<ChunkState>(TOTAL_CHUNKS).fill('pending');
    setChunks([...chunksRef.current]);
    setFeed([]);
    setObjCount(0);
    setGbps(0);
    setThrottled(false);
    setHash(fakeHash(1));
    startObject();
  }

  const conc = throttled ? THROTTLED_CONC : MAX_CONC;
  const doneCount = chunks.filter((s) => s === 'done').length;
  const gbpsPct = Math.min(100, (gbps / PEAK_GBPS) * 100);

  return (
    <div className="demo" aria-label="clouddrive multi-cloud sync demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Sync across three clouds</h3>
      <p className="demo__lede">
        Objects canonicalize on a SHA-256 hash the engine computes itself, since
        no two providers' etags compare across providers, then upload as chunked
        parallel multipart. Toggle throttling to watch adaptive concurrency back
        off on 429s while the bandwidth meter and SSE feed track the job.
      </p>

      <div className="cd__stage">
        <div className="cd__providers">
          {PROVIDERS.map((p, i) => (
            <motion.div
              key={p}
              className="cd__provider"
              animate={
                reduce
                  ? {}
                  : { boxShadow: ['0 0 0 0 rgba(255,91,41,0)', '0 0 0 3px var(--accent-glow)', '0 0 0 0 rgba(255,91,41,0)'] }
              }
              transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.4 }}
            >
              {p}
            </motion.div>
          ))}
          <div className="cd__arrow" aria-hidden="true">
            into sync engine
          </div>
        </div>

        <div className="cd__hashrow">
          <span className="cd__hash-label">cross-provider sha256</span>
          <code className="cd__hash">{hash}...</code>
          <span className="cd__hash-ok">3 providers agree</span>
        </div>

        <div className="cd__chunks" role="img" aria-label="multipart chunk upload progress">
          {chunks.map((s, i) => (
            <motion.div
              key={i}
              className={`cd__chunk cd__chunk--${s}`}
              initial={false}
              animate={
                s === 'active' && !reduce
                  ? { opacity: [0.6, 1, 0.6] }
                  : { opacity: 1 }
              }
              transition={s === 'active' ? { duration: 0.9, repeat: Infinity } : { duration: 0.2 }}
            >
              {i + 1}
            </motion.div>
          ))}
        </div>

        <div className="cd__panel">
          <div className="cd__meter">
            <div className="cd__meter-head">
              <span>bandwidth</span>
              <span className="cd__meter-val">{gbps.toFixed(2)} GB/s</span>
            </div>
            <div className="cd__meter-track">
              <motion.div
                className="cd__meter-fill"
                animate={{ width: `${gbpsPct}%` }}
                transition={{ duration: reduce ? 0 : 0.3, ease }}
              />
            </div>
            <div className="cd__meter-meta">
              ceiling {PEAK_GBPS} GB/s, concurrency window {conc} of {MAX_CONC}
            </div>
          </div>

          <div className="cd__feed">
            <div className="cd__feed-head">SSE progress feed</div>
            <ul className="cd__feed-list">
              <AnimatePresence initial={false}>
                {feed.map((f) => (
                  <motion.li
                    key={f.id}
                    className={`cd__feed-line cd__feed-line--${f.kind}`}
                    initial={{ opacity: 0, y: reduce ? 0 : -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    {f.text}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        </div>

        <div className="cd__stats">
          <div className="cd__stat">
            <div className="cd__stat-val">{objCount}</div>
            <div className="cd__stat-unit">objects mirrored</div>
          </div>
          <div className="cd__stat">
            <div className="cd__stat-val">
              {doneCount}/{TOTAL_CHUNKS}
            </div>
            <div className="cd__stat-unit">chunks committed</div>
          </div>
          <div className={`cd__stat${throttled ? ' cd__stat--warn' : ''}`}>
            <div className="cd__stat-val">{throttled ? 'backing off' : 'healthy'}</div>
            <div className="cd__stat-unit">adaptive concurrency</div>
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button
          className={`demo__btn${throttled ? '' : ' demo__btn--ghost'}`}
          onClick={() => setThrottled((t) => !t)}
          aria-pressed={throttled}
        >
          {throttled ? 'Clear throttling' : 'Inject throttling'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause' : 'Resume'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">conflict policy: newest_wins</span>
      </div>
    </div>
  );
}
