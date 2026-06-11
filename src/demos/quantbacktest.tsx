import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './quantbacktest.css';

// Real numbers from the project: the per-signal Python loop runs ~2,500
// iterations across roughly 10 years of yield-curve history, while the
// vectorized pandas recompute lands at ~5 ms, which cuts research iteration
// time by 60%. Signals are carry, momentum, value; the risk report computes
// annualized return, vol, Sharpe, max drawdown, and hit rate.
const LOOP_ITERS = 2500;
const VECTOR_MS = 5;
const ITER_CUT = 60; // percent

const ease = [0.22, 1, 0.36, 1] as const;

type Config = { carry: number; mom: number; value: number };

// Deterministic pseudo-random so the demo renders identically on server and
// client and never reaches for browser-only APIs during render.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A small synthetic yield-curve return stream the signals trade against.
const N_BARS = 120;
const baseReturns = (() => {
  const rng = mulberry32(7);
  const out: number[] = [];
  for (let i = 0; i < N_BARS; i++) {
    out.push((rng() - 0.46) * 0.9);
  }
  return out;
})();

// Each signal weights the next bar's return differently; blending the three
// with the config weights produces an equity curve we can score.
const carrySig = baseReturns.map((_, i) => Math.sin(i / 9) * 0.6 + 0.2);
const momSig = baseReturns.map((_, i) =>
  i === 0 ? 0 : (baseReturns[i - 1] + (baseReturns[i - 2] || 0)) * 0.4,
);
const valueSig = baseReturns.map((_, i) => Math.cos(i / 14) * 0.5);

function equityCurve(cfg: Config): number[] {
  const sum = cfg.carry + cfg.mom + cfg.value || 1;
  const wC = cfg.carry / sum;
  const wM = cfg.mom / sum;
  const wV = cfg.value / sum;
  let eq = 100;
  const curve = [eq];
  for (let i = 1; i < N_BARS; i++) {
    const pos = wC * carrySig[i - 1] + wM * momSig[i - 1] + wV * valueSig[i - 1];
    const pnl = pos * baseReturns[i];
    eq += pnl;
    curve.push(eq);
  }
  return curve;
}

function stats(curve: number[]) {
  const rets: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    rets.push((curve[i] - curve[i - 1]) / curve[i - 1]);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance =
    rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  const vol = Math.sqrt(variance);
  const sharpe = vol === 0 ? 0 : (mean / vol) * Math.sqrt(252);
  let peak = curve[0];
  let maxDd = 0;
  for (const v of curve) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  const wins = rets.filter((r) => r > 0).length;
  const hit = (wins / rets.length) * 100;
  const annRet = (curve[curve.length - 1] / curve[0] - 1) * 100;
  return { sharpe, vol: vol * Math.sqrt(252) * 100, maxDd: maxDd * 100, hit, annRet };
}

// The parameter grid the optimizer sweeps. Three weights, a few levels each,
// ranked by Sharpe just like the real grid-search optimizer.
const LEVELS = [0, 1, 2];
const grid: Config[] = [];
for (const carry of LEVELS) {
  for (const mom of LEVELS) {
    for (const value of LEVELS) {
      if (carry + mom + value === 0) continue;
      grid.push({ carry, mom, value });
    }
  }
}

function pathFor(curve: number[], w: number, h: number) {
  const min = Math.min(...curve);
  const max = Math.max(...curve);
  const span = max - min || 1;
  return curve
    .map((v, i) => {
      const x = (i / (curve.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

export default function QuantBacktestDemo() {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<'compute' | 'sweep'>('compute');

  // compute mode: loop crawl vs vectorized pass
  const [running, setRunning] = useState(false);
  const [loopBar, setLoopBar] = useState(0);
  const [vectorDone, setVectorDone] = useState(false);
  const [loopDone, setLoopDone] = useState(false);
  const rafRef = useRef<number | null>(null);

  // sweep mode: grid search ranked by Sharpe
  const [tested, setTested] = useState(0);
  const [sweeping, setSweeping] = useState(false);
  const sweepRef = useRef<number | null>(null);

  const scored = useMemo(
    () =>
      grid
        .map((cfg) => ({ cfg, curve: equityCurve(cfg), ...stats(equityCurve(cfg)) }))
        .sort((a, b) => b.sharpe - a.sharpe),
    [],
  );
  const best = scored[0];

  function stop() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (sweepRef.current !== null) cancelAnimationFrame(sweepRef.current);
    rafRef.current = null;
    sweepRef.current = null;
  }
  useEffect(() => stop, []);

  function runCompute() {
    if (running) return;
    stop();
    setRunning(true);
    setLoopBar(0);
    setVectorDone(false);
    setLoopDone(false);

    if (reduce) {
      setLoopBar(N_BARS);
      setVectorDone(true);
      setLoopDone(true);
      setRunning(false);
      return;
    }
    // The vectorized pass resolves almost instantly.
    const vectorAt = 360;
    const loopDuration = 2600;
    const start = performance.now();
    const tick = (now: number) => {
      const t = now - start;
      if (t >= vectorAt) setVectorDone(true);
      const p = Math.min(1, t / loopDuration);
      setLoopBar(Math.round(p * N_BARS));
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setLoopDone(true);
        setRunning(false);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function runSweep() {
    if (sweeping) return;
    stop();
    setSweeping(true);
    setTested(0);
    if (reduce) {
      setTested(scored.length);
      setSweeping(false);
      return;
    }
    const start = performance.now();
    const total = scored.length;
    const duration = 2200;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const n = Math.round(p * total);
      setTested(n);
      if (p < 1) {
        sweepRef.current = requestAnimationFrame(tick);
      } else {
        setTested(total);
        setSweeping(false);
        sweepRef.current = null;
      }
    };
    sweepRef.current = requestAnimationFrame(tick);
  }

  function reset() {
    stop();
    setRunning(false);
    setSweeping(false);
    setLoopBar(0);
    setVectorDone(false);
    setLoopDone(false);
    setTested(0);
  }

  const loopPct = Math.round((loopBar / N_BARS) * 100);
  // The on-screen loop iteration counter scaled to the real ~2,500 figure.
  const loopIters = Math.round((loopBar / N_BARS) * LOOP_ITERS);

  return (
    <div className="demo" aria-label="quantbacktest demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Loop versus vectorized, then sweep the grid</h3>
      <p className="demo__lede">
        A per-bar Python loop crawls across ten years of yield-curve history
        while the vectorized pandas recompute lands in one pass. Switch to the
        grid sweep to score every weight config and rank it by Sharpe.
      </p>

      <div className="qb__tabs" role="tablist" aria-label="demo mode">
        <button
          role="tab"
          aria-selected={mode === 'compute'}
          className={`qb__tab ${mode === 'compute' ? 'qb__tab--on' : ''}`}
          onClick={() => {
            setMode('compute');
            reset();
          }}
        >
          Recompute
        </button>
        <button
          role="tab"
          aria-selected={mode === 'sweep'}
          className={`qb__tab ${mode === 'sweep' ? 'qb__tab--on' : ''}`}
          onClick={() => {
            setMode('sweep');
            reset();
          }}
        >
          Grid sweep
        </button>
      </div>

      {mode === 'compute' ? (
        <div className="qb__stage">
          <div className="qb__lanes">
            <div className="qb__lane">
              <div className="qb__lane-head">
                <span className="qb__lane-name">Per-bar Python loop</span>
                <span className="qb__lane-tag">one signal at a time</span>
              </div>
              <div
                className="qb__track"
                role="img"
                aria-label={`loop progress ${loopPct} percent`}
              >
                {Array.from({ length: 40 }).map((_, i) => {
                  const filled = i / 40 < loopBar / N_BARS;
                  return (
                    <span
                      key={i}
                      className={`qb__cell ${filled ? 'qb__cell--on' : ''}`}
                    />
                  );
                })}
              </div>
              <div className="qb__lane-foot">
                <span className="qb__counter">
                  {loopIters.toLocaleString()} / {LOOP_ITERS.toLocaleString()} iters
                </span>
                <span className="qb__lane-state">
                  {loopDone ? 'done' : running ? 'crawling' : 'idle'}
                </span>
              </div>
            </div>

            <div className="qb__lane qb__lane--fast">
              <div className="qb__lane-head">
                <span className="qb__lane-name">Vectorized pandas pass</span>
                <span className="qb__lane-tag">all signals at once</span>
              </div>
              <div className="qb__vector">
                <AnimatePresence>
                  {vectorDone && (
                    <motion.div
                      className="qb__vector-fill"
                      initial={{ scaleX: reduce ? 1 : 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: reduce ? 0 : 0.32, ease }}
                    />
                  )}
                </AnimatePresence>
              </div>
              <div className="qb__lane-foot">
                <span className="qb__counter qb__counter--fast">
                  ~{VECTOR_MS} ms recompute
                </span>
                <span className="qb__lane-state qb__lane-state--fast">
                  {vectorDone ? 'done' : running ? 'running' : 'idle'}
                </span>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {loopDone && (
              <motion.div
                className="qb__verdict"
                initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease }}
              >
                <span className="qb__verdict-x">{ITER_CUT}% less</span>
                <span className="qb__verdict-text">
                  Collapsing the {LOOP_ITERS.toLocaleString()}-iteration
                  per-signal loop into a single vectorized recompute at ~
                  {VECTOR_MS} ms cuts research iteration time by {ITER_CUT}%.
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="demo__controls">
            <button className="demo__btn" onClick={runCompute} disabled={running}>
              {running ? 'Recomputing…' : 'Run recompute'}
            </button>
            <button
              className="demo__btn demo__btn--ghost"
              onClick={reset}
              disabled={running}
            >
              Reset
            </button>
            <span className="demo__hint">{N_BARS} bars, three signals</span>
          </div>
        </div>
      ) : (
        <div className="qb__stage">
          <div className="qb__sweep">
            <div className="qb__best">
              <div className="qb__best-head">
                <span className="qb__best-label">Top config by Sharpe</span>
                <span className="qb__best-sharpe">
                  {best.sharpe.toFixed(2)}
                  <span className="qb__best-unit">Sharpe</span>
                </span>
              </div>
              <svg
                className="qb__chart"
                viewBox="0 0 320 90"
                role="img"
                aria-label="best config equity curve"
              >
                <motion.path
                  key={mode}
                  d={pathFor(best.curve, 320, 90)}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  initial={{ pathLength: reduce ? 1 : 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: reduce ? 0 : 1, ease }}
                />
              </svg>
              <div className="qb__best-weights">
                <span>carry {best.cfg.carry}</span>
                <span>mom {best.cfg.mom}</span>
                <span>value {best.cfg.value}</span>
              </div>
              <div className="qb__best-stats">
                <div className="qb__bstat">
                  <span className="qb__bstat-v">{best.annRet.toFixed(1)}%</span>
                  <span className="qb__bstat-k">return</span>
                </div>
                <div className="qb__bstat">
                  <span className="qb__bstat-v">{best.vol.toFixed(1)}%</span>
                  <span className="qb__bstat-k">vol</span>
                </div>
                <div className="qb__bstat">
                  <span className="qb__bstat-v">{best.maxDd.toFixed(1)}%</span>
                  <span className="qb__bstat-k">max dd</span>
                </div>
                <div className="qb__bstat">
                  <span className="qb__bstat-v">{best.hit.toFixed(0)}%</span>
                  <span className="qb__bstat-k">hit rate</span>
                </div>
              </div>
            </div>

            <div className="qb__rank">
              <div className="qb__rank-head">
                <span>config</span>
                <span>
                  ranked {tested} / {scored.length}
                </span>
              </div>
              <ol className="qb__rank-list">
                {scored.map((row, i) => {
                  const shown = i < tested;
                  return (
                    <li
                      key={`${row.cfg.carry}-${row.cfg.mom}-${row.cfg.value}`}
                      className={`qb__rank-row ${i === 0 && shown ? 'qb__rank-row--top' : ''} ${shown ? '' : 'qb__rank-row--pending'}`}
                    >
                      <span className="qb__rank-idx">{i + 1}</span>
                      <span className="qb__rank-cfg">
                        c{row.cfg.carry} m{row.cfg.mom} v{row.cfg.value}
                      </span>
                      <span className="qb__rank-bar">
                        <span
                          className="qb__rank-bar-fill"
                          style={{
                            width: shown
                              ? `${Math.max(6, Math.min(100, ((row.sharpe - scored[scored.length - 1].sharpe) / ((best.sharpe - scored[scored.length - 1].sharpe) || 1)) * 100))}%`
                              : '0%',
                          }}
                        />
                      </span>
                      <span className="qb__rank-sharpe">
                        {shown ? row.sharpe.toFixed(2) : '-'}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>

          <div className="demo__controls">
            <button className="demo__btn" onClick={runSweep} disabled={sweeping}>
              {sweeping ? 'Sweeping…' : 'Sweep grid'}
            </button>
            <button
              className="demo__btn demo__btn--ghost"
              onClick={reset}
              disabled={sweeping}
            >
              Reset
            </button>
            <span className="demo__hint">
              {scored.length} weight configs, ranked by Sharpe
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
