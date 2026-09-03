import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './rideloop.css';
import {
  Engine,
  CITY_HALF_M,
  CITY_CENTER,
  CELL_PRECISION,
  RADII_M,
  TTL_MS,
  LOAD_RIDES,
  toLatLng,
  toLocal,
  type Snapshot,
  type Trip,
} from './rideloop/engine';
import { bounds, cellsCovering } from './rideloop/geohash';

// Real mechanism from rideloop: driver positions live in a table partitioned
// by geohash cell with a ttl attribute; a nearby query reads the cells that
// overlap the search radius, drops expired items, and returns available
// drivers nearest first; the dispatch sweep widens the radius 500 m to 4 km
// and claims each candidate with a conditional update, so a driver can only
// be taken once. The fleet, the rides, and the service times come from one
// seeded PRNG, so every run reports the same figures.
const SEED = 26;
const FLEET = 160;
const VIEW = 800;
const SCALE = VIEW / (2 * CITY_HALF_M);
const REAL_TICK_MS = 120;
const SIM_TICK_MS = 240;

function px(east: number): number {
  return (east + CITY_HALF_M) * SCALE;
}
function py(north: number): number {
  return (CITY_HALF_M - north) * SCALE;
}

function fmtS(ms: number): string {
  return (ms / 1000).toFixed(1) + ' s';
}

function gridCells() {
  const sw = toLatLng({ north: -CITY_HALF_M, east: -CITY_HALF_M });
  const ne = toLatLng({ north: CITY_HALF_M, east: CITY_HALF_M });
  return cellsCovering(
    { minLat: sw.lat, minLng: sw.lng, maxLat: ne.lat, maxLng: ne.lng },
    CELL_PRECISION,
  ).map((hash) => {
    const b = bounds(hash);
    const a = toLocal(b.minLat, b.minLng);
    const c = toLocal(b.maxLat, b.maxLng);
    return { hash, x: px(a.east), y: py(c.north), w: (c.east - a.east) * SCALE, h: (c.north - a.north) * SCALE };
  });
}

function tripSteps(trip: Trip | null) {
  if (!trip) return [];
  const start = trip.trace.length - ((trip.trace.length - 1) % RADII_M.length) - 1;
  return trip.trace.slice(Math.max(0, start));
}

export default function RideloopDemo() {
  const reduce = useReducedMotion();
  const [engine, setEngine] = useState(() => new Engine(SEED, FLEET));
  const [snap, setSnap] = useState<Snapshot>(() => engine.snapshot());
  const svgRef = useRef<SVGSVGElement | null>(null);
  const cells = useMemo(() => gridCells(), []);

  useEffect(() => {
    const id = window.setInterval(() => {
      engine.tick(SIM_TICK_MS);
      setSnap(engine.snapshot());
    }, REAL_TICK_MS);
    return () => window.clearInterval(id);
  }, [engine]);

  function reset() {
    const next = new Engine(SEED, FLEET);
    setEngine(next);
    setSnap(next.snapshot());
  }

  function onMapClick(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * VIEW;
    const y = ((e.clientY - rect.top) / rect.height) * VIEW;
    engine.requestRide({ east: x / SCALE - CITY_HALF_M, north: CITY_HALF_M - y / SCALE });
    setSnap(engine.snapshot());
  }

  function silence() {
    engine.silence();
    setSnap(engine.snapshot());
  }
  function resume() {
    engine.resume();
    setSnap(engine.snapshot());
  }
  function startLoad() {
    engine.startLoad();
    setSnap(engine.snapshot());
  }

  const manual = snap.manual;
  const steps = tripSteps(manual);
  const current = steps[steps.length - 1];
  const litCells = new Set(manual && manual.status === 'requested' && current ? current.cells : []);
  const matchedDriver = manual?.driverId ? snap.drivers.find((d) => d.id === manual.driverId) : undefined;
  const busyCount = snap.drivers.filter((d) => d.status === 'busy').length;
  const load = snap.load;
  const loadDone = !load.running && load.submitted >= LOAD_RIDES;
  const silent = snap.silent;
  const pickupPt = manual ? { x: px(manual.pickup.east), y: py(manual.pickup.north) } : null;

  return (
    <div className="demo" aria-label="rideloop dispatch demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Geohash index, expanding radius, atomic claim</h3>
      <p className="demo__lede">
        Click the map to drop a pickup. The dispatch sweep queries the geohash
        cells that overlap each radius ring, takes the nearest available driver,
        and claims it with a conditional update. Stop one driver&apos;s pings to
        watch its item age past the {TTL_MS / 1000} s ttl, or run the 60 s load
        to reproduce the measured matches per minute.
      </p>

      <div className="rl__stage">
        <div className="rl__panel rl__panel--map">
          <div className="rl__panel-head">
            <span className="rl__panel-title">driver_positions, pk = geohash cell</span>
            <span className="rl__panel-meta">
              {FLEET} drivers, {busyCount} busy, precision {CELL_PRECISION}, t={fmtS(snap.now)}
            </span>
          </div>
          <svg
            ref={svgRef}
            className="rl__map"
            viewBox={`0 0 ${VIEW} ${VIEW}`}
            role="img"
            aria-label="city map with drivers"
            onClick={onMapClick}
          >
            <rect x={0} y={0} width={VIEW} height={VIEW} className="rl__ground" />
            {cells.map((c) => (
              <g key={c.hash}>
                <rect
                  x={c.x}
                  y={c.y}
                  width={c.w}
                  height={c.h}
                  className={'rl__cell' + (litCells.has(c.hash) ? ' rl__cell--lit' : '')}
                />
                <text x={c.x + 10} y={c.y + 22} className="rl__cell-label">
                  {c.hash}
                </text>
              </g>
            ))}
            {pickupPt &&
              manual &&
              manual.status === 'requested' &&
              steps.map((s) => (
                <circle
                  key={s.radiusM}
                  cx={pickupPt.x}
                  cy={pickupPt.y}
                  r={s.radiusM * SCALE}
                  className={'rl__ring' + (s === current ? ' rl__ring--live' : '')}
                />
              ))}
            {pickupPt && matchedDriver && manual && manual.status !== 'completed' && (
              <line
                x1={pickupPt.x}
                y1={pickupPt.y}
                x2={px(matchedDriver.pos.east)}
                y2={py(matchedDriver.pos.north)}
                className="rl__link"
              />
            )}
            {snap.drivers.map((d) => (
              <circle
                key={d.id}
                cx={px(d.pos.east)}
                cy={py(d.pos.north)}
                r={d.id === manual?.driverId ? 7 : 4.5}
                className={'rl__driver rl__driver--' + d.status + (d.id === manual?.driverId ? ' rl__driver--matched' : '')}
                style={reduce ? undefined : { transition: 'cx 0.12s linear, cy 0.12s linear' }}
              />
            ))}
            {pickupPt && manual && manual.status !== 'completed' && (
              <g className="rl__pin">
                <circle cx={pickupPt.x} cy={pickupPt.y} r={9} className="rl__pin-dot" />
                <circle cx={pickupPt.x} cy={pickupPt.y} r={3} className="rl__pin-core" />
              </g>
            )}
            {manual && manual.status !== 'completed' && manual.status !== 'requested' && (
              <rect
                x={px(manual.dropoff.east) - 6}
                y={py(manual.dropoff.north) - 6}
                width={12}
                height={12}
                className="rl__dropoff"
              />
            )}
          </svg>
          <div className="rl__legend mono">
            <span><i className="rl__sw rl__sw--available" /> available</span>
            <span><i className="rl__sw rl__sw--busy" /> busy (claimed)</span>
            <span><i className="rl__sw rl__sw--stale" /> silent, ttl pending</span>
            <span><i className="rl__sw rl__sw--expired" /> expired, filtered out</span>
          </div>
        </div>

        <div className="rl__panel">
          <div className="rl__panel-head">
            <span className="rl__panel-title">dispatch sweep</span>
            <span className="rl__panel-meta">
              {manual ? `${manual.id}, ${manual.status}` : 'radius 500 m to 4 km, retry after 1 s'}
            </span>
          </div>
          {!manual && <p className="rl__empty mono">click the map to POST /rides</p>}
          {manual && (
            <ul className="rl__trace">
              {steps.map((s, i) => (
                <li key={i} className="rl__step">
                  <span className="rl__step-radius">{s.radiusM} m</span>
                  <span className="rl__step-cells">
                    {s.cells.length} cell{s.cells.length === 1 ? '' : 's'}: {s.cells.join(' ')}
                  </span>
                  <span className="rl__step-cand">
                    {s.candidates === 0 ? 'no available driver' : `${s.candidates} candidate${s.candidates === 1 ? '' : 's'}`}
                  </span>
                  {s.claims.map((c) => (
                    <span key={c.driverId} className={'rl__claim rl__claim--' + (c.result === 'ok' ? 'ok' : 'fail')}>
                      claim {c.driverId} at {Math.round(c.distanceM)} m: {c.result === 'ok' ? 'status available to busy, ok' : c.result}
                    </span>
                  ))}
                </li>
              ))}
              {manual.attempts > 0 && manual.status === 'requested' && (
                <li className="rl__step rl__step--retry">
                  attempt {manual.attempts} found nobody inside 4 km, next_attempt_at in 1 s
                </li>
              )}
              {manual.status !== 'requested' && (
                <li className="rl__step rl__step--verdict">
                  matched {manual.driverId} in {manual.latencyMs} ms
                  {manual.status === 'matched' && ', driver heading to pickup'}
                  {manual.status === 'en_route' && ', en route to dropoff'}
                  {manual.status === 'completed' && ', completed and driver released'}
                </li>
              )}
            </ul>
          )}
        </div>

        <div className="rl__panel">
          <div className="rl__panel-head">
            <span className="rl__panel-title">ttl expiry</span>
            <span className="rl__panel-meta">POSITION_TTL_SECONDS={TTL_MS / 1000}</span>
          </div>
          {!silent && (
            <p className="rl__empty mono">every ping refreshes the item&apos;s ttl attribute</p>
          )}
          {silent && (
            <dl className="rl__kv mono">
              <dt>driver</dt>
              <dd>{silent.driverId} stopped pinging</dd>
              <dt>last ping</dt>
              <dd>{fmtS(Math.max(0, snap.now - silent.lastPingAt))} ago</dd>
              <dt>ttl</dt>
              <dd>
                {silent.ttlAt > snap.now ? `expires in ${fmtS(silent.ttlAt - snap.now)}` : `expired ${fmtS(snap.now - silent.ttlAt)} ago`}
              </dd>
              <dt>visible to nearby</dt>
              <dd className={silent.visible ? 'rl__yes' : 'rl__no'}>{silent.visible ? 'yes' : 'no, filtered on read'}</dd>
            </dl>
          )}
          <div className="rl__row">
            {!silent ? (
              <button className="demo__btn demo__btn--ghost rl__small" onClick={silence}>
                Stop a driver&apos;s pings
              </button>
            ) : (
              <button className="demo__btn demo__btn--ghost rl__small" onClick={resume}>
                Resume pings
              </button>
            )}
          </div>
        </div>

        <div className="rl__panel">
          <div className="rl__panel-head">
            <span className="rl__panel-title">GET /dispatch/stats</span>
            <span className="rl__panel-meta">
              {load.submitted === 0
                ? `${LOAD_RIDES} rides at 10/s`
                : `${load.submitted}/${LOAD_RIDES} submitted, ${load.pending} pending`}
            </span>
          </div>
          <div className="rl__big">
            <span className="rl__big-val">{load.matchesPerMinute}</span>
            <span className="rl__big-unit">matches / minute</span>
          </div>
          <dl className="rl__kv mono">
            <dt>matched</dt>
            <dd>{load.matched} ({load.completed} completed)</dd>
            <dt>latency p50 / p95</dt>
            <dd>{load.p50} ms / {load.p95} ms</dd>
            <dt>conditional claims</dt>
            <dd>{snap.claims.ok} ok, {snap.claims.failed} rejected</dd>
            <dt>cell queries</dt>
            <dd>{snap.claims.queries} ({snap.claims.expiredSkipped} expired items skipped)</dd>
            <dt>sweeps</dt>
            <dd>{load.sweeps}</dd>
          </dl>
          {loadDone && (
            <p className="rl__verdict">
              {load.matched} matches over {fmtS((load.lastMatchAt ?? 0) - (load.firstRequestAt ?? 0))}, {load.matchesPerMinute} per minute, p50 {load.p50} ms
            </p>
          )}
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={startLoad} disabled={load.running || loadDone}>
          {load.running ? 'Running load...' : loadDone ? 'Load complete' : 'Run 60 s load'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">
          {CITY_CENTER.lat.toFixed(4)}, {CITY_CENTER.lng.toFixed(4)}, seed {SEED}, same fleet every run
        </span>
      </div>
    </div>
  );
}
