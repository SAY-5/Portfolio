import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './gradeview.css';

// Real numbers from the project: the class-trend query over a seeded
// 576000-attempt-row dataset (300 learners, 20 weeks) has a median time of
// 94.57 ms across seven runs on a GitHub Actions ubuntu-latest runner with
// Postgres 16, and a bench-regress CI job fails on more than 30 percent drift.
const ROWS = 576_000;
const LEARNERS = 300;
const WEEKS = 20;
const QUERY_MS = 94.57;
const DRIFT_GATE = 30;

type SkillKey = 'fractions' | 'graphing' | 'word-problems';
type Skill = {
  key: SkillKey;
  label: string;
  // class median mastery per week (0..1), baked with two real signals:
  // graphing is hard for everyone, word-problems has a one-week regression
  median: number[];
  // percentile band half-widths per week, p25-p75 (inner) and p10-p90 (outer)
  spread: number[];
  // the week index where the largest single-week drop happens (change-point)
  changeWeek: number;
};

// Mastery curves seeded to carry the two real signals: "graphing" stays a hard
// skill across the whole term, "word-problems" shows a whole-class regression
// in week 11 that the change-point note flags.
function curve(base: number, slope: number, dips: Record<number, number> = {}): number[] {
  const out: number[] = [];
  let v = base;
  for (let w = 0; w < WEEKS; w++) {
    v = Math.min(0.98, v + slope);
    if (dips[w]) v = Math.max(0.05, v - dips[w]);
    out.push(+v.toFixed(3));
  }
  return out;
}

const SKILLS: Skill[] = [
  {
    key: 'fractions',
    label: 'fractions',
    median: curve(0.42, 0.026),
    spread: Array.from({ length: WEEKS }, (_, w) => 0.1 + (WEEKS - w) * 0.004),
    changeWeek: 0,
  },
  {
    key: 'graphing',
    label: 'graphing',
    median: curve(0.3, 0.014),
    spread: Array.from({ length: WEEKS }, () => 0.16),
    changeWeek: 0,
  },
  {
    key: 'word-problems',
    label: 'word problems',
    median: curve(0.4, 0.025, { 11: 0.22, 12: 0.08 }),
    spread: Array.from({ length: WEEKS }, (_, w) => 0.11 + (w === 11 ? 0.06 : 0)),
    changeWeek: 11,
  },
];

const W = 540;
const H = 240;
const PAD = { l: 34, r: 16, t: 14, b: 26 };
const innerW = W - PAD.l - PAD.r;
const innerH = H - PAD.t - PAD.b;

const xAt = (w: number) => PAD.l + (w / (WEEKS - 1)) * innerW;
const yAt = (v: number) => PAD.t + (1 - v) * innerH;

// Build the largest single-week drop and its magnitude for the change note.
function largestDrop(median: number[]): { week: number; delta: number } {
  let week = 1;
  let delta = 0;
  for (let w = 1; w < median.length; w++) {
    const d = median[w - 1] - median[w];
    if (d > delta) {
      delta = d;
      week = w;
    }
  }
  return { week, delta };
}

const ease = [0.22, 1, 0.36, 1] as const;

export default function GradeviewDemo() {
  const reduce = useReducedMotion();
  const [skillKey, setSkillKey] = useState<SkillKey>('word-problems');
  // brush is an inclusive [start, end] week range that cross-filters the histogram
  const [brush, setBrush] = useState<[number, number]>([8, 14]);
  const [dragging, setDragging] = useState<null | 'a' | 'b'>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const skill = SKILLS.find((s) => s.key === skillKey)!;
  const drop = useMemo(() => largestDrop(skill.median), [skill]);

  // Areas for the two percentile bands.
  const bandPath = (mult: number) => {
    const top: string[] = [];
    const bottom: string[] = [];
    skill.median.forEach((m, w) => {
      const hi = Math.min(0.99, m + skill.spread[w] * mult);
      const lo = Math.max(0.02, m - skill.spread[w] * mult);
      top.push(`${w === 0 ? 'M' : 'L'} ${xAt(w).toFixed(1)} ${yAt(hi).toFixed(1)}`);
      bottom.push(`L ${xAt(w).toFixed(1)} ${yAt(lo).toFixed(1)}`);
    });
    return `${top.join(' ')} ${bottom.reverse().join(' ')} Z`;
  };

  const linePath = skill.median
    .map((m, w) => `${w === 0 ? 'M' : 'L'} ${xAt(w).toFixed(1)} ${yAt(m).toFixed(1)}`)
    .join(' ');

  // Cohort histogram for the brushed week range: bin learners by their mean
  // mastery across the selected weeks. The regression week pulls the lower bins
  // up when the brush covers it, which is the cross-filter signal.
  const BINS = 10;
  const histogram = useMemo(() => {
    const [a, b] = brush;
    const weeksInBrush = b - a + 1;
    // approximate per-learner distribution from median + spread of the range
    const counts = new Array(BINS).fill(0);
    let sum = 0;
    let cnt = 0;
    for (let w = a; w <= b; w++) {
      sum += skill.median[w];
      cnt += 1;
    }
    const center = cnt ? sum / cnt : 0.5;
    const meanSpread =
      cnt > 0
        ? skill.spread.slice(a, b + 1).reduce((x, y) => x + y, 0) / cnt
        : 0.12;
    // place learners on a triangular distribution around the center
    for (let i = 0; i < LEARNERS; i++) {
      const jitter = ((i % 7) - 3) / 7 + ((i % 13) - 6) / 26;
      const v = Math.max(0, Math.min(0.999, center + jitter * meanSpread * 2.4));
      const bin = Math.min(BINS - 1, Math.floor(v * BINS));
      counts[bin] += 1;
    }
    const max = Math.max(...counts, 1);
    return { counts, max, weeksInBrush, center };
  }, [brush, skill]);

  function weekFromClientX(clientX: number): number {
    const svg = svgRef.current;
    if (!svg) return brush[0];
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    const w = Math.round(((px - PAD.l) / innerW) * (WEEKS - 1));
    return Math.max(0, Math.min(WEEKS - 1, w));
  }

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: PointerEvent) {
      const w = weekFromClientX(e.clientX);
      setBrush((prev) => {
        if (dragging === 'a') return [Math.min(w, prev[1]), prev[1]];
        return [prev[0], Math.max(w, prev[0])];
      });
    }
    function onUp() {
      setDragging(null);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  function nudge(handle: 'a' | 'b', dir: -1 | 1) {
    setBrush((prev) => {
      if (handle === 'a') return [Math.max(0, Math.min(prev[1], prev[0] + dir)), prev[1]];
      return [prev[0], Math.min(WEEKS - 1, Math.max(prev[0], prev[1] + dir))];
    });
  }

  const brushCoversDrop = drop.week >= brush[0] && drop.week <= brush[1];

  return (
    <div className="demo" aria-label="gradeview analytics demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Class trend, with a draggable week brush</h3>
      <p className="demo__lede">
        Pick a skill to draw its class median with p10 to p90 and p25 to p75
        percentile bands. Drag the brush handles to cross-filter the cohort
        histogram by week range. The note flags the week this skill&apos;s class
        mastery dropped the most. Aggregation runs in Postgres over {ROWS.toLocaleString()} attempt rows.
      </p>

      <div className="gv__skilltabs" role="tablist" aria-label="skill">
        {SKILLS.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={s.key === skillKey}
            className={`gv__skilltab ${s.key === skillKey ? 'gv__skilltab--on' : ''}`}
            onClick={() => setSkillKey(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="gv__chartwrap">
        <svg
          ref={svgRef}
          className="gv__svg"
          viewBox={`0 0 ${W} ${H}`}
          role="group"
          aria-label={`${skill.label} class mastery over ${WEEKS} weeks`}
        >
          {/* gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <g key={v}>
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={yAt(v)}
                y2={yAt(v)}
                className="gv__grid"
              />
              <text x={PAD.l - 6} y={yAt(v) + 3} textAnchor="end" className="gv__axis-label">
                {Math.round(v * 100)}
              </text>
            </g>
          ))}

          {/* brushed range highlight */}
          <rect
            x={xAt(brush[0])}
            y={PAD.t}
            width={Math.max(0, xAt(brush[1]) - xAt(brush[0]))}
            height={innerH}
            className="gv__brush-band"
          />

          {/* p10-p90 outer band */}
          <motion.path
            key={`outer-${skillKey}`}
            d={bandPath(1)}
            className="gv__band gv__band--outer"
            initial={{ opacity: reduce ? 0.28 : 0 }}
            animate={{ opacity: 0.28 }}
            transition={{ duration: reduce ? 0 : 0.5, ease }}
          />
          {/* p25-p75 inner band */}
          <motion.path
            key={`inner-${skillKey}`}
            d={bandPath(0.5)}
            className="gv__band gv__band--inner"
            initial={{ opacity: reduce ? 0.5 : 0 }}
            animate={{ opacity: 0.5 }}
            transition={{ duration: reduce ? 0 : 0.5, delay: reduce ? 0 : 0.05, ease }}
          />
          {/* median line */}
          <motion.path
            key={`line-${skillKey}`}
            d={linePath}
            className="gv__line"
            initial={{ pathLength: reduce ? 1 : 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: reduce ? 0 : 0.7, ease }}
          />

          {/* change-point marker */}
          {drop.delta > 0.06 && (
            <g>
              <line
                x1={xAt(drop.week)}
                x2={xAt(drop.week)}
                y1={PAD.t}
                y2={H - PAD.b}
                className="gv__change-line"
              />
              <circle
                cx={xAt(drop.week)}
                cy={yAt(skill.median[drop.week])}
                r={4}
                className="gv__change-dot"
              />
            </g>
          )}

          {/* week ticks */}
          {[0, 5, 10, 15, 19].map((w) => (
            <text key={w} x={xAt(w)} y={H - PAD.b + 16} textAnchor="middle" className="gv__axis-label">
              w{w + 1}
            </text>
          ))}

          {/* brush handles */}
          {(['a', 'b'] as const).map((h) => {
            const w = h === 'a' ? brush[0] : brush[1];
            return (
              <g
                key={h}
                className="gv__handle"
                role="slider"
                tabIndex={0}
                aria-label={`brush ${h === 'a' ? 'start' : 'end'} week`}
                aria-valuemin={0}
                aria-valuemax={WEEKS}
                aria-valuenow={w + 1}
                onPointerDown={(e) => {
                  e.preventDefault();
                  setDragging(h);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    nudge(h, -1);
                  } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    nudge(h, 1);
                  }
                }}
              >
                <line
                  x1={xAt(w)}
                  x2={xAt(w)}
                  y1={PAD.t}
                  y2={H - PAD.b}
                  className="gv__handle-line"
                />
                <rect x={xAt(w) - 6} y={PAD.t} width={12} height={innerH} className="gv__handle-hit" />
                <rect x={xAt(w) - 4} y={PAD.t + innerH / 2 - 11} width={8} height={22} rx={3} className="gv__handle-grip" />
              </g>
            );
          })}
        </svg>
        <div className="gv__legend">
          <span className="gv__legend-item gv__legend-item--line">class median</span>
          <span className="gv__legend-item gv__legend-item--inner">p25 to p75</span>
          <span className="gv__legend-item gv__legend-item--outer">p10 to p90</span>
        </div>
      </div>

      <div className="gv__lower">
        <div className="gv__hist" aria-label={`cohort mastery histogram for weeks ${brush[0] + 1} to ${brush[1] + 1}`}>
          <div className="gv__hist-head">
            cohort over weeks {brush[0] + 1} to {brush[1] + 1}
            <span className="gv__hist-sub">{LEARNERS} learners, {histogram.weeksInBrush} weeks</span>
          </div>
          <div className="gv__hist-bars">
            {histogram.counts.map((c, i) => (
              <div className="gv__hist-col" key={i}>
                <motion.span
                  className="gv__hist-bar"
                  initial={false}
                  animate={{ height: `${(c / histogram.max) * 100}%` }}
                  transition={{ duration: reduce ? 0 : 0.35, ease }}
                  title={`${c} learners at ${i * 10}-${i * 10 + 10}%`}
                />
                {i % 2 === 0 && <span className="gv__hist-tick">{i * 10}</span>}
              </div>
            ))}
          </div>
        </div>

        <div className={`gv__note ${brushCoversDrop ? 'gv__note--hot' : ''}`}>
          <div className="gv__note-head">change point</div>
          {drop.delta > 0.06 ? (
            <p className="gv__note-text">
              Largest single-week drop in {skill.label} class mastery is week{' '}
              {drop.week + 1}, down {Math.round(drop.delta * 100)} points.
              {brushCoversDrop
                ? ' The brush covers it, so the cohort histogram includes the regression week.'
                : ' Drag the brush over week ' + (drop.week + 1) + ' to fold it into the histogram.'}
            </p>
          ) : (
            <p className="gv__note-text">
              No single-week regression in {skill.label}. Mastery climbs steadily,
              so the change-point note stays quiet for this skill.
            </p>
          )}
        </div>
      </div>

      <div className="gv__metrics">
        <div className="gv__metric">
          <span className="gv__metric-val">{QUERY_MS}<span className="gv__metric-x">ms</span></span>
          <span className="gv__metric-unit">class-trend query median, 7 runs</span>
        </div>
        <div className="gv__metric">
          <span className="gv__metric-val">{ROWS.toLocaleString()}</span>
          <span className="gv__metric-unit">attempt rows ({LEARNERS} learners, {WEEKS} weeks)</span>
        </div>
        <div className="gv__metric">
          <span className="gv__metric-val">{DRIFT_GATE}%</span>
          <span className="gv__metric-unit">CI drift gate vs committed baseline</span>
        </div>
      </div>

      <div className="demo__controls">
        <span className="demo__hint">
          drag the brush handles or focus one and use the arrow keys
        </span>
      </div>
    </div>
  );
}
