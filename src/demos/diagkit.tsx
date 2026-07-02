import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './diagkit.css';
import { buildIncident } from './diagkit/engine';
import type { Scenario } from './diagkit/types';

// Real mechanism from diagkit: the collector normalizes each raw log message
// into a template so recurring failures group into signature clusters, then
// the analyzer ranks services with an explainable score built from signature
// density, latency spike, error rate, and entry-error propagation. The whole
// incident here is a pure function of (scenario, seed): same toggle, same
// answer, every time.
const SEED = 42;
const ease = [0.22, 1, 0.36, 1] as const;

type Phase = 'idle' | 'stream' | 'cluster' | 'rank' | 'done';

const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: 'payments-outage', label: 'payments-outage' },
  { id: 'db-slowdown', label: 'db-slowdown' },
];

function pct(v: number): string {
  return Math.round(v * 100) + '%';
}

export default function DiagkitDemo() {
  const reduce = useReducedMotion();
  const [scenario, setScenario] = useState<Scenario>('payments-outage');
  const [phase, setPhase] = useState<Phase>('idle');
  const [streamed, setStreamed] = useState(0);
  const [clustered, setClustered] = useState(0);
  const [rankedShown, setRankedShown] = useState(0);
  const timers = useRef<number[]>([]);

  const incident = useMemo(() => buildIncident(scenario, SEED), [scenario]);
  const maxSig = Math.max(1, ...incident.ranked.map((r) => r.evidence.signatureLines));
  const maxSpike = Math.max(1.1, ...incident.ranked.map((r) => r.evidence.latencySpikeX));
  const top = incident.ranked[0];

  function clearAll() {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearAll, []);

  function later(fn: () => void, ms: number) {
    const id = window.setTimeout(fn, reduce ? 0 : ms);
    timers.current.push(id);
  }

  function reset() {
    clearAll();
    setPhase('idle');
    setStreamed(0);
    setClustered(0);
    setRankedShown(0);
  }

  function pick(s: Scenario) {
    if (phase !== 'idle' && phase !== 'done') return;
    setScenario(s);
    reset();
  }

  function run() {
    if (phase !== 'idle' && phase !== 'done') return;
    reset();
    setPhase('stream');
    const n = incident.sampleLines.length;
    for (let i = 1; i <= n; i++) later(() => setStreamed(i), i * 110);
    later(() => {
      setPhase('cluster');
      const c = incident.clusters.length;
      for (let i = 1; i <= c; i++) later(() => setClustered(i), i * 200);
      later(() => {
        setPhase('rank');
        const r = incident.ranked.length;
        for (let i = 1; i <= r; i++) later(() => setRankedShown(i), i * 260);
        later(() => setPhase('done'), r * 260 + 420);
      }, c * 200 + 380);
    }, n * 110 + 420);
  }

  const collapsing = phase === 'cluster' || phase === 'rank' || phase === 'done';
  const visibleLines = incident.sampleLines.slice(0, streamed);

  return (
    <div className="demo" aria-label="diagkit incident analysis demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Incident to ranked root cause</h3>
      <p className="demo__lede">
        Collect a seeded incident across four services, watch raw log lines
        collapse into normalized signature clusters, then rank the likely root
        cause with the evidence spelled out. Flip the scenario and the culprit
        changes deterministically.
      </p>

      <div className="dk__scenarios" role="group" aria-label="incident scenario">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            className={'dk__scenario' + (scenario === s.id ? ' dk__scenario--on' : '')}
            onClick={() => pick(s.id)}
            disabled={phase !== 'idle' && phase !== 'done'}
          >
            {s.label}
          </button>
        ))}
        <span className="dk__seed">seed {SEED} · gateway → orders → payments → db</span>
      </div>

      <div className="dk__stage">
        <div className="dk__panel">
          <div className="dk__panel-head">
            <span className="dk__panel-title">Log stream</span>
            <span className="dk__panel-meta">
              {phase === 'idle' ? 'waiting' : `${incident.totalLines} lines in window`}
            </span>
          </div>
          <ul className="dk__lines">
            <AnimatePresence>
              {visibleLines.map((l) => (
                <motion.li
                  key={l.id}
                  className={
                    'dk__line' +
                    (l.error ? ' dk__line--err' : '') +
                    (collapsing ? ' dk__line--claimed' : '')
                  }
                  initial={reduce ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: collapsing ? 0.45 : 1, x: 0 }}
                  transition={{ duration: 0.25, ease }}
                >
                  <span className="dk__line-svc">{l.service}</span>
                  <span className="dk__line-raw">{l.raw}</span>
                  {collapsing && (
                    <span className="dk__line-to">→ sig {l.clusterIdx + 1}</span>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
            {phase === 'idle' && (
              <li className="dk__line dk__line--empty">run collect to pull the window</li>
            )}
          </ul>
        </div>

        <div className="dk__panel">
          <div className="dk__panel-head">
            <span className="dk__panel-title">Signature clusters</span>
            <span className="dk__panel-meta">
              {clustered > 0
                ? `${incident.totalLines} lines → ${incident.clusters.length} signatures`
                : 'normalizer strips ids and latencies'}
            </span>
          </div>
          <ul className="dk__clusters">
            {incident.clusters.slice(0, clustered).map((c, i) => (
              <motion.li
                key={c.service + c.signature}
                className={'dk__cluster' + (c.error ? ' dk__cluster--err' : '')}
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease }}
              >
                <span className="dk__cluster-n">sig {i + 1}</span>
                <span className="dk__cluster-sig">{c.signature}</span>
                <span className="dk__cluster-svc">{c.service}</span>
                <span className="dk__cluster-count">×{c.count}</span>
              </motion.li>
            ))}
            {clustered === 0 && (
              <li className="dk__line dk__line--empty">
                {phase === 'stream' ? 'collecting…' : 'clusters appear after collection'}
              </li>
            )}
          </ul>
        </div>

        <div className="dk__panel">
          <div className="dk__panel-head">
            <span className="dk__panel-title">Ranked root causes</span>
            <span className="dk__panel-meta">explainable score, top = 1.000</span>
          </div>
          <ol className="dk__ranked">
            {incident.ranked.slice(0, rankedShown).map((r, i) => (
              <motion.li
                key={r.service}
                className={'dk__rank' + (i === 0 ? ' dk__rank--top' : '')}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.32, ease }}
              >
                <div className="dk__rank-head">
                  <span className="dk__rank-pos">{i + 1}.</span>
                  <span className="dk__rank-svc">{r.service}</span>
                  <span className="dk__rank-score">score={r.score.toFixed(3)}</span>
                </div>
                <div className="dk__evidence">
                  <span className="dk__ev">
                    <span className="dk__ev-label">signature density</span>
                    <span className="dk__ev-bar">
                      <span
                        className="dk__ev-fill"
                        style={{ width: pct(r.evidence.signatureLines / maxSig) }}
                      />
                    </span>
                    <span className="dk__ev-val">{r.evidence.signatureLines} lines</span>
                  </span>
                  <span className="dk__ev">
                    <span className="dk__ev-label">p95 latency spike</span>
                    <span className="dk__ev-bar">
                      <span
                        className="dk__ev-fill"
                        style={{ width: pct(Math.max(0, (r.evidence.latencySpikeX - 1) / (maxSpike - 1))) }}
                      />
                    </span>
                    <span className="dk__ev-val">{r.evidence.latencySpikeX.toFixed(1)}x</span>
                  </span>
                  <span className="dk__ev">
                    <span className="dk__ev-label">error rate</span>
                    <span className="dk__ev-bar">
                      <span
                        className="dk__ev-fill"
                        style={{ width: pct(r.evidence.errorRate) }}
                      />
                    </span>
                    <span className="dk__ev-val">{pct(r.evidence.errorRate)}</span>
                  </span>
                  <span className="dk__ev">
                    <span className="dk__ev-label">entry errors through it</span>
                    <span className="dk__ev-bar">
                      <span
                        className="dk__ev-fill"
                        style={{ width: pct(r.evidence.entryErrorShare) }}
                      />
                    </span>
                    <span className="dk__ev-val">{pct(r.evidence.entryErrorShare)}</span>
                  </span>
                </div>
              </motion.li>
            ))}
            {rankedShown === 0 && (
              <li className="dk__line dk__line--empty">ranking runs on the bundle</li>
            )}
          </ol>
        </div>

        <AnimatePresence>
          {phase === 'done' && (
            <motion.div
              className="dk__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="dk__verdict-head">Likely root cause: {top.service}</span>
              <span className="dk__verdict-text">
                {top.evidence.signatureLines} log lines in its densest error
                signature, p95 latency spike {top.evidence.latencySpikeX.toFixed(1)}x
                baseline, error rate peaked at {pct(top.evidence.errorRate)}, and{' '}
                {pct(top.evidence.entryErrorShare)} of failing entry requests
                trace through it.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={run}
          disabled={phase !== 'idle' && phase !== 'done'}
        >
          {phase === 'idle' || phase === 'done' ? 'Collect and analyze' : 'Analyzing…'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={phase === 'idle'}
        >
          Reset
        </button>
        <span className="demo__hint">
          {phase === 'done'
            ? `culprit: ${incident.culprit}, same seed same answer`
            : `${incident.sampleLines.length}-line sample of ${incident.totalLines}`}
        </span>
      </div>
    </div>
  );
}
