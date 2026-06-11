import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './fleetwatch.css';

// Real mechanism: FleetWatch ingests per-frame detections and ground-truth
// labels across a fleet, and a C++20 aggregator does IoU matching, PR curves,
// and mAP per unit over a subprocess JSON protocol. Condition-sliced dashboards
// flag which units and which operating conditions (lighting, weather, distance)
// degraded most, and a drift timeline tracks the trend.
const ease = [0.22, 1, 0.36, 1] as const;

type Slice = { id: string; label: string };
const slices: Slice[] = [
  { id: 'night', label: 'night' },
  { id: 'rain', label: 'rain' },
  { id: 'far', label: 'far distance' },
];

type Unit = {
  id: string;
  base: { precision: number; recall: number; map: number };
  // Per-condition sensitivity (how much each slice drags this unit down).
  sens: Record<string, number>;
};

const units: Unit[] = [
  {
    id: 'u-01',
    base: { precision: 0.94, recall: 0.91, map: 0.89 },
    sens: { night: 0.06, rain: 0.05, far: 0.04 },
  },
  {
    id: 'u-02',
    base: { precision: 0.92, recall: 0.88, map: 0.86 },
    sens: { night: 0.21, rain: 0.09, far: 0.07 },
  },
  {
    id: 'u-03',
    base: { precision: 0.93, recall: 0.9, map: 0.88 },
    sens: { night: 0.05, rain: 0.24, far: 0.06 },
  },
  {
    id: 'u-04',
    base: { precision: 0.95, recall: 0.92, map: 0.9 },
    sens: { night: 0.07, rain: 0.06, far: 0.26 },
  },
];

const WARN_MAP = 0.7; // below this mAP a unit is flagged as degrading

function applySlices(u: Unit, active: Set<string>) {
  let drop = 0;
  active.forEach((s) => {
    drop += u.sens[s] ?? 0;
  });
  const clamp = (v: number) => Math.max(0.3, +(v - drop).toFixed(2));
  return {
    precision: clamp(u.base.precision),
    recall: clamp(u.base.recall),
    map: clamp(u.base.map),
  };
}

export default function FleetwatchDemo() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const scored = units.map((u) => ({
    unit: u,
    m: applySlices(u, active),
  }));

  const degrading = scored.filter((s) => s.m.map < WARN_MAP);
  const worst = useMemo(
    () => [...scored].sort((a, b) => a.m.map - b.m.map)[0],
    [scored],
  );

  // Drift timeline for the worst unit: mAP eroding as conditions stack up.
  const driftPoints = useMemo(() => {
    const start = worst.unit.base.map;
    const end = worst.m.map;
    const n = 8;
    return Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      // ease the decline so the curve reads like a trend, not a step
      const v = start + (end - start) * (t * t);
      return +v.toFixed(3);
    });
  }, [worst]);

  const W = 520;
  const H = 90;
  const padX = 8;
  const yFor = (v: number) => H - 12 - ((v - 0.3) / (1 - 0.3)) * (H - 24);
  const xFor = (i: number, n: number) =>
    padX + (i / (n - 1)) * (W - padX * 2);
  const path = driftPoints
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i, driftPoints.length).toFixed(1)} ${yFor(v).toFixed(1)}`)
    .join(' ');
  const warnY = yFor(WARN_MAP);

  return (
    <div className="demo" aria-label="fleetwatch detection metrics demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Fleet detection under conditions</h3>
      <p className="demo__lede">
        Each unit reports precision, recall, and mAP from the C++ aggregator.
        Toggle operating conditions to slice the fleet: the gauges recolor and
        the drift timeline shows which unit degrades most under night, rain, or
        far distance.
      </p>

      <div className="fw__stage">
        <div className="fw__slices">
          <span className="fw__slice-label">condition slice</span>
          {slices.map((s) => {
            const on = active.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                className={`fw__slice${on ? ' fw__slice--on' : ''}`}
                aria-pressed={on}
                onClick={() => toggle(s.id)}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        <div className="fw__grid">
          {scored.map(({ unit, m }) => {
            const warn = m.map < WARN_MAP;
            const rows: [string, number][] = [
              ['prec', m.precision],
              ['rec', m.recall],
              ['mAP', m.map],
            ];
            return (
              <div
                key={unit.id}
                className={`fw__unit${warn ? ' fw__unit--warn' : ''}`}
              >
                <div className="fw__unit-head">
                  <span className="fw__unit-id">{unit.id}</span>
                  {warn && <span className="fw__unit-flag">drift</span>}
                </div>
                <div className="fw__metrics">
                  {rows.map(([name, v]) => (
                    <div key={name} className="fw__metric">
                      <span className="fw__metric-name">{name}</span>
                      <div className="fw__gauge">
                        <motion.div
                          className={`fw__gauge-fill${warn ? ' fw__gauge-fill--warn' : ''}`}
                          initial={false}
                          animate={{ width: `${v * 100}%` }}
                          transition={{ duration: reduce ? 0 : 0.45, ease }}
                        />
                      </div>
                      <span className="fw__metric-val">{v.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="fw__trend">
          <div className="fw__trend-head">
            <span>mAP drift timeline</span>
            <span className="fw__trend-unit">{worst.unit.id}</span>
          </div>
          <svg
            className="fw__trend-svg"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`mAP drift for ${worst.unit.id}`}
          >
            {/* warning threshold line */}
            <line
              x1={padX}
              y1={warnY}
              x2={W - padX}
              y2={warnY}
              stroke="var(--accent-line)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <text x={W - padX} y={warnY - 4} textAnchor="end" className="fw__axis">
              warn {WARN_MAP.toFixed(2)}
            </text>
            <motion.path
              key={path}
              d={path}
              fill="none"
              stroke={worst.m.map < WARN_MAP ? 'var(--accent)' : '#4fd08a'}
              strokeWidth={2}
              initial={{ pathLength: reduce ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: reduce ? 0 : 0.7, ease }}
            />
            <circle
              cx={xFor(driftPoints.length - 1, driftPoints.length)}
              cy={yFor(driftPoints[driftPoints.length - 1])}
              r={4}
              fill={worst.m.map < WARN_MAP ? 'var(--accent)' : '#4fd08a'}
            />
            <text x={padX} y={H - 2} className="fw__axis">
              earlier
            </text>
            <text x={W - padX} y={H - 2} textAnchor="end" className="fw__axis">
              now
            </text>
          </svg>
        </div>

        <div className={`fw__alert${degrading.length === 0 ? ' fw__alert--ok' : ''}`}>
          {degrading.length === 0 ? (
            <>
              All units hold mAP above the <b>{WARN_MAP.toFixed(2)}</b> threshold.
              {active.size > 0
                ? ` Holding under ${[...active].length} active condition${active.size > 1 ? 's' : ''}.`
                : ' Select a condition to slice the fleet.'}
            </>
          ) : (
            <>
              <b>{degrading.length}</b> unit{degrading.length > 1 ? 's' : ''}{' '}
              dropped below mAP <b>{WARN_MAP.toFixed(2)}</b> under{' '}
              {[...active].map((a) => slices.find((s) => s.id === a)?.label).join(' + ')}.{' '}
              Worst is <b>{worst.unit.id}</b> at mAP {worst.m.map.toFixed(2)},
              down from {worst.unit.base.map.toFixed(2)}.
            </>
          )}
        </div>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => setActive(new Set())}
          disabled={active.size === 0}
        >
          Clear conditions
        </button>
        <span className="demo__hint">
          toggle conditions to recolor degrading units
        </span>
      </div>
    </div>
  );
}
