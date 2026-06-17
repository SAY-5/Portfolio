// Small-multiples grid: one tiny sparkline per learner showing that learner's
// mastery for the selected skill across the term, with the selected week range
// shaded. Clicking a card focuses that learner, which highlights their curve.
// The cards are sorted by the learner's mean mastery in the range so the cohort
// reads top to bottom from struggling to strong.

import { motion, useReducedMotion } from 'framer-motion';
import { CLASS, LEARNERS, WEEKS, type SkillKey } from './data';
import { learnerMeanInRange, learnerSeries, type WeekRange } from './compute';

const MINI = { w: 120, h: 44, pad: 3 };

function miniX(week: number): number {
  return MINI.pad + (week / (WEEKS - 1)) * (MINI.w - MINI.pad * 2);
}

function miniY(value: number): number {
  return MINI.pad + (1 - value) * (MINI.h - MINI.pad * 2);
}

function miniPath(series: number[]): string {
  return series
    .map((v, w) => `${w === 0 ? 'M' : 'L'} ${miniX(w).toFixed(1)} ${miniY(v).toFixed(1)}`)
    .join(' ');
}

type Props = {
  skill: SkillKey;
  range: WeekRange;
  focusLearner: number | null;
  onFocus: (id: number | null) => void;
};

export default function SmallMultiples({ skill, range, focusLearner, onFocus }: Props) {
  const reduce = useReducedMotion();

  const cards = Array.from({ length: LEARNERS }, (_, id) => ({
    id,
    name: CLASS[id].learner.name,
    series: learnerSeries(id, skill),
    mean: learnerMeanInRange(id, skill, range),
  })).sort((a, b) => a.mean - b.mean);

  const [a, b] = range;
  const bandX = miniX(a);
  const bandW = Math.max(1.5, miniX(b) - miniX(a));

  return (
    <div className="gv__multiples" role="list" aria-label={`per-learner ${skill} mastery, sorted weakest first`}>
      {cards.map((card) => {
        const on = card.id === focusLearner;
        return (
          <button
            type="button"
            role="listitem"
            key={card.id}
            className={`gv__mini ${on ? 'gv__mini--on' : ''}`}
            aria-pressed={on}
            aria-label={`${card.name}, mean mastery ${Math.round(card.mean * 100)} percent in range`}
            onClick={() => onFocus(on ? null : card.id)}
          >
            <div className="gv__mini-head">
              <span className="gv__mini-name">{card.name}</span>
              <span className="gv__mini-val">{Math.round(card.mean * 100)}</span>
            </div>
            <svg className="gv__mini-svg" viewBox={`0 0 ${MINI.w} ${MINI.h}`} aria-hidden="true">
              <rect x={bandX} y={MINI.pad} width={bandW} height={MINI.h - MINI.pad * 2} className="gv__mini-band" />
              <motion.path
                d={miniPath(card.series)}
                className="gv__mini-line"
                initial={{ pathLength: reduce ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: reduce ? 0 : 0.5 }}
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
