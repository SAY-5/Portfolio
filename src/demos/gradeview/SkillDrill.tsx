// Skill drill-down. Opens on a single skill and shows the cohort distribution
// over the selected week range (the cross-filter: move the range and the
// histogram redraws from the real cells in that window), the worst questions in
// the skill by failure rate, and the change-point note flagging the week the
// class median dropped most. This is the view a teacher lands on to decide
// where to reteach.

import { motion, useReducedMotion } from 'framer-motion';
import { LEARNERS, skillMeta, type SkillKey } from './data';
import {
  changePoint,
  CHANGE_THRESHOLD,
  cohortDistribution,
  worstQuestions,
  type WeekRange,
} from './compute';

type Props = {
  skill: SkillKey;
  range: WeekRange;
};

export default function SkillDrill({ skill, range }: Props) {
  const reduce = useReducedMotion();
  const meta = skillMeta(skill);
  const cohort = cohortDistribution(skill, range);
  const questions = worstQuestions(skill);
  const drop = changePoint(skill);
  const flagged = drop.delta >= CHANGE_THRESHOLD;
  const inRange = drop.week >= range[0] && drop.week <= range[1];
  const ease = [0.22, 1, 0.36, 1] as const;

  return (
    <div className="gv__drill" aria-label={`${meta.label} drill-down`}>
      <div className="gv__drill-grid">
        <section className="gv__panel" aria-label={`cohort distribution for ${meta.label}`}>
          <div className="gv__panel-head">
            cohort over weeks {range[0] + 1} to {range[1] + 1}
            <span className="gv__panel-sub">
              {LEARNERS} learners, median {Math.round(cohort.median * 100)}%
            </span>
          </div>
          <div className="gv__hist-bars">
            {cohort.counts.map((c, i) => (
              <div className="gv__hist-col" key={i}>
                <motion.span
                  className="gv__hist-bar"
                  initial={false}
                  animate={{ height: `${(c / cohort.max) * 100}%` }}
                  transition={{ duration: reduce ? 0 : 0.35, ease }}
                  title={`${c} learners at ${i * 10} to ${i * 10 + 10}%`}
                />
                {i % 2 === 0 && <span className="gv__hist-tick">{i * 10}</span>}
              </div>
            ))}
          </div>
        </section>

        <section className="gv__panel" aria-label={`worst questions in ${meta.label}`}>
          <div className="gv__panel-head">
            worst questions
            <span className="gv__panel-sub">by class failure rate</span>
          </div>
          <ul className="gv__qlist">
            {questions.map((q, idx) => (
              <li className={`gv__qrow ${idx === 0 ? 'gv__qrow--worst' : ''}`} key={q.id}>
                <span className="gv__qid">{q.id}</span>
                <span className="gv__qprompt">{q.prompt}</span>
                <span className="gv__qfail">
                  <span className="gv__qbar" style={{ width: `${Math.round(q.failRate * 100)}%` }} />
                  <span className="gv__qpct">{Math.round(q.failRate * 100)}%</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className={`gv__note ${flagged && inRange ? 'gv__note--hot' : ''}`}>
        <div className="gv__note-head">change point</div>
        {flagged ? (
          <p className="gv__note-text">
            {meta.label} class mastery fell most in week {drop.week + 1}, down{' '}
            {Math.round(drop.delta * 100)} points.{' '}
            {inRange
              ? 'The selected range covers it, so this cohort histogram includes the regression week.'
              : `Move the range over week ${drop.week + 1} to fold the regression into this cohort.`}
          </p>
        ) : (
          <p className="gv__note-text">
            {meta.label} climbs steadily with no single-week regression, so there
            is no change point to reteach around in this term.
          </p>
        )}
      </div>
    </div>
  );
}
