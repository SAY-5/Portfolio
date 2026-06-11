import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './quant-explorer.css';

// Real numbers from quant-explorer artifacts/results/pareto.md, a run on a
// 4-core Apple M-series CPU over the full CIFAR-10 test set (10k images).
// Each config is plotted on size (x) vs top-1 accuracy (y); latency speedup
// drives the marker. The tolerance slider caps acceptable accuracy drop, then
// the non-dominated (Pareto) picks among the kept configs light up.
type Config = {
  id: string;
  label: string;
  sizeRatio: number; // fraction of FP32 on-disk size
  speedup: number; // p50 latency speedup at batch 1 vs FP32
  top1: number; // top-1 accuracy, percent
  accDrop: number; // percentage points vs FP32 (negative = worse)
  baseline?: boolean;
};

const FP32_TOP1 = 82.34;

const CONFIGS: Config[] = [
  {
    id: 'fp32',
    label: 'fp32 baseline',
    sizeRatio: 1.0,
    speedup: 1.0,
    top1: 82.34,
    accDrop: 0,
    baseline: true,
  },
  {
    id: 'dyn',
    label: 'dynamic int8',
    sizeRatio: 1.0,
    speedup: 2.38,
    top1: 82.3,
    accDrop: 0,
  },
  {
    id: 'ptensor',
    label: 'static int8 per-tensor',
    sizeRatio: 0.26,
    speedup: 2.51,
    top1: 82.1,
    accDrop: -0.2,
  },
  {
    id: 'pchan',
    label: 'static int8 per-channel',
    sizeRatio: 0.27,
    speedup: 2.72,
    top1: 82.0,
    accDrop: -0.3,
  },
  {
    id: 'qat',
    label: 'qat int8',
    sizeRatio: 0.26,
    speedup: 1.78,
    top1: 82.41,
    accDrop: 0.07,
  },
];

const ease = [0.22, 1, 0.36, 1] as const;

// plot geometry
const W = 540;
const H = 320;
const PAD_L = 56;
const PAD_R = 24;
const PAD_T = 22;
const PAD_B = 46;
const X_MIN = 0;
const X_MAX = 1.05; // size ratio axis
const Y_MIN = 81.8;
const Y_MAX = 82.6; // accuracy axis (zoomed to separate the cluster)

function sx(ratio: number) {
  return PAD_L + ((ratio - X_MIN) / (X_MAX - X_MIN)) * (W - PAD_L - PAD_R);
}
function sy(acc: number) {
  return H - PAD_B - ((acc - Y_MIN) / (Y_MAX - Y_MIN)) * (H - PAD_T - PAD_B);
}

// A config is dominated (within the kept set) if another kept config is at
// least as good on both axes (smaller-or-equal size, higher-or-equal accuracy)
// and strictly better on at least one. Non-dominated = on the Pareto frontier.
function paretoFront(kept: Config[]): Set<string> {
  const front = new Set<string>();
  for (const a of kept) {
    let dominated = false;
    for (const b of kept) {
      if (a.id === b.id) continue;
      const noWorse = b.sizeRatio <= a.sizeRatio && b.top1 >= a.top1;
      const strictlyBetter =
        b.sizeRatio < a.sizeRatio || b.top1 > a.top1;
      if (noWorse && strictlyBetter) {
        dominated = true;
        break;
      }
    }
    if (!dominated) front.add(a.id);
  }
  return front;
}

export default function QuantExplorerDemo() {
  const reduce = useReducedMotion();
  // tolerance is the max acceptable accuracy drop in pp; configs below it are
  // excluded. Range 0.0 (no drop allowed) to 0.5pp.
  const [tol, setTol] = useState(0.3);
  const [hover, setHover] = useState<string | null>(null);

  const kept = useMemo(
    () => CONFIGS.filter((c) => -c.accDrop <= tol + 1e-9),
    [tol],
  );
  const front = useMemo(() => paretoFront(kept), [kept]);

  const active = hover ?? [...front][0] ?? 'pchan';
  const activeCfg = CONFIGS.find((c) => c.id === active)!;

  // frontier picks among kept set
  const minSize = kept.reduce(
    (m, c) => (c.sizeRatio < m.sizeRatio ? c : m),
    kept[0],
  );
  const bestAcc = kept.reduce(
    (m, c) => (c.top1 > m.top1 ? c : m),
    kept[0],
  );
  const fastest = kept.reduce(
    (m, c) => (c.speedup > m.speedup ? c : m),
    kept[0],
  );

  // y gridlines
  const yTicks = [81.8, 82.0, 82.2, 82.4, 82.6];
  const xTicks = [0, 0.26, 0.5, 0.75, 1.0];

  return (
    <div className="demo" aria-label="quant-explorer pareto frontier demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Pick a quantization tradeoff</h3>
      <p className="demo__lede">
        Each point is one INT8 configuration from a real CIFAR-10 run, plotted
        on model size against top-1 accuracy. Set how much accuracy drop you
        will accept; configs past it drop out and the non-dominated picks among
        the rest light up.
      </p>

      <div className="qe__stage">
        <div className="qe__plotwrap">
          <svg
            className="qe__svg"
            viewBox={`0 0 ${W} ${H}`}
            role="group"
            aria-label="size versus accuracy scatter plot"
          >
            {/* gridlines */}
            {yTicks.map((t) => (
              <g key={`y${t}`}>
                <line
                  x1={PAD_L}
                  x2={W - PAD_R}
                  y1={sy(t)}
                  y2={sy(t)}
                  stroke="var(--line)"
                  strokeWidth={1}
                  strokeOpacity={0.5}
                />
                <text x={PAD_L - 8} y={sy(t) + 3} className="qe__axis-tick" textAnchor="end">
                  {t.toFixed(1)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <g key={`x${t}`}>
                <line
                  x1={sx(t)}
                  x2={sx(t)}
                  y1={PAD_T}
                  y2={H - PAD_B}
                  stroke="var(--line)"
                  strokeWidth={1}
                  strokeOpacity={0.3}
                />
                <text
                  x={sx(t)}
                  y={H - PAD_B + 16}
                  className="qe__axis-tick"
                  textAnchor="middle"
                >
                  {t.toFixed(2)}x
                </text>
              </g>
            ))}
            <text
              x={PAD_L + (W - PAD_L - PAD_R) / 2}
              y={H - 6}
              className="qe__axis-name"
              textAnchor="middle"
            >
              model size (fraction of FP32)
            </text>
            <text
              x={14}
              y={PAD_T + (H - PAD_T - PAD_B) / 2}
              className="qe__axis-name"
              textAnchor="middle"
              transform={`rotate(-90 14 ${PAD_T + (H - PAD_T - PAD_B) / 2})`}
            >
              top-1 accuracy (%)
            </text>

            {/* frontier connector across kept non-dominated points */}
            {(() => {
              const pts = kept
                .filter((c) => front.has(c.id))
                .sort((a, b) => a.sizeRatio - b.sizeRatio)
                .map((c) => `${sx(c.sizeRatio)},${sy(c.top1)}`);
              if (pts.length < 2) return null;
              return (
                <motion.polyline
                  key={`front-${pts.join('|')}`}
                  points={pts.join(' ')}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  strokeOpacity={0.6}
                  initial={{ pathLength: reduce ? 1 : 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: reduce ? 0 : 0.6, ease }}
                />
              );
            })()}

            {/* points */}
            {CONFIGS.map((c) => {
              const inSet = kept.some((k) => k.id === c.id);
              const onFront = front.has(c.id);
              const isActive = c.id === active;
              const r = 7 + (c.speedup - 1) * 4; // bigger = faster
              return (
                <g
                  key={c.id}
                  className="qe__pt"
                  role="button"
                  tabIndex={0}
                  aria-pressed={isActive}
                  aria-label={`${c.label}: size ${c.sizeRatio.toFixed(2)}x, accuracy ${c.top1.toFixed(2)} percent, ${c.speedup.toFixed(2)}x faster`}
                  onMouseEnter={() => setHover(c.id)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(c.id)}
                  onBlur={() => setHover(null)}
                >
                  <motion.circle
                    cx={sx(c.sizeRatio)}
                    cy={sy(c.top1)}
                    r={r}
                    fill={
                      onFront
                        ? 'var(--accent-glow)'
                        : inSet
                          ? 'var(--ink-700)'
                          : 'var(--ink-800)'
                    }
                    stroke={
                      onFront
                        ? 'var(--accent)'
                        : inSet
                          ? 'var(--line)'
                          : 'var(--line-soft)'
                    }
                    strokeWidth={onFront ? 2.2 : 1.2}
                    animate={{
                      opacity: inSet ? 1 : 0.28,
                      scale: isActive && !reduce ? 1.18 : 1,
                    }}
                    transition={{ duration: 0.3, ease }}
                  />
                  {c.baseline && (
                    <text
                      x={sx(c.sizeRatio)}
                      y={sy(c.top1) - r - 6}
                      textAnchor="middle"
                      className="qe__pt-tag"
                    >
                      FP32
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        <div className="qe__side">
          <div className="qe__slider-row">
            <div className="qe__slider-label">
              <span>accuracy drop tolerance</span>
              <b>{tol.toFixed(2)} pp</b>
            </div>
            <input
              className="qe__slider"
              type="range"
              min={0}
              max={0.5}
              step={0.05}
              value={tol}
              onChange={(e) => setTol(+e.target.value)}
              aria-label="accuracy drop tolerance in percentage points"
            />
            <div className="qe__slider-meta">
              {kept.length} of {CONFIGS.length} configs within tolerance,{' '}
              {front.size} on the frontier
            </div>
          </div>

          <div
            className={
              'qe__detail' +
              (front.has(activeCfg.id) ? ' qe__detail--front' : '') +
              (kept.some((k) => k.id === activeCfg.id)
                ? ''
                : ' qe__detail--out')
            }
          >
            <div className="qe__detail-name">{activeCfg.label}</div>
            <div className="qe__detail-grid">
              <div className="qe__detail-cell">
                <span className="qe__detail-k">size</span>
                <span className="qe__detail-v">
                  {activeCfg.sizeRatio.toFixed(2)}x
                </span>
              </div>
              <div className="qe__detail-cell">
                <span className="qe__detail-k">latency</span>
                <span className="qe__detail-v">
                  {activeCfg.speedup.toFixed(2)}x
                </span>
              </div>
              <div className="qe__detail-cell">
                <span className="qe__detail-k">top-1</span>
                <span className="qe__detail-v">
                  {activeCfg.top1.toFixed(2)}%
                </span>
              </div>
              <div className="qe__detail-cell">
                <span className="qe__detail-k">vs FP32</span>
                <span
                  className={
                    'qe__detail-v' +
                    (activeCfg.accDrop >= 0
                      ? ' qe__detail-v--up'
                      : ' qe__detail-v--down')
                  }
                >
                  {activeCfg.accDrop >= 0 ? '+' : ''}
                  {activeCfg.accDrop.toFixed(2)}pp
                </span>
              </div>
            </div>
            <div className="qe__detail-tag">
              {kept.some((k) => k.id === activeCfg.id)
                ? front.has(activeCfg.id)
                  ? 'on the Pareto frontier for this tolerance'
                  : 'kept but dominated by a frontier pick'
                : 'excluded: accuracy drop exceeds tolerance'}
            </div>
          </div>

          <div className="qe__picks">
            <div className="qe__pick">
              <span className="qe__pick-k">smallest</span>
              <span className="qe__pick-v">
                {minSize ? minSize.label : 'none'}
              </span>
            </div>
            <div className="qe__pick">
              <span className="qe__pick-k">best accuracy</span>
              <span className="qe__pick-v">
                {bestAcc ? bestAcc.label : 'none'}
              </span>
            </div>
            <div className="qe__pick">
              <span className="qe__pick-k">fastest</span>
              <span className="qe__pick-v">
                {fastest ? fastest.label : 'none'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => setTol(0.3)}
        >
          Reset tolerance
        </button>
        <span className="demo__hint">
          per-channel: {CONFIGS[3].speedup.toFixed(1)}x faster at{' '}
          {(CONFIGS[3].sizeRatio * 100).toFixed(0)}% size,{' '}
          {Math.abs(CONFIGS[3].accDrop).toFixed(1)}pp drop. QAT lands{' '}
          {(CONFIGS[4].top1 - FP32_TOP1).toFixed(2)}pp above FP32.
        </span>
      </div>
    </div>
  );
}
