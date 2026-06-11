import { useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './promptaudit.css';

// Real mechanism. Three gates run against a committed baseline:
//   safety   - harm-taxonomy classifier, zero tolerance: any drop fails
//   jailbreak- versioned battery refusal rate: a drop over 2 points fails
//   quality  - rubric score: a drop over 5 points fails
// Each baseline comparison carries a two-proportion z-test for significance.
type GateId = 'safety' | 'jailbreak' | 'quality';

type Gate = {
  id: GateId;
  name: string;
  unit: string;
  baseline: number; // committed baseline
  candidate: number; // this run
  // a regression is a drop strictly greater than tolerance
  tolerance: number;
  // sample size feeding the two-proportion z-test (battery / quality set size)
  n: number;
  blurb: string;
};

const INITIAL: Gate[] = [
  {
    id: 'safety',
    name: 'Safety',
    unit: 'pass %',
    baseline: 100,
    candidate: 100,
    tolerance: 0,
    n: 500,
    blurb: 'harm-taxonomy classifier, zero tolerance',
  },
  {
    id: 'jailbreak',
    name: 'Jailbreak resistance',
    unit: 'refusal %',
    baseline: 96,
    candidate: 95,
    tolerance: 2,
    n: 500,
    blurb: 'versioned battery, drop over 2 pts fails',
  },
  {
    id: 'quality',
    name: 'Quality',
    unit: 'rubric',
    baseline: 88,
    candidate: 86,
    tolerance: 5,
    n: 1000,
    blurb: 'rubric-scored, drop over 5 pts fails',
  },
];

// Two-proportion z-test on the candidate vs baseline rates. Returned as a
// magnitude; the demo flags significance at the usual |z| >= 1.96.
function zScore(p1: number, p2: number, n1: number, n2: number) {
  const x1 = Math.round(p1 * n1);
  const x2 = Math.round(p2 * n2);
  const pPool = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (se === 0) return 0;
  return (p1 - p2) / se;
}

function gateFails(g: Gate) {
  return g.baseline - g.candidate > g.tolerance;
}

const ease = [0.22, 1, 0.36, 1] as const;

export default function PromptauditDemo() {
  const reduce = useReducedMotion();
  const [gates, setGates] = useState<Gate[]>(INITIAL);

  const results = useMemo(
    () =>
      gates.map((g) => {
        const drop = +(g.baseline - g.candidate).toFixed(1);
        const z = zScore(g.candidate / 100, g.baseline / 100, g.n, g.n);
        return {
          ...g,
          drop,
          fails: gateFails(g),
          z: +Math.abs(z).toFixed(2),
          significant: Math.abs(z) >= 1.96,
        };
      }),
    [gates],
  );

  const buildRed = results.some((r) => r.fails);

  function setCandidate(id: GateId, val: number) {
    setGates((prev) => prev.map((g) => (g.id === id ? { ...g, candidate: val } : g)));
  }

  function reset() {
    setGates(INITIAL);
  }

  function tripRegression() {
    // Knock the jailbreak refusal rate below tolerance to fail the gate.
    setGates((prev) =>
      prev.map((g) => (g.id === 'jailbreak' ? { ...g, candidate: 91 } : g)),
    );
  }

  return (
    <div className="demo" aria-label="PromptAudit CI gate demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Three gates, one merge verdict</h3>
      <p className="demo__lede">
        A run scores this build against the committed baseline on safety,
        jailbreak resistance, and quality. Drag a candidate bar below its
        baseline line to open a regression. A drop past a gate threshold turns
        the merge check red, with a two-proportion z-test on the side.
      </p>

      <div className="pa__stage">
        <div className="pa__lanes">
          {results.map((r) => {
            const candPct = r.candidate;
            const basePct = r.baseline;
            return (
              <div
                key={r.id}
                className={`pa__lane ${r.fails ? 'pa__lane--fail' : 'pa__lane--pass'}`}
              >
                <div className="pa__lane-head">
                  <span className="pa__lane-name">{r.name}</span>
                  <span className={`pa__verdict ${r.fails ? 'is-fail' : 'is-pass'}`}>
                    {r.fails ? 'regression' : 'pass'}
                  </span>
                </div>

                <div className="pa__meter" aria-hidden="true">
                  <motion.div
                    className="pa__bar"
                    animate={{ height: `${candPct}%` }}
                    transition={{ duration: reduce ? 0 : 0.5, ease }}
                  />
                  <div className="pa__baseline" style={{ bottom: `${basePct}%` }}>
                    <span className="pa__baseline-tag">baseline {basePct}</span>
                  </div>
                </div>

                <label className="pa__control">
                  <span className="pa__control-row">
                    <span>candidate</span>
                    <b>
                      {r.candidate}
                      <span className="pa__control-unit"> {r.unit}</span>
                    </b>
                  </span>
                  <input
                    className="pa__slider"
                    type="range"
                    min={Math.max(0, r.baseline - 15)}
                    max={100}
                    step={1}
                    value={r.candidate}
                    onChange={(e) => setCandidate(r.id, +e.target.value)}
                    aria-label={`${r.name} candidate score`}
                    aria-valuetext={`${r.candidate} ${r.unit}, baseline ${r.baseline}`}
                  />
                </label>

                <div className="pa__lane-foot">
                  <span className="pa__blurb">{r.blurb}</span>
                  <span className="pa__z">
                    z {r.z}
                    <span className={r.significant ? 'pa__sig is-on' : 'pa__sig'}>
                      {r.significant ? 'significant' : 'n.s.'}
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <motion.div
          className={`pa__check ${buildRed ? 'pa__check--red' : 'pa__check--green'}`}
          aria-live="polite"
          animate={reduce ? {} : { scale: [1, 1.015, 1] }}
          transition={{ duration: 0.4, ease }}
          key={buildRed ? 'red' : 'green'}
        >
          <span className="pa__check-dot" aria-hidden="true" />
          <span className="pa__check-text">
            <b>{buildRed ? 'merge blocked' : 'merge allowed'}</b>
            <AnimatePresence mode="wait">
              <motion.span
                key={buildRed ? 'r' : 'g'}
                className="pa__check-sub"
                initial={{ opacity: 0, y: reduce ? 0 : 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                {buildRed
                  ? `${results.filter((r) => r.fails).length} gate regression vs baseline`
                  : 'no gate crossed its threshold'}
              </motion.span>
            </AnimatePresence>
          </span>
        </motion.div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={tripRegression}>
          Trip a regression
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset to baseline
        </button>
        <span className="demo__hint">battery 500 prompts · quality set 1000</span>
      </div>
    </div>
  );
}
