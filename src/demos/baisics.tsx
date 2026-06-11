import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './baisics.css';

// baisics is an early Next.js scaffold for a health and fitness app; no product
// features are built yet. This is an honest concept piece for the direction:
// a weekly training tracker where you set a daily set target and pick which
// days you train, and the volume bars plus weekly goal rings respond live.

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// A plausible relative effort weighting per day so the bars are not flat.
const SHAPE = [1, 0.85, 1.1, 0.7, 1.15, 0.6, 0];

const WEEKLY_GOAL_SETS = 90;
const ease = [0.22, 1, 0.36, 1] as const;

export default function BaisicsDemo() {
  const reduce = useReducedMotion();
  const [setsPerDay, setSetsPerDay] = useState(18);
  const [active, setActive] = useState<boolean[]>([
    true,
    true,
    true,
    true,
    true,
    false,
    false,
  ]);

  const volumes = useMemo(
    () =>
      DAYS.map((_, i) =>
        active[i] ? Math.round(setsPerDay * SHAPE[i]) : 0,
      ),
    [setsPerDay, active],
  );
  const total = volumes.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...volumes);
  const trainingDays = active.filter(Boolean).length;

  const goalPct = Math.min(100, Math.round((total / WEEKLY_GOAL_SETS) * 100));
  const consistPct = Math.round((trainingDays / 6) * 100);
  const goalMet = goalPct >= 100;

  function toggleDay(i: number) {
    setActive((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  }

  return (
    <div className="demo" aria-label="baisics training tracker concept">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Weekly training tracker</h3>
      <p className="demo__lede">
        The repository is an early scaffold, so this is a concept for the
        direction. Set a daily target and choose your training days; the volume
        bars and weekly goal rings update as you go.
      </p>

      <div className="bx__note">
        <span>
          <b>Concept.</b> baisics currently ships the starter scaffold for a
          health and fitness app. The interaction below sketches how weekly
          tracking could feel.
        </span>
      </div>

      <div className="bx__stage">
        <div className="bx__week">
          <div className="bx__week-head">
            <span className="bx__week-title">weekly volume</span>
            <span className="bx__week-total">{total} sets</span>
          </div>
          <div className="bx__bars" role="img" aria-label={`Weekly volume, ${total} sets total`}>
            {DAYS.map((d, i) => {
              const v = volumes[i];
              const h = `${(v / max) * 100}%`;
              return (
                <div className="bx__bar-col" key={d}>
                  <div className="bx__bar-track">
                    <motion.div
                      className={`bx__bar ${v === 0 ? 'bx__bar--rest' : ''}`}
                      initial={false}
                      animate={{ height: v === 0 ? '3px' : h }}
                      transition={{ duration: reduce ? 0 : 0.4, ease }}
                    />
                  </div>
                  <span className="bx__bar-val">{v || 'rest'}</span>
                  <span className="bx__bar-day">{d}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bx__panel">
          <div className="bx__rings">
            <Ring
              pct={goalPct}
              label={`weekly goal\n${total} of ${WEEKLY_GOAL_SETS} sets`}
              green={goalMet}
              reduce={!!reduce}
            />
            <Ring
              pct={consistPct}
              label={`consistency\n${trainingDays} of 6 days`}
              green={consistPct >= 100}
              reduce={!!reduce}
            />
          </div>

          <div className="bx__control">
            <div className="bx__control-row">
              <span>sets per training day</span>
              <b>{setsPerDay}</b>
            </div>
            <input
              className="bx__slider"
              type="range"
              min={6}
              max={30}
              step={1}
              value={setsPerDay}
              onChange={(e) => setSetsPerDay(Number(e.target.value))}
              aria-label="Sets per training day"
            />
            <div className="bx__days" role="group" aria-label="training days">
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  className={`bx__day-toggle ${active[i] ? 'bx__day-toggle--on' : ''}`}
                  aria-pressed={active[i]}
                  onClick={() => toggleDay(i)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={() => {
            setSetsPerDay(18);
            setActive([true, true, true, true, true, false, false]);
          }}
        >
          Reset week
        </button>
        <span className="demo__hint">
          {trainingDays} training days, {total} sets planned
        </span>
      </div>
    </div>
  );
}

function Ring({
  pct,
  label,
  green,
  reduce,
}: {
  pct: number;
  label: string;
  green: boolean;
  reduce: boolean;
}) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  const [main, sub] = label.split('\n');
  return (
    <div className="bx__ring">
      <svg className="bx__ring-svg" viewBox="0 0 84 84" aria-hidden>
        <circle className="bx__ring-track" cx="42" cy="42" r={r} />
        <motion.circle
          className={`bx__ring-fill ${green ? 'bx__ring-fill--green' : ''}`}
          cx="42"
          cy="42"
          r={r}
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: reduce ? 0 : 0.6, ease }}
        />
        <text
          className="bx__ring-pct"
          x="42"
          y="47"
          textAnchor="middle"
        >
          {pct}%
        </text>
      </svg>
      <span className="bx__ring-label">
        {main}
        <br />
        {sub}
      </span>
    </div>
  );
}
