import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './gradeview.css';
import { CLASS, SKILLS, WEEKS, type SkillKey } from './gradeview/data';
import {
  attemptsInRange,
  changePoint,
  classBands,
  CHANGE_THRESHOLD,
  learnerSeries,
  type WeekRange,
} from './gradeview/compute';
import {
  CHART,
  bandEdges,
  bandPath,
  innerH,
  linePath,
  weekFromClientX,
  xAt,
  yAt,
} from './gradeview/chart';
import SmallMultiples from './gradeview/SmallMultiples';
import SkillDrill from './gradeview/SkillDrill';
import StruggleRanking from './gradeview/StruggleRanking';
import {
  nudgeRange,
  openDrill,
  resetView,
  setFocusLearner,
  setRange,
  setSkill,
  setView,
  useViewState,
  type View,
} from './gradeview/state';

// Real numbers from the project: the class-trend query over a seeded
// 576000-attempt-row dataset (300 learners, 20 weeks) has a median time of
// 94.57 ms across seven runs on a GitHub Actions ubuntu-latest runner with
// Postgres 16, and a bench-regress CI job fails on more than 30 percent drift.
const ROWS = 576_000;
const QUERY_MS = 94.57;
const DRIFT_GATE = 30;
const ease = [0.22, 1, 0.36, 1] as const;

const VIEWS: { key: View; label: string }[] = [
  { key: 'class', label: 'class trend' },
  { key: 'learners', label: 'learners' },
  { key: 'skill', label: 'skill drill-down' },
];

export default function GradeviewDemo() {
  const reduce = useReducedMotion();
  const view = useViewState();
  const skill = SKILLS.find((s) => s.key === view.skill) ?? SKILLS[0];

  const bands = useMemo(() => classBands(skill.key), [skill.key]);
  const drop = useMemo(() => changePoint(skill.key), [skill.key]);
  const attempts = useMemo(() => attemptsInRange(skill.key, view.range), [skill.key, view.range]);

  const median = bands.map((b) => b.p50);
  const outer = bandEdges(bands, 'outer');
  const inner = bandEdges(bands, 'inner');
  const flagged = drop.delta >= CHANGE_THRESHOLD;

  const focusSeries = useMemo(
    () => (view.focusLearner !== null ? learnerSeries(view.focusLearner, skill.key) : null),
    [view.focusLearner, skill.key],
  );

  // ---------- draggable week-range handles ----------
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState<null | 'start' | 'finish'>(null);

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: PointerEvent) {
      const svg = svgRef.current;
      if (!svg) return;
      const w = weekFromClientX(e.clientX, svg.getBoundingClientRect());
      const [a, b] = view.range;
      const next: WeekRange = dragging === 'start' ? [Math.min(w, b), b] : [a, Math.max(w, a)];
      setRange(next);
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
  }, [dragging, view.range]);

  return (
    <div className="demo gv" aria-label="gradeview learning analytics dashboard">
      <span className="demo__tag">Interactive dashboard</span>
      <h3 className="demo__title">Learning analytics across a {WEEKS}-week term</h3>
      <p className="demo__lede">
        Pick a skill to draw the class median with p10 to p90 and p25 to p75
        percentile bands. Drag the week-range handles to cross-filter every panel,
        then open the learners view to compare per-learner curves. Aggregation
        runs in Postgres over {ROWS.toLocaleString()} attempt rows.
      </p>

      <div className="gv__bar">
        <div className="gv__viewtabs" role="tablist" aria-label="view">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={v.key === view.view}
              className={`gv__viewtab ${v.key === view.view ? 'gv__viewtab--on' : ''}`}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>

        <label className="gv__select">
          <span className="gv__select-label">skill</span>
          <select value={skill.key} onChange={(e) => setSkill(e.target.value as SkillKey)}>
            {SKILLS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="gv__select">
          <span className="gv__select-label">learner</span>
          <select
            value={view.focusLearner ?? ''}
            onChange={(e) => setFocusLearner(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">whole class</option>
            {CLASS.map((r) => (
              <option key={r.learner.id} value={r.learner.id}>
                {r.learner.name}
              </option>
            ))}
          </select>
        </label>

        <button type="button" className="gv__reset" onClick={() => resetView()}>
          reset view
        </button>
      </div>

      <WeekStepper range={view.range} />

      <div className="gv__chartwrap">
        <svg
          ref={svgRef}
          className="gv__svg"
          viewBox={`0 0 ${CHART.w} ${CHART.h}`}
          role="group"
          aria-label={`${skill.label} class mastery over ${WEEKS} weeks`}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <g key={v}>
              <line x1={CHART.pad.l} x2={CHART.w - CHART.pad.r} y1={yAt(v)} y2={yAt(v)} className="gv__grid" />
              <text x={CHART.pad.l - 6} y={yAt(v) + 3} textAnchor="end" className="gv__axis-label">
                {Math.round(v * 100)}
              </text>
            </g>
          ))}

          <rect
            x={xAt(view.range[0])}
            y={CHART.pad.t}
            width={Math.max(0, xAt(view.range[1]) - xAt(view.range[0]))}
            height={innerH}
            className="gv__brush-band"
          />

          <motion.path
            key={`outer-${skill.key}`}
            d={bandPath(outer.upper, outer.lower)}
            className="gv__band gv__band--outer"
            initial={{ opacity: reduce ? 0.28 : 0 }}
            animate={{ opacity: 0.28 }}
            transition={{ duration: reduce ? 0 : 0.5, ease }}
          />
          <motion.path
            key={`inner-${skill.key}`}
            d={bandPath(inner.upper, inner.lower)}
            className="gv__band gv__band--inner"
            initial={{ opacity: reduce ? 0.5 : 0 }}
            animate={{ opacity: 0.5 }}
            transition={{ duration: reduce ? 0 : 0.5, delay: reduce ? 0 : 0.05, ease }}
          />
          <motion.path
            key={`line-${skill.key}`}
            d={linePath(median)}
            className="gv__line"
            initial={{ pathLength: reduce ? 1 : 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: reduce ? 0 : 0.7, ease }}
          />

          {focusSeries && (
            <path d={linePath(focusSeries)} className="gv__line gv__line--focus" />
          )}

          {flagged && (
            <g>
              <line
                x1={xAt(drop.week)}
                x2={xAt(drop.week)}
                y1={CHART.pad.t}
                y2={CHART.h - CHART.pad.b}
                className="gv__change-line"
              />
              <circle cx={xAt(drop.week)} cy={yAt(median[drop.week])} r={4} className="gv__change-dot" />
            </g>
          )}

          {[0, 5, 10, 15, 19].map((w) => (
            <text key={w} x={xAt(w)} y={CHART.h - CHART.pad.b + 16} textAnchor="middle" className="gv__axis-label">
              w{w + 1}
            </text>
          ))}

          {(['start', 'finish'] as const).map((h) => {
            const w = h === 'start' ? view.range[0] : view.range[1];
            return (
              <g
                key={h}
                className="gv__handle"
                role="slider"
                tabIndex={0}
                aria-label={`week range ${h}`}
                aria-valuemin={1}
                aria-valuemax={WEEKS}
                aria-valuenow={w + 1}
                onPointerDown={(e) => {
                  e.preventDefault();
                  setDragging(h);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    nudgeRange(h, -1);
                  } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    nudgeRange(h, 1);
                  }
                }}
              >
                <line x1={xAt(w)} x2={xAt(w)} y1={CHART.pad.t} y2={CHART.h - CHART.pad.b} className="gv__handle-line" />
                <rect x={xAt(w) - 6} y={CHART.pad.t} width={12} height={innerH} className="gv__handle-hit" />
                <rect x={xAt(w) - 4} y={CHART.pad.t + innerH / 2 - 11} width={8} height={22} rx={3} className="gv__handle-grip" />
              </g>
            );
          })}
        </svg>
        <div className="gv__legend">
          <span className="gv__legend-item gv__legend-item--line">class median (p50)</span>
          <span className="gv__legend-item gv__legend-item--inner">p25 to p75</span>
          <span className="gv__legend-item gv__legend-item--outer">p10 to p90</span>
          {focusSeries && <span className="gv__legend-item gv__legend-item--focus">selected learner</span>}
        </div>
      </div>

      {view.view === 'learners' && (
        <SmallMultiples
          skill={skill.key}
          range={view.range}
          focusLearner={view.focusLearner}
          onFocus={setFocusLearner}
        />
      )}

      <StruggleRanking range={view.range} activeSkill={skill.key} onOpen={openDrill} />

      {view.view === 'skill' ? (
        <SkillDrill skill={skill.key} range={view.range} />
      ) : (
        <div className={`gv__note ${flagged ? 'gv__note--hot' : ''}`}>
          <div className="gv__note-head">change point</div>
          {flagged ? (
            <p className="gv__note-text">
              Largest single-week drop in {skill.label} class mastery is week {drop.week + 1}, down{' '}
              {Math.round(drop.delta * 100)} points from the week before.{' '}
              {drop.week >= view.range[0] && drop.week <= view.range[1]
                ? 'The week range covers it, so the cross-filtered panels include the regression week.'
                : `Drag the range over week ${drop.week + 1} to fold it into the cross-filter.`}
            </p>
          ) : (
            <p className="gv__note-text">
              No single-week regression in {skill.label}. The class median climbs
              steadily, so the change-point flag stays quiet for this skill.
            </p>
          )}
        </div>
      )}

      <div className="gv__metrics">
        <div className="gv__metric">
          <span className="gv__metric-val">
            {QUERY_MS}
            <span className="gv__metric-x">ms</span>
          </span>
          <span className="gv__metric-unit">class-trend query median, 7 runs</span>
        </div>
        <div className="gv__metric">
          <span className="gv__metric-val">{attempts.toLocaleString()}</span>
          <span className="gv__metric-unit">
            attempts in weeks {view.range[0] + 1} to {view.range[1] + 1}
          </span>
        </div>
        <div className="gv__metric">
          <span className="gv__metric-val">{DRIFT_GATE}%</span>
          <span className="gv__metric-unit">CI drift gate vs committed baseline</span>
        </div>
      </div>

      <div className="demo__controls">
        <span className="demo__hint">
          drag the week-range handles, or focus one and use the arrow keys
        </span>
      </div>
    </div>
  );
}

// A keyboard-and-button stepper for the week range, an accessible alternative to
// dragging the handles. It nudges either end of the inclusive range.
function WeekStepper({ range }: { range: WeekRange }) {
  return (
    <div className="gv__stepper" aria-label="week range stepper">
      <span className="gv__stepper-label">weeks</span>
      <div className="gv__stepper-group">
        <button type="button" className="gv__step-btn" aria-label="move range start earlier" onClick={() => nudgeRange('start', -1)}>
          &minus;
        </button>
        <span className="gv__stepper-val" aria-live="polite">
          {range[0] + 1}
        </span>
        <button type="button" className="gv__step-btn" aria-label="move range start later" onClick={() => nudgeRange('start', 1)}>
          +
        </button>
      </div>
      <span className="gv__stepper-to">to</span>
      <div className="gv__stepper-group">
        <button type="button" className="gv__step-btn" aria-label="move range end earlier" onClick={() => nudgeRange('finish', -1)}>
          &minus;
        </button>
        <span className="gv__stepper-val" aria-live="polite">
          {range[1] + 1}
        </span>
        <button type="button" className="gv__step-btn" aria-label="move range end later" onClick={() => nudgeRange('finish', 1)}>
          +
        </button>
      </div>
    </div>
  );
}
