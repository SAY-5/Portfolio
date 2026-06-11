import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './drcautomation.css';

// Three severity classes the parser assigns to each DRC violation.
type Severity = 'critical' | 'major' | 'minor';

type Violation = {
  id: string;
  rule: string; // DRC rule name as it appears in the report
  severity: Severity;
  cell: string; // layout cell the violation sits in
  gx: number; // grid column on the die (0..9)
  gy: number; // grid row on the die (0..7)
  inBaseline: boolean; // present in the baseline run
};

// A scripted run: the parser streams these as the Tcl runner emits them.
// Some rows share a rule+cell so the grouping pass can fold them.
const RUN: Violation[] = [
  { id: 'v1', rule: 'M2.W.1', severity: 'minor', cell: 'pll_top', gx: 1, gy: 1, inBaseline: true },
  { id: 'v2', rule: 'M1.S.2', severity: 'major', cell: 'io_pad_n', gx: 7, gy: 0, inBaseline: true },
  { id: 'v3', rule: 'VIA1.EN', severity: 'critical', cell: 'core_sram', gx: 4, gy: 3, inBaseline: false },
  { id: 'v4', rule: 'M2.W.1', severity: 'minor', cell: 'pll_top', gx: 2, gy: 1, inBaseline: true },
  { id: 'v5', rule: 'POLY.SP', severity: 'major', cell: 'std_row_4', gx: 5, gy: 5, inBaseline: true },
  { id: 'v6', rule: 'VIA1.EN', severity: 'critical', cell: 'core_sram', gx: 4, gy: 4, inBaseline: false },
  { id: 'v7', rule: 'M3.D.1', severity: 'major', cell: 'clk_spine', gx: 8, gy: 6, inBaseline: false },
  { id: 'v8', rule: 'M2.W.1', severity: 'minor', cell: 'pll_top', gx: 1, gy: 2, inBaseline: true },
  { id: 'v9', rule: 'NW.SP.3', severity: 'minor', cell: 'analog_bg', gx: 0, gy: 6, inBaseline: true },
  { id: 'v10', rule: 'VIA1.EN', severity: 'critical', cell: 'core_sram', gx: 5, gy: 3, inBaseline: false },
  { id: 'v11', rule: 'M1.S.2', severity: 'major', cell: 'io_pad_e', gx: 9, gy: 4, inBaseline: false },
  { id: 'v12', rule: 'POLY.SP', severity: 'major', cell: 'std_row_4', gx: 6, gy: 5, inBaseline: true },
];

const COLS = 10;
const ROWS = 8;
const CELL = 30;
const W = COLS * CELL;
const H = ROWS * CELL;

const SEV_COLOR: Record<Severity, string> = {
  critical: 'var(--accent)',
  major: '#f3b13b',
  minor: '#5a93d6',
};
const SEV_ORDER: Severity[] = ['critical', 'major', 'minor'];
const ease = [0.22, 1, 0.36, 1] as const;

export default function DrcautomationDemo() {
  const reduce = useReducedMotion();
  const [streamed, setStreamed] = useState<number>(RUN.length);
  const [running, setRunning] = useState(false);
  const [diffOnly, setDiffOnly] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const visible = RUN.slice(0, streamed);

  // Diff against baseline: a "new" violation is one not present in the baseline run.
  const isNew = (v: Violation) => !v.inBaseline;

  // Grouping folds violations that share rule + cell into one cluster.
  const clusters = useMemo(() => {
    const shown = diffOnly ? visible.filter(isNew) : visible;
    if (!grouped) {
      return shown.map((v) => ({ key: v.id, head: v, count: 1, members: [v] }));
    }
    const map = new Map<string, { key: string; head: Violation; count: number; members: Violation[] }>();
    for (const v of shown) {
      const key = `${v.rule}|${v.cell}`;
      const found = map.get(key);
      if (found) {
        found.count += 1;
        found.members.push(v);
      } else {
        map.set(key, { key, head: v, count: 1, members: [v] });
      }
    }
    return [...map.values()];
  }, [visible, diffOnly, grouped]);

  const counts = useMemo(() => {
    const base: Record<Severity, number> = { critical: 0, major: 0, minor: 0 };
    const pool = diffOnly ? visible.filter(isNew) : visible;
    for (const v of pool) base[v.severity] += 1;
    return base;
  }, [visible, diffOnly]);

  const rawShown = diffOnly ? visible.filter(isNew).length : visible.length;
  const folded = rawShown - clusters.length;

  function runStream() {
    if (running) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    setStreamed(0);
    setRunning(true);
    if (reduce) {
      setStreamed(RUN.length);
      setRunning(false);
      return;
    }
    let i = 0;
    const step = () => {
      i += 1;
      setStreamed(i);
      if (i >= RUN.length) {
        setRunning(false);
        timer.current = null;
        return;
      }
      timer.current = window.setTimeout(step, 280);
    };
    timer.current = window.setTimeout(step, 280);
  }

  return (
    <div className="demo" aria-label="drcautomation report parser demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Parse, classify, diff a DRC run</h3>
      <p className="demo__lede">
        Stream a violation report as the Tcl runner emits it. Each finding is
        classified critical, major, or minor and dropped on the die. Toggle the
        baseline diff to dim what did not change and surface only new
        violations, then group duplicates to fold repeats of the same rule.
      </p>

      <div className="drc__stage">
        <div className="drc__die">
          <svg
            className="drc__svg"
            viewBox={`0 0 ${W} ${H}`}
            role="group"
            aria-label="die map of classified violations"
          >
            <AnimatePresence>
              {visible.map((v) => {
                const dim = diffOnly && !isNew(v);
                const cx = v.gx * CELL + CELL / 2;
                const cy = v.gy * CELL + CELL / 2;
                return (
                  <motion.g
                    key={v.id}
                    initial={{ opacity: 0, scale: reduce ? 1 : 0.2 }}
                    animate={{ opacity: dim ? 0.2 : 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduce ? 0 : 0.32, ease }}
                  >
                    <rect
                      x={v.gx * CELL + 3}
                      y={v.gy * CELL + 3}
                      width={CELL - 6}
                      height={CELL - 6}
                      rx={4}
                      fill="none"
                      stroke={SEV_COLOR[v.severity]}
                      strokeWidth={v.severity === 'critical' ? 2 : 1.4}
                    />
                    <rect
                      x={v.gx * CELL + 3}
                      y={v.gy * CELL + 3}
                      width={CELL - 6}
                      height={CELL - 6}
                      rx={4}
                      fill={SEV_COLOR[v.severity]}
                      fillOpacity={0.18}
                    />
                    {isNew(v) && !dim && (
                      <circle
                        cx={v.gx * CELL + CELL - 6}
                        cy={v.gy * CELL + 6}
                        r={3}
                        fill="var(--accent)"
                      />
                    )}
                    <text x={cx} y={cy + 11} textAnchor="middle" className="drc__marker-label">
                      {v.severity[0].toUpperCase()}
                    </text>
                  </motion.g>
                );
              })}
            </AnimatePresence>
          </svg>
        </div>

        <div className="drc__side">
          <div className="drc__counts">
            {SEV_ORDER.map((s) => (
              <div key={s} className={`drc__count drc__count--${s}`}>
                <div className="drc__count-name">
                  <span className="drc__count-dot" />
                  {s}
                </div>
                <div className="drc__count-val">{counts[s]}</div>
              </div>
            ))}
          </div>

          <div className="drc__feed">
            <div className="drc__feed-head">
              parsed findings
              {running && (
                <span className="drc__feed-live">
                  <motion.span
                    className="drc__feed-pulse"
                    animate={reduce ? {} : { opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  />
                  streaming
                </span>
              )}
            </div>
            <ul className="drc__feed-list">
              <AnimatePresence initial={false}>
                {clusters.map((c) => (
                  <motion.li
                    key={c.key}
                    className="drc__feed-line"
                    data-new={isNew(c.head)}
                    layout={!reduce}
                    initial={{ opacity: 0, x: reduce ? 0 : -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduce ? 0 : 0.26, ease }}
                  >
                    <span className={`drc__feed-sev drc__feed-sev--${c.head.severity}`} />
                    <span className="drc__feed-rule">{c.head.rule}</span>
                    <span className="drc__feed-cell">{c.head.cell}</span>
                    {c.count > 1 ? (
                      <span className="drc__feed-badge drc__feed-dup">x{c.count}</span>
                    ) : isNew(c.head) ? (
                      <span className="drc__feed-badge">new</span>
                    ) : (
                      <span className="drc__feed-cell">base</span>
                    )}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        </div>
      </div>

      <div className="drc__toggles">
        <button className="demo__btn" onClick={runStream} disabled={running}>
          {running ? 'Streaming...' : 'Replay run'}
        </button>
        <button
          type="button"
          className="drc__switch"
          data-on={diffOnly}
          aria-pressed={diffOnly}
          onClick={() => setDiffOnly((d) => !d)}
        >
          <span className="drc__switch-box">
            <span className="drc__switch-knob" />
          </span>
          Baseline diff
        </button>
        <button
          type="button"
          className="drc__switch"
          data-on={grouped}
          aria-pressed={grouped}
          onClick={() => setGrouped((g) => !g)}
        >
          <span className="drc__switch-box">
            <span className="drc__switch-knob" />
          </span>
          Group duplicates
        </button>
        <span className="demo__hint">
          {rawShown} shown
          {folded > 0 ? `, ${folded} folded` : ''}
        </span>
      </div>

      <AnimatePresence>
        {diffOnly && (
          <motion.div
            className="drc__verdict"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease }}
          >
            <span className="drc__verdict-head">
              {visible.filter(isNew).length} new since baseline
            </span>
            <span className="drc__verdict-text">
              The diff hides violations carried over from the baseline run, so a
              reviewer reads only what changed. Grouping folds repeats of the
              same rule and cell into one line to cut report noise.
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
