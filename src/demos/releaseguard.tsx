import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './releaseguard.css';

// Real mechanism: ReleaseGuard runs the same suite across N target
// environments and emits one report that surfaces drift next to the test
// outcome. Six drift check kinds (Python version, env vars, pinned packages,
// file checksums, exec probes, planned inline markers). A green run with
// drift_detected blocks the release by default; the operator passes
// --allow-drift to ship anyway. 16 tests green.

const TEST_COUNT = 16;

type Check = { kind: string; drift?: string };

type Env = {
  id: string;
  name: string;
  base: string;
  // checks that come back clean vs the one that drifts on this env
  checks: Check[];
};

// Three target environments. Two are in spec, staging drifts on a pinned
// package even though every test passes there: the exact failure mode
// ReleaseGuard exists to catch.
const ENVS: Env[] = [
  {
    id: 'prod',
    name: 'prod',
    base: 'python 3.11',
    checks: [
      { kind: 'python version' },
      { kind: 'env vars' },
      { kind: 'pinned packages' },
      { kind: 'file checksums' },
      { kind: 'exec probes' },
    ],
  },
  {
    id: 'staging',
    name: 'staging',
    base: 'inherits prod',
    checks: [
      { kind: 'python version' },
      { kind: 'env vars' },
      { kind: 'pinned packages', drift: 'urllib3 2.0.7 vs 2.2.1' },
      { kind: 'file checksums' },
      { kind: 'exec probes' },
    ],
  },
  {
    id: 'ci',
    name: 'ci',
    base: 'python 3.11',
    checks: [
      { kind: 'python version' },
      { kind: 'env vars' },
      { kind: 'pinned packages' },
      { kind: 'file checksums' },
      { kind: 'exec probes' },
    ],
  },
];

type Phase = 'idle' | 'testing' | 'checking' | 'done';

export default function ReleaseguardDemo() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [testsRun, setTestsRun] = useState(0);
  const [checksRun, setChecksRun] = useState(0);
  const [allowDrift, setAllowDrift] = useState(false);
  const [running, setRunning] = useState(false);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function at(ms: number, fn: () => void) {
    timers.current.push(window.setTimeout(fn, reduce ? 0 : ms));
  }

  function reset() {
    clearTimers();
    setPhase('idle');
    setTestsRun(0);
    setChecksRun(0);
    setRunning(false);
  }

  function run() {
    if (running) return;
    clearTimers();
    setRunning(true);
    setPhase('testing');
    setTestsRun(0);
    setChecksRun(0);

    if (reduce) {
      setTestsRun(TEST_COUNT);
      setChecksRun(5);
      setPhase('done');
      setRunning(false);
      return;
    }

    for (let i = 1; i <= TEST_COUNT; i++) {
      at(60 + i * 70, () => setTestsRun(i));
    }
    const afterTests = 60 + TEST_COUNT * 70 + 150;
    at(afterTests, () => setPhase('checking'));
    for (let i = 1; i <= 5; i++) {
      at(afterTests + i * 240, () => setChecksRun(i));
    }
    at(afterTests + 5 * 240 + 250, () => {
      setPhase('done');
      setRunning(false);
    });
  }

  const driftDetected = ENVS.some((e) => e.checks.some((c) => c.drift));
  const allPass = phase === 'done';
  // A green run with drift blocks unless the operator allows drift.
  const ship = allPass && (!driftDetected || allowDrift);
  const blocked = allPass && driftDetected && !allowDrift;
  const ease = [0.22, 1, 0.36, 1] as const;

  function envState(e: Env): 'wait' | 'clean' | 'drift' {
    if (phase !== 'done') return 'wait';
    return e.checks.some((c) => c.drift) ? 'drift' : 'clean';
  }

  return (
    <div className="demo" aria-label="releaseguard drift gate demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Tests green, environment in spec?</h3>
      <p className="demo__lede">
        Run the same suite across three target environments. Every column goes
        green, but ReleaseGuard also runs six drift checks per environment.
        Staging passes its tests while drifting on a pinned package, so the
        gate blocks the release until you explicitly allow drift.
      </p>

      <div className="rg__stage">
        <div className="rg__cols">
          {ENVS.map((e) => {
            const st = envState(e);
            const cls =
              st === 'drift' ? ' rg__col--drift' : st === 'clean' ? ' rg__col--pass' : '';
            return (
              <div key={e.id} className={`rg__col${cls}`}>
                <div className="rg__col-head">
                  <span className="rg__col-name">{e.name}</span>
                  <span className="rg__col-base">{e.base}</span>
                </div>

                <div className="rg__tests" aria-hidden="true">
                  {Array.from({ length: TEST_COUNT }).map((_, i) => (
                    <span
                      key={i}
                      className={`rg__dot${
                        phase !== 'idle' && i < testsRun ? ' rg__dot--pass' : ''
                      }`}
                    />
                  ))}
                </div>
                <div className="rg__testline">
                  <b>{phase === 'idle' ? 0 : testsRun}</b> / {TEST_COUNT} passed
                </div>

                <div className="rg__checks">
                  {e.checks.map((c, i) => {
                    const shown = phase === 'done' || (phase === 'checking' && i < checksRun);
                    const isDrift = !!c.drift;
                    if (!shown) {
                      return (
                        <div key={c.kind} className="rg__check">
                          <span className="rg__check-mark">·</span>
                          {c.kind}
                        </div>
                      );
                    }
                    return (
                      <div
                        key={c.kind}
                        className={`rg__check${isDrift ? ' rg__check--drift' : ' rg__check--ok'}`}
                      >
                        <span className="rg__check-mark">{isDrift ? '!' : '✓'}</span>
                        {c.kind}
                        {isDrift && <span className="rg__check-detail">{c.drift}</span>}
                      </div>
                    );
                  })}
                </div>

                <span
                  className={`rg__badge ${
                    st === 'drift'
                      ? 'rg__badge--drift'
                      : st === 'clean'
                        ? 'rg__badge--clean'
                        : 'rg__badge--wait'
                  }`}
                >
                  {st === 'drift' ? 'drift detected' : st === 'clean' ? 'in spec' : 'waiting'}
                </span>
              </div>
            );
          })}
        </div>

        <div
          className={`rg__gate${ship ? ' rg__gate--ship' : ''}${blocked ? ' rg__gate--block' : ''}`}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={`${phase}-${ship}-${blocked}`}
              initial={{ opacity: 0, x: reduce ? 0 : -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease }}
              style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              <span className="rg__gate-status">
                {phase !== 'done'
                  ? 'gate pending'
                  : ship
                    ? 'release promoted'
                    : 'release blocked'}
              </span>
              <span className="rg__gate-text">
                {phase !== 'done' ? (
                  'run the suite across all targets to evaluate the gate'
                ) : blocked ? (
                  <>
                    16 tests green, but staging drifted. A green run with
                    drift_detected blocks by default. Pass{' '}
                    <code>--allow-drift</code> to ship anyway.
                  </>
                ) : driftDetected ? (
                  <>
                    drift acknowledged with <code>--allow-drift</code>; the
                    report still records the staging package drift.
                  </>
                ) : (
                  'all targets in spec and green; promoting to kubectl apply'
                )}
              </span>
            </motion.div>
          </AnimatePresence>

          <label className="rg__toggle">
            <input
              type="checkbox"
              checked={allowDrift}
              onChange={(ev) => setAllowDrift(ev.target.checked)}
            />
            <span className="rg__switch" data-on={allowDrift} aria-hidden="true" />
            --allow-drift
          </label>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Running…' : 'Run across targets'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={running}>
          Reset
        </button>
        <span className="demo__hint">3 targets · 6 drift check kinds · 16 tests</span>
      </div>
    </div>
  );
}
