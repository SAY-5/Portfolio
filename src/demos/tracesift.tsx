import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './tracesift.css';

// Real numbers from the project: on a local run of 4000 runs (16000 log lines)
// the median end-to-end time was 0.085 s, about 189000 lines per second, with
// no model or network calls so the same input always produces the same report.
const LINES_PER_SEC = 189000;
const TOTAL_LINES = 16000;
const MEDIAN_MS = 85;

// Volatile token patterns that the normalizer strips before clustering:
// timestamps, hex addresses, PIDs, paths, and bare numbers all collapse to a
// canonical placeholder so the same failure reworded across runs stays one
// signature.
type Mask = { re: RegExp; to: string };
const MASKS: Mask[] = [
  { re: /\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g, to: '<ts>' },
  { re: /\b0x[0-9a-fA-F]+\b/g, to: '<addr>' },
  { re: /\bpid=\d+\b/g, to: 'pid=<n>' },
  { re: /\/[\w./-]+\.(?:c|py|log|bin)\b/g, to: '<path>' },
  { re: /\b\d+(?:\.\d+)?\b/g, to: '<n>' },
];

function normalize(line: string): string {
  let out = line;
  for (const m of MASKS) out = out.replace(m.re, m.to);
  return out.replace(/\s+/g, ' ').trim();
}

type Driver = { name: string; lift: number };
type Sample = {
  raw: string;
  // signature key after normalize; raws that share it land in one cluster
  cluster: number;
};

// Each raw line is a real-looking failure log. Lines 0..3 are the same FAULT
// reworded across firmware revisions and runs; 4..6 are a watchdog timeout;
// 7..8 are a one-off CRC mismatch. After masking, 0..3 collapse to one
// signature, 4..6 to another, 7..8 to a third.
const SAMPLES: Sample[] = [
  { raw: '2026-04-02T11:03:21Z FAULT motor stalled at 0x4a1f pid=8821 /drv/motor.c:142', cluster: 0 },
  { raw: '2026-04-02T11:07:55Z FAULT motor stalled at 0x91c0 pid=9034 /drv/motor.c:142', cluster: 0 },
  { raw: '2026-04-03T08:12:09Z FAULT motor stalled at 0x2d77 pid=7740 /drv/motor.c:142', cluster: 0 },
  { raw: '2026-04-03T09:44:50Z FAULT motor stalled at 0xbe02 pid=8120 /drv/motor.c:142', cluster: 0 },
  { raw: '2026-04-02T11:05:00Z WARN watchdog timeout after 2048 ms pid=8821', cluster: 1 },
  { raw: '2026-04-03T08:13:30Z WARN watchdog timeout after 1990 ms pid=7740', cluster: 1 },
  { raw: '2026-04-03T10:01:12Z WARN watchdog timeout after 2110 ms pid=6655', cluster: 1 },
  { raw: '2026-04-02T12:00:41Z ERR crc mismatch frame 0x10de expected 0x44 got 0x9c', cluster: 2 },
  { raw: '2026-04-04T07:22:18Z ERR crc mismatch frame 0x8a01 expected 0x44 got 0x12', cluster: 2 },
];

type Cluster = {
  id: number;
  signature: string;
  count: number;
  label: 'real' | 'flaky';
  // ranked telemetry drivers by lift against the corpus baseline
  drivers: Driver[];
  note: string;
};

// Clusters carry their real/flaky label and the ranked telemetry drivers the
// correlator surfaces. Lift is the condition rate inside the cluster over the
// corpus baseline rate; higher lift means the condition tracks the failure.
const CLUSTERS: Cluster[] = [
  {
    id: 0,
    signature: 'FAULT motor stalled at <addr> pid=<n> <path>:<n>',
    count: 4,
    label: 'real',
    drivers: [
      { name: 'temp > 78C', lift: 3.4 },
      { name: 'load > 90%', lift: 2.1 },
      { name: 'voltage < 11.4V', lift: 1.2 },
    ],
    note: 'consistent across runs and firmware, driven by temperature',
  },
  {
    id: 1,
    signature: 'WARN watchdog timeout after <n> ms pid=<n>',
    count: 3,
    label: 'flaky',
    drivers: [
      { name: 'load > 90%', lift: 2.8 },
      { name: 'voltage < 11.4V', lift: 1.5 },
      { name: 'temp > 78C', lift: 1.1 },
    ],
    note: 'intermittent, only fires under burst load',
  },
  {
    id: 2,
    signature: 'ERR crc mismatch frame <addr> expected <addr> got <addr>',
    count: 2,
    label: 'flaky',
    drivers: [
      { name: 'voltage < 11.4V', lift: 2.2 },
      { name: 'firmware 1.4.x', lift: 1.9 },
      { name: 'temp > 78C', lift: 0.9 },
    ],
    note: 'rare, tracks a voltage sag on one firmware line',
  },
];

const ease = [0.22, 1, 0.36, 1] as const;
const STAGES = ['raw', 'masked', 'clustered'] as const;
type Stage = (typeof STAGES)[number];

export default function TracesiftDemo() {
  const reduce = useReducedMotion();
  const [stage, setStage] = useState<Stage>('raw');
  const [activeCluster, setActiveCluster] = useState(0);
  const timers = useRef<number[]>([]);

  const masked = useMemo(
    () => SAMPLES.map((s) => ({ ...s, sig: normalize(s.raw) })),
    [],
  );

  function clearTimers() {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function run() {
    clearTimers();
    setStage('raw');
    if (reduce) {
      setStage('clustered');
      return;
    }
    timers.current.push(window.setTimeout(() => setStage('masked'), 650));
    timers.current.push(window.setTimeout(() => setStage('clustered'), 1500));
  }

  function reset() {
    clearTimers();
    setStage('raw');
    setActiveCluster(0);
  }

  const active = CLUSTERS[activeCluster];
  const maxLift = Math.max(...CLUSTERS.flatMap((c) => c.drivers.map((d) => d.lift)));

  return (
    <div className="demo" aria-label="tracesift clustering demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">From raw logs to labeled clusters</h3>
      <p className="demo__lede">
        Run the pipeline to watch volatile tokens get masked into canonical
        signatures, near-duplicate signatures merge into clusters, then pick a
        cluster to rank the telemetry conditions driving it. No model or network
        calls, so the same input always produces the same report.
      </p>

      <div className="ts__stage">
        <ol className="ts__steps" aria-label="pipeline stage">
          {STAGES.map((s, i) => (
            <li
              key={s}
              className={`ts__step ${STAGES.indexOf(stage) >= i ? 'ts__step--on' : ''}`}
            >
              <span className="ts__step-num">{i + 1}</span>
              {s === 'raw' ? 'raw lines' : s === 'masked' ? 'mask tokens' : 'cluster + label'}
            </li>
          ))}
        </ol>

        <div className="ts__logs" role="list" aria-label="log lines">
          {masked.map((s, i) => {
            const showMask = STAGES.indexOf(stage) >= 1;
            const showCluster = stage === 'clustered';
            const isActive = showCluster && s.cluster === activeCluster;
            return (
              <motion.div
                key={i}
                role="listitem"
                className={`ts__log ${isActive ? 'ts__log--active' : ''} ${showCluster ? `ts__log--c${s.cluster}` : ''}`}
                layout={!reduce}
                transition={{ duration: reduce ? 0 : 0.5, ease }}
              >
                {showCluster && (
                  <span className={`ts__log-tag ts__log-tag--c${s.cluster}`}>
                    c{s.cluster}
                  </span>
                )}
                <code className="ts__log-text">{showMask ? s.sig : s.raw}</code>
              </motion.div>
            );
          })}
        </div>

        <AnimatePresence>
          {stage === 'clustered' && (
            <motion.div
              className="ts__clusters"
              initial={{ opacity: 0, y: reduce ? 0 : 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.45, ease }}
            >
              <div className="ts__cluster-tabs" role="tablist" aria-label="clusters">
                {CLUSTERS.map((c) => (
                  <button
                    key={c.id}
                    role="tab"
                    aria-selected={c.id === activeCluster}
                    className={`ts__cluster-tab ${c.id === activeCluster ? 'ts__cluster-tab--on' : ''}`}
                    onClick={() => setActiveCluster(c.id)}
                  >
                    <span className={`ts__dot ts__dot--c${c.id}`} aria-hidden="true" />
                    cluster {c.id}
                    <span className="ts__cluster-count">{c.count}x</span>
                  </button>
                ))}
              </div>

              <div className="ts__panel" role="tabpanel" aria-label={`cluster ${active.id} detail`}>
                <div className="ts__panel-head">
                  <code className="ts__sig">{active.signature}</code>
                  <span
                    className={`ts__label ts__label--${active.label}`}
                    aria-label={`labeled ${active.label}`}
                  >
                    {active.label}
                  </span>
                </div>
                <div className="ts__drivers" aria-label="telemetry drivers ranked by lift">
                  {active.drivers.map((d, i) => (
                    <div className="ts__driver" key={d.name}>
                      <span className="ts__driver-name">{d.name}</span>
                      <div className="ts__driver-bar">
                        <motion.span
                          className="ts__driver-fill"
                          initial={{ width: reduce ? `${(d.lift / maxLift) * 100}%` : 0 }}
                          animate={{ width: `${(d.lift / maxLift) * 100}%` }}
                          transition={{ duration: reduce ? 0 : 0.5, delay: reduce ? 0 : i * 0.08, ease }}
                        />
                      </div>
                      <span className="ts__driver-lift">{d.lift.toFixed(1)}x lift</span>
                    </div>
                  ))}
                </div>
                <p className="ts__note">{active.note}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="ts__metrics" aria-hidden={stage !== 'clustered'}>
        <div className="ts__metric">
          <span className="ts__metric-val">{LINES_PER_SEC.toLocaleString()}</span>
          <span className="ts__metric-unit">lines / sec</span>
        </div>
        <div className="ts__metric">
          <span className="ts__metric-val">{MEDIAN_MS / 1000}s</span>
          <span className="ts__metric-unit">median for {TOTAL_LINES.toLocaleString()} lines</span>
        </div>
        <div className="ts__metric">
          <span className="ts__metric-val">{CLUSTERS.length}</span>
          <span className="ts__metric-unit">clusters from {SAMPLES.length} lines</span>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={stage === 'masked'}>
          {stage === 'raw' ? 'Run pipeline' : 'Run again'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">
          {stage === 'clustered'
            ? 'pick a cluster to see its telemetry drivers'
            : 'deterministic: same input, same report'}
        </span>
      </div>
    </div>
  );
}
