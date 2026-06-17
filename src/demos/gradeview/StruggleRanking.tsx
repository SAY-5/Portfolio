// Per-skill struggle ranking over the selected week range. Each row shows a
// skill's class mean mastery and a struggle bar (1 minus mean mastery), sorted
// hardest first, with a regression badge on any skill that has a flagged
// change point. Clicking a row opens that skill's drill-down.

import { struggleRanking, type WeekRange } from './compute';
import type { SkillKey } from './data';

type Props = {
  range: WeekRange;
  activeSkill: SkillKey;
  onOpen: (skill: SkillKey) => void;
};

export default function StruggleRanking({ range, activeSkill, onOpen }: Props) {
  const rows = struggleRanking(range);

  return (
    <div className="gv__rank" aria-label="per-skill struggle ranking, hardest first">
      <div className="gv__panel-head">
        struggle ranking
        <span className="gv__panel-sub">
          weeks {range[0] + 1} to {range[1] + 1}, click to drill in
        </span>
      </div>
      <ul className="gv__ranklist">
        {rows.map((r) => (
          <li key={r.skill}>
            <button
              type="button"
              className={`gv__rankrow ${r.skill === activeSkill ? 'gv__rankrow--on' : ''}`}
              aria-label={`open ${r.label} drill-down, class mean ${Math.round(r.meanMastery * 100)} percent`}
              onClick={() => onOpen(r.skill)}
            >
              <span className="gv__rank-name">
                {r.label}
                {r.regression && <span className="gv__rank-flag">regression</span>}
              </span>
              <span className="gv__rank-track">
                <span className="gv__rank-fill" style={{ width: `${Math.round(r.struggleIndex * 100)}%` }} />
              </span>
              <span className="gv__rank-val">{Math.round(r.meanMastery * 100)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
