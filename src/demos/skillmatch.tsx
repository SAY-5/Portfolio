import { useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './skillmatch.css';

// Each competency carries the role's required level and a learnability factor.
// A larger learnability means the gap is easier to close, so it weights the
// recommendation ranking: the most severe closable gap surfaces first.
type Skill = {
  id: string;
  name: string;
  required: number; // 0..100, the role bar
  learnability: number; // 0..1
  start: number; // initial proficiency
};

const SKILLS: Skill[] = [
  { id: 'py', name: 'Python', required: 80, learnability: 0.8, start: 72 },
  { id: 'ml', name: 'ML modeling', required: 75, learnability: 0.45, start: 48 },
  { id: 'api', name: 'API design', required: 70, learnability: 0.7, start: 66 },
  { id: 'data', name: 'Data pipelines', required: 65, learnability: 0.6, start: 40 },
  { id: 'react', name: 'React', required: 60, learnability: 0.85, start: 58 },
];

// A calibrated logistic turns the signed gap into a usable confidence that the
// profile is below requirement. Centered just under the bar with a moderate
// slope, matching a probability output you could threshold.
function belowConfidence(prof: number, required: number) {
  const gap = required - prof; // positive when below
  const z = (gap - 2) / 7;
  return 1 / (1 + Math.exp(-z));
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));
const ease = [0.22, 1, 0.36, 1] as const;

export default function SkillMatchDemo() {
  const reduce = useReducedMotion();
  const [levels, setLevels] = useState<Record<string, number>>(() =>
    Object.fromEntries(SKILLS.map((s) => [s.id, s.start])),
  );

  function setLevel(id: string, v: number) {
    setLevels((prev) => ({ ...prev, [id]: clamp(v) }));
  }
  function reset() {
    setLevels(Object.fromEntries(SKILLS.map((s) => [s.id, s.start])));
  }

  const recs = useMemo(() => {
    return SKILLS.map((s) => {
      const prof = levels[s.id];
      const gap = s.required - prof;
      const conf = belowConfidence(prof, s.required);
      // The classifier flags below-requirement; rank weights severity by how
      // closable the gap is (its learnability).
      const below = conf >= 0.5 && gap > 0;
      const priority = gap * s.learnability;
      return { skill: s, prof, gap, conf, below, priority };
    })
      .filter((r) => r.below)
      .sort((a, b) => b.priority - a.priority);
  }, [levels]);

  return (
    <div className="demo" aria-label="skillmatch gap inference demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Skill-gap inference, recomputed live</h3>
      <p className="demo__lede">
        Drag a proficiency below its role bar and the calibrated classifier
        flags it below requirement, the track fills red by gap size, and the
        recommendation list reorders. Each gap is ranked by severity weighted by
        a per-skill learnability factor, so the most severe closable gap ranks
        first.
      </p>

      <div className="sm__stage">
        <div className="sm__panel">
          <div className="sm__panel-head">
            <span>Current vs required</span>
            <span className="sm__panel-sub">drag to adjust</span>
          </div>
          {SKILLS.map((s) => {
            const prof = levels[s.id];
            const conf = belowConfidence(prof, s.required);
            const below = conf >= 0.5 && s.required - prof > 0;
            return (
              <div className="sm__skill" key={s.id}>
                <div className="sm__skill-top">
                  <span className="sm__skill-name">{s.name}</span>
                  <span
                    className={`sm__skill-state ${below ? 'sm__skill-state--below' : 'sm__skill-state--ok'}`}
                  >
                    {below ? `below by ${Math.round(s.required - prof)}` : 'meets bar'}
                  </span>
                </div>
                <div className="sm__track">
                  <motion.div
                    className={`sm__fill ${below ? 'sm__fill--below' : 'sm__fill--ok'}`}
                    animate={{ width: `${prof}%` }}
                    transition={{ duration: reduce ? 0 : 0.25, ease }}
                  />
                  <span
                    className="sm__bar"
                    style={{ left: `${s.required}%` }}
                    aria-hidden="true"
                  />
                </div>
                <input
                  className="sm__slider"
                  type="range"
                  min={0}
                  max={100}
                  value={prof}
                  aria-label={`${s.name} proficiency, required ${s.required}`}
                  aria-valuetext={`${Math.round(prof)} of 100, required ${s.required}`}
                  onChange={(e) => setLevel(s.id, Number(e.target.value))}
                />
                <div className="sm__meta">
                  <span>
                    current <b>{Math.round(prof)}</b> / required {s.required}
                  </span>
                  <span>p(below) {conf.toFixed(2)}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="sm__panel">
          <div className="sm__panel-head">
            <span>Development plan</span>
            <span className="sm__panel-sub">{recs.length} gaps</span>
          </div>
          <AnimatePresence mode="popLayout" initial={false}>
            {recs.length === 0 ? (
              <motion.div
                key="clear"
                className="sm__empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                Every competency meets its role bar. No gaps to close.
              </motion.div>
            ) : (
              <motion.ol className="sm__recs">
                {recs.map((r, i) => (
                  <motion.li
                    key={r.skill.id}
                    className="sm__rec"
                    layout={!reduce}
                    initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduce ? 0 : 0.25, ease }}
                  >
                    <span className="sm__rec-rank" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="sm__rec-body">
                      <span className="sm__rec-name">{r.skill.name}</span>
                      <span className="sm__rec-detail">
                        gap <b>{Math.round(r.gap)}</b> &middot; learnability{' '}
                        {r.skill.learnability.toFixed(2)} &middot; priority{' '}
                        <b>{r.priority.toFixed(1)}</b>
                      </span>
                    </span>
                    <span className="sm__rec-conf">
                      <span className="sm__rec-conf-val">
                        {Math.round(r.conf * 100)}
                      </span>
                      <span className="sm__rec-conf-label">conf</span>
                    </span>
                  </motion.li>
                ))}
              </motion.ol>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset profile
        </button>
        <span className="demo__hint">
          calibrated logistic regression, fixed random_state, joblib-persisted
        </span>
      </div>
    </div>
  );
}
