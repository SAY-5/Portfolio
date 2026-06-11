import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './nettestkit.css';

// Real mechanism from the project: a StreamRunner emits one SSE frame per test
// as it completes. Tests validate interface state, routing tables, VLAN config,
// and connectivity across a switch topology. Two runs can be diffed for
// regressions and the diff renders to an offline HTML report. The checks below
// mirror that: per-device interface / route / VLAN / connectivity assertions.
type CheckKind = 'interface' | 'route' | 'vlan' | 'connectivity';
type Status = 'pending' | 'pass' | 'fail';

type Check = {
  id: string;
  device: string;
  kind: CheckKind;
  detail: string;
};

type Device = { id: string; label: string; x: number; y: number };

const devices: Device[] = [
  { id: 'core', label: 'core-sw1', x: 250, y: 50 },
  { id: 'dist1', label: 'dist-sw1', x: 120, y: 150 },
  { id: 'dist2', label: 'dist-sw2', x: 380, y: 150 },
  { id: 'acc1', label: 'acc-sw1', x: 70, y: 250 },
  { id: 'acc2', label: 'acc-sw2', x: 250, y: 250 },
  { id: 'acc3', label: 'acc-sw3', x: 430, y: 250 },
];

const links: [string, string][] = [
  ['core', 'dist1'],
  ['core', 'dist2'],
  ['dist1', 'acc1'],
  ['dist1', 'acc2'],
  ['dist2', 'acc2'],
  ['dist2', 'acc3'],
];

const checks: Check[] = [
  { id: 'c1', device: 'core', kind: 'interface', detail: 'Te1/0/1 up/up' },
  { id: 'c2', device: 'core', kind: 'route', detail: '0.0.0.0/0 via 10.0.0.1' },
  { id: 'c3', device: 'dist1', kind: 'vlan', detail: 'vlan 20 active' },
  { id: 'c4', device: 'dist1', kind: 'interface', detail: 'Po1 up/up' },
  { id: 'c5', device: 'dist2', kind: 'route', detail: '10.20.0.0/16 connected' },
  { id: 'c6', device: 'dist2', kind: 'vlan', detail: 'vlan 30 active' },
  { id: 'c7', device: 'acc1', kind: 'connectivity', detail: 'ping 10.20.1.1' },
  { id: 'c8', device: 'acc2', kind: 'interface', detail: 'Gi1/0/24 up/up' },
  { id: 'c9', device: 'acc2', kind: 'connectivity', detail: 'ping 10.30.1.1' },
  { id: 'c10', device: 'acc3', kind: 'vlan', detail: 'vlan 30 access' },
];

// Run A: a clean baseline (all pass). Run B: a later run with three regressions
// so the diff overlay has real state changes to surface.
const RUN_A: Record<string, Status> = Object.fromEntries(
  checks.map((c) => [c.id, 'pass' as Status]),
);
const RUN_B: Record<string, Status> = {
  ...RUN_A,
  c4: 'fail', // dist1 Po1 went down
  c7: 'fail', // acc1 lost connectivity
  c6: 'fail', // dist2 vlan 30 dropped
};

const ease = [0.22, 1, 0.36, 1] as const;

export default function NetTestKitDemo() {
  const reduce = useReducedMotion();
  const [run, setRun] = useState<'A' | 'B'>('A');
  const [results, setResults] = useState<Record<string, Status>>({});
  const [streaming, setStreaming] = useState(false);
  const [diff, setDiff] = useState(false);
  const [cursor, setCursor] = useState(0);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const runStream = useCallback(
    (which: 'A' | 'B') => {
      clearTimers();
      setRun(which);
      setDiff(false);
      setResults({});
      setCursor(0);
      setStreaming(true);
      const tgt = which === 'A' ? RUN_A : RUN_B;

      if (reduce) {
        setResults({ ...tgt });
        setCursor(checks.length);
        setStreaming(false);
        return;
      }

      checks.forEach((c, i) => {
        const t = window.setTimeout(
          () => {
            setResults((prev) => ({ ...prev, [c.id]: tgt[c.id] }));
            setCursor(i + 1);
            if (i === checks.length - 1) setStreaming(false);
          },
          280 * (i + 1),
        );
        timers.current.push(t);
      });
    },
    [clearTimers, reduce],
  );

  const reset = useCallback(() => {
    clearTimers();
    setRun('A');
    setResults({});
    setStreaming(false);
    setDiff(false);
    setCursor(0);
  }, [clearTimers]);

  const allDone = cursor >= checks.length && !streaming;
  const canDiff = run === 'B' && allDone;

  const passCount = Object.values(results).filter((s) => s === 'pass').length;
  const failCount = Object.values(results).filter((s) => s === 'fail').length;

  // Per-device worst status, used to tint the topology nodes.
  function deviceStatus(devId: string): Status | 'none' {
    const own = checks.filter((c) => c.device === devId);
    const states = own.map((c) => results[c.id]).filter(Boolean) as Status[];
    if (states.length === 0) return 'none';
    if (states.some((s) => s === 'fail')) return 'fail';
    if (states.length < own.length) return 'pending';
    return 'pass';
  }

  function changed(id: string): boolean {
    return diff && RUN_A[id] !== RUN_B[id];
  }

  return (
    <div className="demo" aria-label="nettestkit topology stream demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Streaming checks and regression diff</h3>
      <p className="demo__lede">
        Run the suite and watch SSE frames land one per test, tinting each device
        green or red as interface, route, VLAN, and connectivity checks resolve.
        Run it twice, then overlay the diff to see which checks changed state.
      </p>

      <div className="ntk__stage">
        <div className="ntk__topo">
          <svg
            viewBox="0 0 500 300"
            className="ntk__svg"
            role="group"
            aria-label="switch topology"
          >
            {links.map(([a, b]) => {
              const da = devices.find((d) => d.id === a)!;
              const dbv = devices.find((d) => d.id === b)!;
              return (
                <line
                  key={`${a}-${b}`}
                  x1={da.x}
                  y1={da.y}
                  x2={dbv.x}
                  y2={dbv.y}
                  stroke="var(--line)"
                  strokeWidth={1.4}
                />
              );
            })}
            {devices.map((d) => {
              const st = deviceStatus(d.id);
              const fill =
                st === 'fail'
                  ? 'rgba(217,83,79,0.22)'
                  : st === 'pass'
                    ? 'rgba(95,184,120,0.18)'
                    : 'var(--ink-700)';
              const stroke =
                st === 'fail'
                  ? '#d9534f'
                  : st === 'pass'
                    ? '#5fb878'
                    : st === 'pending'
                      ? 'var(--accent-line)'
                      : 'var(--line)';
              return (
                <g key={d.id}>
                  <motion.rect
                    x={d.x - 44}
                    y={d.y - 16}
                    width={88}
                    height={32}
                    rx={8}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={1.5}
                    animate={
                      st === 'pending' && !reduce
                        ? { opacity: [0.6, 1, 0.6] }
                        : { opacity: 1 }
                    }
                    transition={
                      st === 'pending'
                        ? { duration: 1.1, repeat: Infinity }
                        : { duration: 0.3 }
                    }
                  />
                  <text x={d.x} y={d.y + 4} textAnchor="middle" className="ntk__node-label">
                    {d.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="ntk__panel">
          <div className="ntk__counters">
            <span className="ntk__counter ntk__counter--pass">{passCount} pass</span>
            <span className="ntk__counter ntk__counter--fail">{failCount} fail</span>
            <span className="ntk__counter ntk__counter--total">
              {cursor}/{checks.length} frames
            </span>
            <span className="ntk__run">run {run}</span>
          </div>

          <div className="ntk__list" aria-live="polite">
            <AnimatePresence initial={false}>
              {checks.map((c) => {
                const st = results[c.id];
                if (!st && !streaming) return null;
                const isChanged = changed(c.id);
                return (
                  <motion.div
                    key={c.id}
                    className={[
                      'ntk__check',
                      st ? `ntk__check--${st}` : 'ntk__check--wait',
                      isChanged ? 'ntk__check--changed' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    initial={{ opacity: reduce ? 1 : 0, x: reduce ? 0 : -8 }}
                    animate={{ opacity: st ? 1 : 0.4, x: 0 }}
                    transition={{ duration: reduce ? 0 : 0.25, ease }}
                  >
                    <span className="ntk__dot" aria-hidden="true" />
                    <span className="ntk__kind">{c.kind}</span>
                    <span className="ntk__detail">
                      {c.device}: {c.detail}
                    </span>
                    {isChanged && (
                      <span className="ntk__delta">
                        {RUN_A[c.id]} {'->'} {RUN_B[c.id]}
                      </span>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {diff && (
            <motion.div
              className="ntk__diff-note"
              initial={{ opacity: reduce ? 1 : 0, y: reduce ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease }}
            >
              regression diff: 3 checks changed pass {'->'} fail since run A,
              rendered to an offline HTML report
            </motion.div>
          )}
        </div>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={() => runStream(run === 'A' && allDone ? 'B' : 'A')}
          disabled={streaming}
        >
          {streaming
            ? 'Streaming...'
            : run === 'A' && allDone
              ? 'Run suite again (run B)'
              : 'Run suite (run A)'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => setDiff((v) => !v)}
          disabled={!canDiff}
          aria-pressed={diff}
        >
          {diff ? 'Hide diff overlay' : 'Show diff overlay'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={streaming}
        >
          Reset
        </button>
        <span className="demo__hint">
          13 tests across 3 files cover parsers, runner outcomes, streaming, and diff
        </span>
      </div>
    </div>
  );
}
