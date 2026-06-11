import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './promptforge.css';

// Real facts from the project:
// - Each (name, version) pair runs against a 200-example test suite.
// - A new version is compared to the previous one with a two-proportion z-test,
//   blocking when p < 0.05 AND the pass-rate delta exceeds 5 percentage points.
// - Correctness is structured-output validation against a declared schema.
// - Per-call cost and latency are recorded; per-example diff surfaces which
//   examples are newly-passing versus newly-failing across versions.

const SUITE = 200;
const BLOCK_P = 0.05;
const DELTA_GATE = 5; // percentage points

type Matchup = {
  id: string;
  prev: { version: string; pass: number; cost: number; latency: number };
  next: { version: string; pass: number; cost: number; latency: number };
};

// Two candidate runs the harness can replay. Pass counts are out of 200.
const matchups: Matchup[] = [
  {
    id: 'win',
    prev: { version: 'v2', pass: 168, cost: 0.41, latency: 820 },
    next: { version: 'v3', pass: 187, cost: 0.39, latency: 760 },
  },
  {
    id: 'noise',
    prev: { version: 'v2', pass: 172, cost: 0.41, latency: 820 },
    next: { version: 'v3', pass: 176, cost: 0.44, latency: 900 },
  },
];

// Standard normal CDF via the Abramowitz-Stegun erf approximation.
function normCdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

// Two-proportion z-test on pass counts out of SUITE.
function zTest(prevPass: number, nextPass: number) {
  const p1 = prevPass / SUITE;
  const p2 = nextPass / SUITE;
  const pPool = (prevPass + nextPass) / (2 * SUITE);
  const se = Math.sqrt(pPool * (1 - pPool) * (2 / SUITE));
  const z = se === 0 ? 0 : (p2 - p1) / se;
  const pValue = 2 * (1 - normCdf(Math.abs(z)));
  return { z, pValue };
}

const ease = [0.22, 1, 0.36, 1] as const;

export default function PromptforgeDemo() {
  const reduce = useReducedMotion();
  const [activeId, setActiveId] = useState<string>('win');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState(0); // 0..SUITE examples run
  const rafRef = useRef<number | null>(null);

  const m = matchups.find((x) => x.id === activeId)!;
  const frac = progress / SUITE;

  // Pass counts climb as examples are run.
  const prevPassRun = Math.round(m.prev.pass * frac);
  const nextPassRun = Math.round(m.next.pass * frac);

  const { z, pValue } = zTest(m.prev.pass, m.next.pass);
  const deltaPts = ((m.next.pass - m.prev.pass) / SUITE) * 100;
  const significant = pValue < BLOCK_P;
  const deltaBig = Math.abs(deltaPts) > DELTA_GATE;
  const blocks = significant && deltaBig && deltaPts < 0;
  const promotes = significant && deltaBig && deltaPts > 0;

  const costDelta = m.next.cost - m.prev.cost;
  const latencyDelta = m.next.latency - m.prev.latency;

  function stopAnim() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }
  useEffect(() => stopAnim, []);

  function pick(id: string) {
    if (running) return;
    stopAnim();
    setActiveId(id);
    setDone(false);
    setProgress(0);
  }

  function run() {
    if (running) return;
    stopAnim();
    setRunning(true);
    setDone(false);
    setProgress(0);

    if (reduce) {
      setProgress(SUITE);
      setRunning(false);
      setDone(true);
      return;
    }

    let start = 0;
    const dur = 1600;
    const tick = (now: number) => {
      if (start === 0) start = now;
      const t = Math.min(1, (now - start) / dur);
      setProgress(Math.round(SUITE * easeOut(t)));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setProgress(SUITE);
        setRunning(false);
        setDone(true);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  const prevPct = done ? (m.prev.pass / SUITE) * 100 : (prevPassRun / SUITE) * 100;
  const nextPct = done ? (m.next.pass / SUITE) * 100 : (nextPassRun / SUITE) * 100;
  const shownP = done ? pValue : 1;
  const shownZ = done ? z : 0;

  // significance meter: map p in [0,0.2] to a 0..100 fill, clamped.
  const sigFill = Math.max(0, Math.min(100, (1 - shownP / 0.2) * 100));

  const verdict = !done
    ? null
    : blocks
      ? 'block'
      : promotes
        ? 'promote'
        : 'warn';

  return (
    <div className="demo" aria-label="promptforge regression harness demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Race two versions across 200 examples</h3>
      <p className="demo__lede">
        Run the suite to score a new prompt version against the previous one.
        A two-proportion z-test gates promotion: it blocks only when p is below
        0.05 and the pass-rate gap clears five points, with cost and latency
        deltas alongside.
      </p>

      <div className="pf__picker" role="tablist" aria-label="candidate runs">
        {matchups.map((mu) => (
          <button
            key={mu.id}
            role="tab"
            aria-selected={mu.id === activeId}
            className={`pf__pick${mu.id === activeId ? ' is-active' : ''}`}
            onClick={() => pick(mu.id)}
            disabled={running}
          >
            {mu.id === 'win' ? 'clear win' : 'within noise'}
          </button>
        ))}
      </div>

      <div className="pf__race">
        {[
          { who: 'prev', label: m.prev.version, pass: prevPassRun, pct: prevPct, full: m.prev.pass },
          { who: 'next', label: m.next.version, pass: nextPassRun, pct: nextPct, full: m.next.pass },
        ].map((lane) => (
          <div key={lane.who} className={`pf__lane pf__lane--${lane.who}`}>
            <div className="pf__lane-head">
              <span className="pf__lane-ver">{lane.label}</span>
              <span className="pf__lane-pass">
                {done ? lane.full : lane.pass}
                <span className="pf__lane-suite"> / {SUITE} pass</span>
              </span>
            </div>
            <div className="pf__bar">
              <motion.div
                className="pf__bar-fill"
                initial={false}
                animate={{ width: `${lane.pct}%` }}
                transition={{ duration: reduce ? 0 : 0.1, ease: 'linear' }}
              />
            </div>
            <div className="pf__lane-rate">
              {((done ? lane.full : lane.pass) / SUITE * 100).toFixed(1)}%
            </div>
          </div>
        ))}
      </div>

      <div className="pf__progress" aria-label="examples run">
        <div className="pf__progress-track">
          <motion.div
            className="pf__progress-fill"
            initial={false}
            animate={{ width: `${(progress / SUITE) * 100}%` }}
            transition={{ duration: reduce ? 0 : 0.1, ease: 'linear' }}
          />
        </div>
        <span className="pf__progress-label">
          {progress} / {SUITE} examples
        </span>
      </div>

      <div className="pf__metrics">
        <div className="pf__sig">
          <div className="pf__metric-name">z-test significance</div>
          <div className="pf__sig-meter" role="img" aria-label={`p value ${shownP.toFixed(4)}`}>
            <motion.div
              className={`pf__sig-fill${done && significant ? ' is-sig' : ''}`}
              initial={false}
              animate={{ width: `${done ? sigFill : 0}%` }}
              transition={{ duration: reduce ? 0 : 0.5, ease }}
            />
            <span className="pf__sig-threshold" style={{ left: '75%' }} aria-hidden="true" />
          </div>
          <div className="pf__sig-foot">
            <span>p = {shownP < 0.0001 && done ? '<0.0001' : shownP.toFixed(4)}</span>
            <span>z = {shownZ.toFixed(2)}</span>
            <span>{done ? (significant ? 'significant' : 'not significant') : 'idle'}</span>
          </div>
        </div>

        <div className="pf__deltas">
          <div className="pf__delta">
            <span className="pf__delta-name">pass-rate delta</span>
            <span className={`pf__delta-val${done && deltaPts >= 0 ? ' is-up' : done ? ' is-down' : ''}`}>
              {done ? `${deltaPts >= 0 ? '+' : ''}${deltaPts.toFixed(1)} pts` : '0.0 pts'}
            </span>
          </div>
          <div className="pf__delta">
            <span className="pf__delta-name">cost / call</span>
            <span className={`pf__delta-val${done && costDelta <= 0 ? ' is-up' : done ? ' is-down' : ''}`}>
              {done ? `${costDelta >= 0 ? '+' : ''}$${costDelta.toFixed(2)}` : '$0.00'}
            </span>
          </div>
          <div className="pf__delta">
            <span className="pf__delta-name">latency</span>
            <span className={`pf__delta-val${done && latencyDelta <= 0 ? ' is-up' : done ? ' is-down' : ''}`}>
              {done ? `${latencyDelta >= 0 ? '+' : ''}${latencyDelta} ms` : '0 ms'}
            </span>
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {verdict && (
          <motion.div
            key={verdict}
            className={`pf__verdict is-${verdict}`}
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease }}
          >
            <span className="pf__verdict-tag">
              {verdict === 'promote'
                ? 'Promote v3'
                : verdict === 'block'
                  ? 'Block v3'
                  : 'Warn, hold v3'}
            </span>
            <span className="pf__verdict-text">
              {verdict === 'promote'
                ? `p is below ${BLOCK_P} and the gap clears ${DELTA_GATE} points, so v3 ships.`
                : verdict === 'block'
                  ? `v3 regresses past ${DELTA_GATE} points with p below ${BLOCK_P}, so the gate blocks it.`
                  : `the gap stays inside ${DELTA_GATE} points or p is above ${BLOCK_P}, so the change is noise and v2 holds.`}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Running suite…' : 'Run suite'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => pick(activeId)}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          block when p &lt; {BLOCK_P} and delta &gt; {DELTA_GATE} pts
        </span>
      </div>
    </div>
  );
}

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
}
