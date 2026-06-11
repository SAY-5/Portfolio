import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './pulseroute.css';

// Real numbers from the project:
// - Routing plus semantic cache saved 75.9% vs a single-provider pinned
//   baseline on a duplicate-heavy 10k-request synthetic workload.
// - 39.8% overall cache hit rate, 93.2% on duplicates.
// - Semantic cache hits gated on cosine similarity above a default 0.97
//   threshold over a normalised per-tenant prompt fingerprint.
// - Per-provider circuit-breaker state; OPEN breakers are skipped.
const CACHE_THRESHOLD = 0.97;
const SAVED_PCT = 75.9;
const CACHE_HIT_RATE = 39.8;
const DUP_HIT_RATE = 93.2;

type Provider = {
  id: string;
  name: string;
  cost: number; // relative cost per request unit
  quality: number; // 0..1
  latency: number; // ms p50
  breaker: 'closed' | 'open';
};

const PROVIDERS: Provider[] = [
  { id: 'p1', name: 'aurora-lg', cost: 1.0, quality: 0.95, latency: 820, breaker: 'closed' },
  { id: 'p2', name: 'aurora-md', cost: 0.45, quality: 0.88, latency: 510, breaker: 'closed' },
  { id: 'p3', name: 'nimbus-fast', cost: 0.22, quality: 0.79, latency: 240, breaker: 'closed' },
  { id: 'p4', name: 'relay-edge', cost: 0.18, quality: 0.74, latency: 180, breaker: 'open' },
];

// The pinned baseline always routes to the most expensive provider.
const PINNED = PROVIDERS[0];

type Req = {
  id: string;
  prompt: string;
  dup: boolean; // a near-duplicate of an earlier prompt
  sim: number; // cosine similarity to the cached fingerprint
};

// A short synthetic stream that mirrors the duplicate-heavy workload: enough
// duplicates that a chunk resolve from cache above the 0.97 threshold.
const STREAM: Req[] = [
  { id: 'r1', prompt: 'summarize the q3 revenue memo', dup: false, sim: 0.41 },
  { id: 'r2', prompt: 'summarise the q3 revenue memo', dup: true, sim: 0.991 },
  { id: 'r3', prompt: 'classify this ticket severity', dup: false, sim: 0.33 },
  { id: 'r4', prompt: 'summarize the q3 revenue memo please', dup: true, sim: 0.974 },
  { id: 'r5', prompt: 'translate the onboarding email', dup: false, sim: 0.28 },
  { id: 'r6', prompt: 'classify ticket severity now', dup: true, sim: 0.962 },
];

// router score: prefer high quality, low cost, low latency. Higher is better.
function routerScore(p: Provider): number {
  const costTerm = 1 - p.cost; // cheaper is better
  const latTerm = 1 - p.latency / 900; // faster is better
  return p.quality * 0.5 + costTerm * 0.32 + latTerm * 0.18;
}

const ease = [0.22, 1, 0.36, 1] as const;

type Outcome = {
  reqId: string;
  cached: boolean;
  provider: Provider | null;
  baselineCost: number;
  actualCost: number;
};

export default function PulserouteDemo() {
  const reduce = useReducedMotion();
  const [providers, setProviders] = useState(PROVIDERS);
  const [idx, setIdx] = useState(-1); // current request index, -1 = idle
  const [phase, setPhase] = useState<'idle' | 'cache' | 'route' | 'done'>('idle');
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ranked = useMemo(() => {
    return providers
      .map((p) => ({ p, score: routerScore(p) }))
      .sort((a, b) => b.score - a.score);
  }, [providers]);

  const totals = useMemo(() => {
    const baseline = outcomes.reduce((s, o) => s + o.baselineCost, 0);
    const actual = outcomes.reduce((s, o) => s + o.actualCost, 0);
    const hits = outcomes.filter((o) => o.cached).length;
    const saved = baseline > 0 ? ((baseline - actual) / baseline) * 100 : 0;
    return { baseline, actual, hits, saved };
  }, [outcomes]);

  function clearTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => clearTimer, []);

  function toggleBreaker(id: string) {
    if (running) return;
    setProviders((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, breaker: p.breaker === 'open' ? 'closed' : 'open' } : p,
      ),
    );
  }

  function reset() {
    clearTimer();
    setRunning(false);
    setIdx(-1);
    setPhase('idle');
    setOutcomes([]);
  }

  function resolveRequest(req: Req): Outcome {
    const cached = req.sim >= CACHE_THRESHOLD;
    // pick best provider whose breaker is closed
    const pick = providers
      .filter((p) => p.breaker === 'closed')
      .map((p) => ({ p, score: routerScore(p) }))
      .sort((a, b) => b.score - a.score)[0]?.p ?? null;
    const baselineCost = PINNED.cost;
    const actualCost = cached ? 0 : pick ? pick.cost : PINNED.cost;
    return { reqId: req.id, cached, provider: cached ? null : pick, baselineCost, actualCost };
  }

  function run() {
    clearTimer();
    setOutcomes([]);
    if (reduce) {
      const all = STREAM.map(resolveRequest);
      setOutcomes(all);
      setIdx(STREAM.length - 1);
      setPhase('done');
      setRunning(false);
      return;
    }
    setRunning(true);
    setIdx(-1);
    setPhase('idle');

    const step = (i: number) => {
      if (i >= STREAM.length) {
        setPhase('done');
        setRunning(false);
        timer.current = null;
        return;
      }
      setIdx(i);
      setPhase('cache');
      timer.current = setTimeout(() => {
        const req = STREAM[i];
        const hit = req.sim >= CACHE_THRESHOLD;
        if (hit) {
          setOutcomes((prev) => [...prev, resolveRequest(req)]);
          timer.current = setTimeout(() => step(i + 1), 520);
        } else {
          setPhase('route');
          timer.current = setTimeout(() => {
            setOutcomes((prev) => [...prev, resolveRequest(req)]);
            timer.current = setTimeout(() => step(i + 1), 360);
          }, 620);
        }
      }, 560);
    };
    timer.current = setTimeout(() => step(0), 160);
  }

  const current = idx >= 0 && idx < STREAM.length ? STREAM[idx] : null;
  const currentOutcome = outcomes.find((o) => o.reqId === current?.id) ?? null;
  const inCachePhase = phase === 'cache';
  const inRoutePhase = phase === 'route';

  return (
    <div className="demo" aria-label="pulseroute gateway demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Route a request through the gateway</h3>
      <p className="demo__lede">
        Each request first hits the semantic cache, gated on cosine similarity
        above {CACHE_THRESHOLD}. On a miss the router ranks candidate providers
        by quality, cost, and latency, skipping any whose circuit breaker is
        open. Flip a breaker, then play the stream to watch the cost-saved
        counter climb against the pinned baseline.
      </p>

      <div className="pr__flow">
        {/* incoming request */}
        <div className="pr__col pr__col--in">
          <span className="pr__col-label">request</span>
          <AnimatePresence mode="wait">
            {current ? (
              <motion.div
                key={current.id}
                className="pr__req"
                initial={{ opacity: 0, x: reduce ? 0 : -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.3, ease }}
              >
                <span className="pr__req-id">{current.id}</span>
                <span className="pr__req-prompt">{current.prompt}</span>
              </motion.div>
            ) : (
              <div className="pr__req pr__req--empty">idle</div>
            )}
          </AnimatePresence>
        </div>

        {/* cache gate */}
        <div
          className={`pr__col pr__col--cache${
            inCachePhase ? ' pr__col--active' : ''
          }${currentOutcome?.cached ? ' pr__col--hit' : ''}`}
        >
          <span className="pr__col-label">semantic cache</span>
          <div className="pr__gate">
            <span className="pr__gate-sim">
              {current ? `cos ${current.sim.toFixed(3)}` : `cos 0.000`}
            </span>
            <span className="pr__gate-thr">threshold {CACHE_THRESHOLD}</span>
            <AnimatePresence>
              {current && (inCachePhase || currentOutcome) && (
                <motion.span
                  key={`${current.id}-verdict`}
                  className={`pr__gate-verdict${
                    current.sim >= CACHE_THRESHOLD ? ' pr__gate-verdict--hit' : ' pr__gate-verdict--miss'
                  }`}
                  initial={{ opacity: 0, scale: reduce ? 1 : 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: reduce ? 0 : 0.28, ease }}
                >
                  {current.sim >= CACHE_THRESHOLD ? 'HIT' : 'MISS'}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* router ranking */}
        <div className={`pr__col pr__col--route${inRoutePhase ? ' pr__col--active' : ''}`}>
          <span className="pr__col-label">router ranking</span>
          <ul className="pr__ranks">
            {ranked.map(({ p, score }, i) => {
              const open = p.breaker === 'open';
              const chosen =
                currentOutcome && !currentOutcome.cached && currentOutcome.provider?.id === p.id;
              return (
                <li
                  key={p.id}
                  className={`pr__rank${open ? ' pr__rank--open' : ''}${
                    chosen ? ' pr__rank--chosen' : ''
                  }`}
                >
                  <span className="pr__rank-pos">{open ? '-' : i + 1}</span>
                  <span className="pr__rank-name">{p.name}</span>
                  <span className="pr__rank-meta">
                    q{p.quality.toFixed(2)} · {p.cost.toFixed(2)}x · {p.latency}ms
                  </span>
                  <span className="pr__rank-state">
                    {open ? 'OPEN' : chosen ? 'ROUTED' : score.toFixed(2)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="pr__breakers" role="group" aria-label="circuit breakers">
        <span className="pr__breakers-label">circuit breakers</span>
        <div className="pr__breaker-row">
          {providers.map((p) => {
            const open = p.breaker === 'open';
            return (
              <button
                key={p.id}
                type="button"
                className={`pr__breaker${open ? ' pr__breaker--open' : ' pr__breaker--closed'}`}
                aria-pressed={open}
                onClick={() => toggleBreaker(p.id)}
                disabled={running}
              >
                <span className="pr__breaker-dot" aria-hidden="true" />
                <span className="pr__breaker-name">{p.name}</span>
                <span className="pr__breaker-state">{open ? 'open' : 'closed'}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="pr__counters">
        <div className="pr__counter">
          <span className="pr__counter-label">cache hits</span>
          <span className="pr__counter-val">
            {totals.hits}
            <span className="pr__counter-unit">of {outcomes.length || 0}</span>
          </span>
        </div>
        <div className="pr__counter pr__counter--saved">
          <span className="pr__counter-label">cost saved vs pinned</span>
          <span className="pr__counter-val">
            {totals.saved.toFixed(1)}
            <span className="pr__counter-unit">%</span>
          </span>
        </div>
        <div className="pr__counter">
          <span className="pr__counter-label">baseline cost units</span>
          <span className="pr__counter-val">
            {totals.baseline.toFixed(2)}
            <span className="pr__counter-unit">→ {totals.actual.toFixed(2)}</span>
          </span>
        </div>
      </div>

      <AnimatePresence>
        {phase === 'done' && (
          <motion.div
            className="pr__verdict"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            <span className="pr__verdict-x">{SAVED_PCT}% saved</span>
            <span className="pr__verdict-text">
              Across a duplicate-heavy 10k-request workload, routing plus
              semantic cache cut cost {SAVED_PCT}% against a single-provider
              pinned baseline, at a {CACHE_HIT_RATE}% overall cache hit rate and
              {' '}{DUP_HIT_RATE}% on duplicates.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Routing…' : 'Play request stream'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={running}>
          Reset
        </button>
        <span className="demo__hint">
          pinned baseline always routes to {PINNED.name} at {PINNED.cost.toFixed(2)}x
        </span>
      </div>
    </div>
  );
}
