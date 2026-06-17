import { useMemo, useState } from 'react';
import '../styles/demo.css';
import './routeengine.css';
import { useStore } from './routeengine/state';
import {
  addStop,
  moveDepot,
  optimize,
  removeStop,
  resetAll,
  showNaive,
} from './routeengine/store';
import { naiveRoute, optimizeRoute } from './routeengine/engine';
import { DEPOT_ID, GRID_MAX, GRID_MIN, type Route, type Stop } from './routeengine/types';

// Round a distance for display without pulling in extra deps.
function fmt(n: number): string {
  return n.toFixed(1);
}

// In-browser delivery route planner. A depot and a set of stops live on a
// 0..100 grid in localStorage. The safe engine builds a Euclidean distance
// matrix, a nearest-neighbour tour from the depot through every stop and back,
// and a 2-opt improvement pass. The map below draws the depot, the stops, and
// the current route as an ordered polyline. Everything is deterministic and
// runs client-side; there is no eval and no network.

const VIEW = 100; // SVG user units span the full 0..100 grid.

// Resolve a stop or depot id to its grid coordinates for drawing.
function pointOf(id: string, depot: { x: number; y: number }, stops: Stop[]) {
  if (id === DEPOT_ID) return depot;
  return stops.find((s) => s.id === id) ?? depot;
}

// Build the SVG polyline points string for a route order, closing the loop back
// to the depot.
function polylinePoints(
  route: Route,
  depot: { x: number; y: number },
  stops: Stop[],
): string {
  if (route.order.length === 0) return '';
  return route.order
    .concat(route.order[0])
    .map((id) => {
      const p = pointOf(id, depot, stops);
      return `${p.x},${p.y}`;
    })
    .join(' ');
}

export default function RouteengineDemo() {
  const { depot, stops, route, optimized } = useStore();
  // Click mode: dropping a new stop or moving the depot.
  const [mode, setMode] = useState<'stop' | 'depot'>('stop');
  // Manual add-stop form fields.
  const [form, setForm] = useState({ label: '', x: '', y: '' });

  // Add a stop from the typed coordinates, clamping into the grid.
  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    const x = Number(form.x);
    const y = Number(form.y);
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    addStop(x, y, form.label);
    setForm({ label: '', x: '', y: '' });
  }

  const points = useMemo(
    () => polylinePoints(route, depot, stops),
    [route, depot, stops],
  );

  // Map a click in the SVG to grid coordinates and apply the active mode.
  function handleMapClick(event: React.MouseEvent<SVGSVGElement>) {
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * GRID_MAX;
    const y = ((event.clientY - rect.top) / rect.height) * GRID_MAX;
    if (mode === 'depot') moveDepot(x, y);
    else addStop(x, y);
  }

  // Visit index per stop id, for labelling markers in route order.
  const visitOrder = useMemo(() => {
    const map = new Map<string, number>();
    let n = 0;
    for (const id of route.order) {
      if (id !== DEPOT_ID) map.set(id, ++n);
    }
    return map;
  }, [route.order]);

  // Naive vs optimized totals, recomputed from the current depot and stops, so
  // the summary always shows the live improvement even before optimize is run.
  const compare = useMemo(() => {
    const naive = naiveRoute(depot, stops).total;
    const best = optimizeRoute(depot, stops).total;
    const saved = naive - best;
    const pct = naive > 0 ? (saved / naive) * 100 : 0;
    return { naive, best, saved, pct };
  }, [depot, stops]);

  // Stops sorted into the current visit order for the list panel.
  const orderedStops = useMemo(() => {
    const byId = new Map(stops.map((s) => [s.id, s]));
    const out: { stop: Stop; n: number }[] = [];
    let n = 0;
    for (const id of route.order) {
      if (id === DEPOT_ID) continue;
      const stop = byId.get(id);
      if (stop) out.push({ stop, n: ++n });
    }
    return out;
  }, [route.order, stops]);

  return (
    <section className="re" aria-label="Delivery route planner">
      <header className="re__head">
        <h2 className="re__title">RouteEngine</h2>
        <p className="re__sub">
          Place stops, then optimize the round trip from the depot with
          nearest-neighbour and a 2-opt pass.
        </p>
      </header>

      <div className="re__stage">
        <div className="re__mapwrap glass">
          <div className="re__modes" role="group" aria-label="Map click mode">
            <button
              type="button"
              className={`re__mode${mode === 'stop' ? ' re__mode--on' : ''}`}
              aria-pressed={mode === 'stop'}
              onClick={() => setMode('stop')}
            >
              Add stop
            </button>
            <button
              type="button"
              className={`re__mode${mode === 'depot' ? ' re__mode--on' : ''}`}
              aria-pressed={mode === 'depot'}
              onClick={() => setMode('depot')}
            >
              Move depot
            </button>
          </div>

          <svg
            className="re__svg"
            viewBox={`0 0 ${VIEW} ${VIEW}`}
            role="img"
            aria-label={`Route map with ${stops.length} stops, total distance ${fmt(route.total)}`}
            onClick={handleMapClick}
          >
            <title>
              Delivery route from the depot through {stops.length} stops and back
            </title>
            <defs>
              <pattern
                id="re-grid"
                width="10"
                height="10"
                patternUnits="userSpaceOnUse"
              >
                <path d="M 10 0 L 0 0 0 10" className="re__gridline" />
              </pattern>
            </defs>
            <rect x="0" y="0" width={VIEW} height={VIEW} fill="url(#re-grid)" />

            {points && <polyline className="re__path" points={points} />}

            {stops.map((s) => (
              <g key={s.id} className="re__stop">
                <circle cx={s.x} cy={s.y} r="2.6" className="re__stopdot" />
                <text x={s.x} y={s.y + 0.9} className="re__stoporder">
                  {visitOrder.get(s.id) ?? ''}
                </text>
              </g>
            ))}

            <g className="re__depot">
              <rect
                x={depot.x - 3}
                y={depot.y - 3}
                width="6"
                height="6"
                rx="1.2"
                className="re__depotbox"
              />
            </g>
          </svg>
          <p className="re__hint" aria-live="polite">
            Click the map to {mode === 'depot' ? 'move the depot' : 'add a stop'}.
          </p>
          <ul className="re__legend" aria-label="Map legend">
            <li className="re__legenditem">
              <span className="re__swatch re__swatch--depot" aria-hidden="true" />
              Depot
            </li>
            <li className="re__legenditem">
              <span className="re__swatch re__swatch--stop" aria-hidden="true" />
              Stop
            </li>
            <li className="re__legenditem">
              <span className="re__swatch re__swatch--path" aria-hidden="true" />
              Route
            </li>
          </ul>
        </div>

        <div className="re__panel glass">
          <div className="re__actions">
            <button
              type="button"
              className="re__btn re__btn--primary"
              onClick={() => optimize()}
              disabled={stops.length < 2}
            >
              Optimize route
            </button>
            <button
              type="button"
              className="re__btn"
              onClick={() => showNaive()}
              aria-pressed={!optimized}
            >
              Naive order
            </button>
          </div>

          <form className="re__add" onSubmit={handleAdd} aria-label="Add a stop by coordinates">
            <label className="re__field">
              Label
              <input
                className="re__input"
                type="text"
                value={form.label}
                placeholder="Stop"
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              />
            </label>
            <label className="re__field">
              X
              <input
                className="re__input"
                type="number"
                min={GRID_MIN}
                max={GRID_MAX}
                value={form.x}
                required
                onChange={(e) => setForm((f) => ({ ...f, x: e.target.value }))}
              />
            </label>
            <label className="re__field">
              Y
              <input
                className="re__input"
                type="number"
                min={GRID_MIN}
                max={GRID_MAX}
                value={form.y}
                required
                onChange={(e) => setForm((f) => ({ ...f, y: e.target.value }))}
              />
            </label>
            <button type="submit" className="re__btn">
              Add
            </button>
          </form>

          {stops.length === 0 ? (
            <p className="re__empty">No stops yet. Click the map or add coordinates.</p>
          ) : (
            <ul className="re__list" aria-label="Delivery stops in visit order">
              {orderedStops.map(({ stop, n }) => (
                <li key={stop.id} className="re__row">
                  <span className="re__rownum" aria-hidden="true">
                    {n}
                  </span>
                  <span className="re__rowlabel">{stop.label}</span>
                  <span className="re__rowcoord">
                    {stop.x}, {stop.y}
                  </span>
                  <button
                    type="button"
                    className="re__remove"
                    aria-label={`Remove ${stop.label}`}
                    onClick={() => removeStop(stop.id)}
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          )}

          <dl className="re__summary" aria-label="Route summary">
            <div className="re__stat">
              <dt className="re__statk">Stops</dt>
              <dd className="re__statv">{stops.length}</dd>
            </div>
            <div className="re__stat">
              <dt className="re__statk">Drawn distance</dt>
              <dd className="re__statv">{fmt(route.total)}</dd>
            </div>
            <div className="re__stat">
              <dt className="re__statk">Naive total</dt>
              <dd className="re__statv">{fmt(compare.naive)}</dd>
            </div>
            <div className="re__stat">
              <dt className="re__statk">Optimized total</dt>
              <dd className="re__statv re__statv--good">{fmt(compare.best)}</dd>
            </div>
            <div className="re__stat">
              <dt className="re__statk">Saved</dt>
              <dd className="re__statv re__statv--good">{fmt(compare.saved)}</dd>
            </div>
            <div className="re__stat">
              <dt className="re__statk">Improvement</dt>
              <dd className="re__statv re__statv--good">{fmt(compare.pct)}%</dd>
            </div>
          </dl>

          <div className="re__actions">
            <button
              type="button"
              className="re__btn re__btn--ghost"
              onClick={() => resetAll()}
            >
              Reset planner
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
