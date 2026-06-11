import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './payscope.css';

// Real mechanism: rank-based percentiles (p10/p25/p50/p75/p90) from order
// statistics, so one extreme salary moves p90 by at most a single order
// statistic and never drags the median. Cells below a minimum sample count are
// suppressed and labeled low-sample; cells at or below a widen threshold fall
// p10/p90 back to the observed min and max. Incremental ingestion recomputes
// only the (role, market) cells the new records touch and refreshes their
// updated_at stamp while unaffected cells stay unchanged.

const ease = [0.22, 1, 0.36, 1] as const;

const MIN_SAMPLE = 5; // below this, a cell is suppressed as low-sample
const WIDEN_THRESHOLD = 8; // at or below this, p10/p90 fall back to min/max

const ROLES = ['Engineer', 'Designer', 'Analyst'] as const;
const MARKETS = ['SF', 'NYC', 'Remote'] as const;
type Role = (typeof ROLES)[number];
type Market = (typeof MARKETS)[number];

// Seeded salary samples per (role, market) cell, in thousands. Some cells are
// deliberately sparse to show suppression and tail widening.
const SEED: Record<string, number[]> = {
  'Engineer|SF': [142, 158, 165, 171, 180, 188, 195, 210, 224, 240, 268, 305],
  'Engineer|NYC': [128, 140, 150, 162, 170, 178, 190, 205, 222],
  'Engineer|Remote': [110, 125, 138, 150, 168, 182],
  'Designer|SF': [120, 132, 144, 155, 168, 180, 196, 215],
  'Designer|NYC': [112, 126, 140, 158, 175],
  'Designer|Remote': [98, 116, 134],
  'Analyst|SF': [105, 118, 128, 138, 150, 162, 176, 190, 208, 230],
  'Analyst|NYC': [98, 110, 120, 132, 145, 158, 172],
  'Analyst|Remote': [88, 102],
};

function key(role: Role, market: Market) {
  return `${role}|${market}`;
}

// Rank-based percentile via linear interpolation over order statistics.
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

type Bands = {
  n: number;
  suppressed: boolean;
  widened: boolean;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  min: number;
  max: number;
};

function bandsFor(values: number[]): Bands {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const suppressed = n < MIN_SAMPLE;
  const widened = n <= WIDEN_THRESHOLD;
  const min = n ? sorted[0] : 0;
  const max = n ? sorted[n - 1] : 0;
  return {
    n,
    suppressed,
    widened,
    // At or below the widen threshold, p10/p90 fall back to the min/max
    // envelope instead of the interpolated order statistic.
    p10: widened ? min : percentile(sorted, 10),
    p25: percentile(sorted, 25),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: widened ? max : percentile(sorted, 90),
    min,
    max,
  };
}

export default function PayscopeDemo() {
  const reduce = useReducedMotion();
  const [data, setData] = useState<Record<string, number[]>>(() => ({ ...SEED }));
  const [selected, setSelected] = useState<string>('Engineer|SF');
  // Cells touched by the most recent incremental ingest, for the highlight.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  // A monotonic ingest counter standing in for per-cell updated_at stamps.
  const [stamp, setStamp] = useState<Record<string, number>>({});
  const [newSalary, setNewSalary] = useState(195);
  const [targetRole, setTargetRole] = useState<Role>('Engineer');
  const [targetMarket, setTargetMarket] = useState<Market>('SF');
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (touchTimer.current) clearTimeout(touchTimer.current);
    };
  }, []);

  const cells = useMemo(() => {
    const out: Record<string, Bands> = {};
    for (const role of ROLES) {
      for (const market of MARKETS) {
        const k = key(role, market);
        out[k] = bandsFor(data[k] ?? []);
      }
    }
    return out;
  }, [data]);

  const sel = cells[selected];
  const [selRole, selMarket] = selected.split('|') as [Role, Market];

  function ingest() {
    const k = key(targetRole, targetMarket);
    setData((prev) => ({ ...prev, [k]: [...(prev[k] ?? []), newSalary] }));
    setStamp((prev) => ({ ...prev, [k]: (prev[k] ?? 0) + 1 }));
    setTouched(new Set([k]));
    setSelected(k);
    if (touchTimer.current) clearTimeout(touchTimer.current);
    touchTimer.current = setTimeout(() => setTouched(new Set()), reduce ? 0 : 1600);
  }

  function resetData() {
    setData({ ...SEED });
    setStamp({});
    setTouched(new Set());
  }

  return (
    <div className="demo" aria-label="PayScope percentile benchmark demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Percentile bands, recomputed per cell</h3>
      <p className="demo__lede">
        Each cell is a role and market with rank-based pay percentiles. Pick a
        cell to see its p10 to p90 band. Drop a new salary into the pipeline:
        only the cell it touches recomputes and restamps, the rest stay put.
        Low-sample cells are suppressed, and thin cells widen p10/p90 to the
        observed min and max.
      </p>

      <div className="ps__layout">
        <div className="ps__matrix" role="group" aria-label="role and market cells">
          <div className="ps__matrix-corner" aria-hidden="true" />
          {MARKETS.map((m) => (
            <div key={m} className="ps__matrix-colhead">
              {m}
            </div>
          ))}
          {ROLES.map((role) => (
            <FragmentRow
              key={role}
              role={role}
              cells={cells}
              selected={selected}
              touched={touched}
              onSelect={setSelected}
            />
          ))}
        </div>

        <div className="ps__chart-wrap">
          <div className="ps__chart-head">
            <div>
              <div className="ps__chart-title">
                {selRole} <span className="ps__sep">/</span> {selMarket}
              </div>
              <div className="ps__chart-sub">
                {sel.n} sample{sel.n === 1 ? '' : 's'}
                {stamp[selected] ? ` · updated_at +${stamp[selected]}` : ''}
              </div>
            </div>
            <div className="ps__badges">
              {sel.suppressed && <span className="ps__badge ps__badge--sup">low-sample</span>}
              {!sel.suppressed && sel.widened && (
                <span className="ps__badge ps__badge--widen">tail widened</span>
              )}
              {!sel.suppressed && !sel.widened && (
                <span className="ps__badge ps__badge--ok">full bands</span>
              )}
            </div>
          </div>
          <BandChart bands={sel} suppressed={sel.suppressed} reduce={!!reduce} />
        </div>
      </div>

      <div className="ps__pipeline">
        <div className="ps__pipe-head">incremental ingest</div>
        <div className="ps__pipe-row">
          <label className="ps__field">
            <span className="ps__field-label">role</span>
            <select
              className="ps__select"
              value={targetRole}
              onChange={(e) => setTargetRole(e.target.value as Role)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="ps__field">
            <span className="ps__field-label">market</span>
            <select
              className="ps__select"
              value={targetMarket}
              onChange={(e) => setTargetMarket(e.target.value as Market)}
            >
              {MARKETS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="ps__field ps__field--grow">
            <span className="ps__field-label">
              new salary <b>${newSalary}k</b>
            </span>
            <input
              className="ps__slider"
              type="range"
              min={70}
              max={400}
              step={5}
              value={newSalary}
              onChange={(e) => setNewSalary(Number(e.target.value))}
              aria-label="new salary in thousands"
            />
          </label>
        </div>
        <div className="demo__controls">
          <button className="demo__btn" onClick={ingest}>
            Ingest record
          </button>
          <button className="demo__btn demo__btn--ghost" onClick={resetData}>
            Reset data
          </button>
          <span className="demo__hint">
            one extreme salary moves p90 by at most one order statistic
          </span>
        </div>
      </div>
    </div>
  );
}

function FragmentRow(props: {
  role: Role;
  cells: Record<string, Bands>;
  selected: string;
  touched: Set<string>;
  onSelect: (k: string) => void;
}) {
  const { role, cells, selected, touched, onSelect } = props;
  return (
    <>
      <div className="ps__matrix-rowhead">{role}</div>
      {MARKETS.map((m) => {
        const k = key(role, m);
        const b = cells[k];
        const isSel = selected === k;
        const isTouched = touched.has(k);
        return (
          <button
            key={k}
            className={`ps__cell ${isSel ? 'ps__cell--sel' : ''} ${
              b.suppressed ? 'ps__cell--sup' : ''
            } ${isTouched ? 'ps__cell--touched' : ''}`}
            onClick={() => onSelect(k)}
            aria-pressed={isSel}
            aria-label={`${role} ${m}, ${b.n} samples${
              b.suppressed ? ', low-sample' : ''
            }`}
          >
            <span className="ps__cell-median">
              {b.suppressed ? '-' : `$${Math.round(b.p50)}k`}
            </span>
            <span className="ps__cell-n">n={b.n}</span>
          </button>
        );
      })}
    </>
  );
}

function BandChart({
  bands,
  suppressed,
  reduce,
}: {
  bands: Bands;
  suppressed: boolean;
  reduce: boolean;
}) {
  // Fixed salary axis so bands across cells are visually comparable.
  const AXIS_MIN = 70;
  const AXIS_MAX = 340;
  const W = 100; // percent-based positions
  const pos = (v: number) =>
    Math.max(0, Math.min(W, ((v - AXIS_MIN) / (AXIS_MAX - AXIS_MIN)) * W));

  const x10 = pos(bands.p10);
  const x25 = pos(bands.p25);
  const x50 = pos(bands.p50);
  const x75 = pos(bands.p75);
  const x90 = pos(bands.p90);

  const ticks = [100, 150, 200, 250, 300];

  return (
    <div className={`ps__chart ${suppressed ? 'ps__chart--sup' : ''}`}>
      <div className="ps__track" aria-hidden="true">
        {ticks.map((t) => (
          <div key={t} className="ps__tick" style={{ left: `${pos(t)}%` }}>
            <span className="ps__tick-label">{t}</span>
          </div>
        ))}

        {/* whisker p10 to p90 */}
        <motion.div
          className="ps__whisker"
          animate={{ left: `${x10}%`, width: `${x90 - x10}%` }}
          transition={{ duration: reduce ? 0 : 0.5, ease }}
        />
        {/* inter-quartile box p25 to p75 */}
        <motion.div
          className="ps__box"
          animate={{ left: `${x25}%`, width: `${x75 - x25}%` }}
          transition={{ duration: reduce ? 0 : 0.5, ease }}
        />
        {/* median marker */}
        <motion.div
          className="ps__median"
          animate={{ left: `${x50}%` }}
          transition={{ duration: reduce ? 0 : 0.5, ease }}
        />
      </div>

      <AnimatePresence mode="wait">
        {suppressed ? (
          <motion.div
            key="sup"
            className="ps__sup-note"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            Suppressed below the {MIN_SAMPLE}-sample minimum. Add records to
            publish bands for this cell.
          </motion.div>
        ) : (
          <motion.div
            key="vals"
            className="ps__band-vals"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {(
              [
                ['p10', bands.p10],
                ['p25', bands.p25],
                ['p50', bands.p50],
                ['p75', bands.p75],
                ['p90', bands.p90],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="ps__band-val">
                <span className="ps__band-label">{label}</span>
                <span className="ps__band-num">${Math.round(v)}k</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
