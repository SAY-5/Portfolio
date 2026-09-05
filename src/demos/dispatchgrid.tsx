import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './dispatchgrid.css';
import { BURST_SIZE, DEMO_OPTIONS, Engine, type CityView, type EngineSnapshot } from './dispatchgrid/engine';
import { PARTITIONS } from './dispatchgrid/topics';
import { FENCE_RADIUS_M } from './dispatchgrid/world';

// Real mechanism from dispatchgrid: ride requests are keyed by city id onto
// Kafka partitions, a Streams task polls them and runs the matcher against a
// Redis-shaped GEO index (GEOSEARCH nearest-first, an atomic SET NX claim per
// candidate, a larger candidate page when a full page was taken, then a wider
// radius), trips land on MySQL shards chosen by floorMod(city_id, 2), and the
// three services take a rolling update with maxUnavailable 0 under the same
// load. The engine runs on a simulated clock from a seeded PRNG, so every run
// is identical.
const SIM_STEP_MS = 250;
const TICK_MS = 100;
const MAP = 220;
const SCALE = 100 / 7000;
const TOPICS = ['ride-requests', 'driver-positions', 'ride-matches', 'ride-unmatched'];
const SHARD_TARGET = [301, 302];
const ease = [0.22, 1, 0.36, 1] as const;

function px(m: number): number {
  return m * SCALE;
}

function CityMap({ city }: { city: CityView }) {
  const cx = MAP / 2;
  const cy = MAP / 2;
  return (
    <div className="dg__map">
      <div className="dg__map-head">
        <span className="dg__map-name">
          city {city.id} {city.name}
        </span>
        <span className="dg__map-meta">
          {city.available} free / {city.claimed} claimed
        </span>
      </div>
      <svg className="dg__svg" viewBox={`0 0 ${MAP} ${MAP}`} role="img" aria-label={`${city.name} driver map`}>
        <circle className="dg__fence" cx={cx} cy={cy} r={px(FENCE_RADIUS_M)} />
        {city.pickup && city.ring !== null && (
          <circle
            className="dg__ring"
            cx={cx + px(city.pickup.east)}
            cy={cy - px(city.pickup.north)}
            r={px(city.ring)}
          />
        )}
        {city.pickup && city.driver && (
          <line
            className="dg__link"
            x1={cx + px(city.pickup.east)}
            y1={cy - px(city.pickup.north)}
            x2={cx + px(city.driver.east)}
            y2={cy - px(city.driver.north)}
          />
        )}
        {city.drivers.map((d) => (
          <circle
            key={d.id}
            className={'dg__driver' + (d.available ? '' : ' dg__driver--claimed')}
            cx={cx + px(d.east)}
            cy={cy - px(d.north)}
            r={2.4}
          />
        ))}
        {city.pickup && (
          <rect
            className="dg__pickup"
            x={cx + px(city.pickup.east) - 3.5}
            y={cy - px(city.pickup.north) - 3.5}
            width={7}
            height={7}
            transform={`rotate(45 ${cx + px(city.pickup.east)} ${cy - px(city.pickup.north)})`}
          />
        )}
      </svg>
      <div className="dg__map-foot mono">
        key {city.id} to partition {city.partition}, trips on {city.shard}
      </div>
    </div>
  );
}

export default function DispatchgridDemo() {
  const reduce = useReducedMotion();
  const engineRef = useRef<Engine | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [snap, setSnap] = useState<EngineSnapshot>(() => new Engine(DEMO_OPTIONS).snapshot());
  const [live, setLive] = useState(false);

  function engine(): Engine {
    if (!engineRef.current) engineRef.current = new Engine(DEMO_OPTIONS);
    return engineRef.current;
  }

  function stopTimer() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }
  useEffect(() => stopTimer, []);

  function step() {
    const e = engine();
    e.tick(reduce ? SIM_STEP_MS * 8 : SIM_STEP_MS);
    const s = e.snapshot();
    setSnap(s);
    if (s.idle) {
      stopTimer();
      setLive(false);
    }
  }

  function ensureTimer() {
    if (timerRef.current !== null) return;
    setLive(true);
    timerRef.current = setInterval(step, TICK_MS);
  }

  function run() {
    engine().start();
    ensureTimer();
  }

  function burst() {
    engine().burst();
    ensureTimer();
  }

  function rollOut() {
    engine().startRollout();
    ensureTimer();
  }

  function reset() {
    stopTimer();
    engineRef.current = new Engine(DEMO_OPTIONS);
    setSnap(engineRef.current.snapshot());
    setLive(false);
  }

  const secs = (snap.now / 1000).toFixed(1);
  const phase =
    snap.rides === 'idle'
      ? snap.rolling
        ? 'rolling update on an idle stack'
        : 'ready'
      : snap.finished
        ? snap.rolling
          ? 'run finished, rollout still converging'
          : 'run finished'
        : snap.rides === 'running'
          ? `load run at ${secs}s of 60s`
          : 'draining ride-requests';

  return (
    <div className="demo" aria-label="dispatchgrid matching demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Key, search, claim, shard, roll out</h3>
      <p className="demo__lede">
        Two cities post rides at 10 per second onto city-keyed Kafka partitions. The
        Streams matcher takes the nearest free driver inside an expanding radius with
        an atomic claim, trips fill the shard that floorMod(city_id, 2) picks, and a
        rolling update replaces every pod under load with the error counter at zero.
      </p>

      <div className="dg__phase mono" aria-live="polite">
        <span className="dg__phase-dot" data-live={live} />
        {phase}
      </div>

      <div className="dg__stats">
        {[
          ['submitted', snap.submitted, ''],
          ['matched', snap.matched, ''],
          ['unmatched', snap.unmatched, ''],
          ['matches/min', snap.matchesPerMinute, 'trailing 60 s'],
          ['p50', snap.p50, 'ms'],
          ['p95', snap.p95, 'ms'],
        ].map(([label, val, unit]) => (
          <div className="dg__stat" key={String(label)}>
            <span className="dg__stat-label">{label}</span>
            <span className="dg__stat-val">
              {val}
              {unit ? <em>{unit}</em> : null}
            </span>
          </div>
        ))}
      </div>

      <div className="dg__stage">
        <div className="dg__panel dg__panel--wide">
          <div className="dg__panel-head">
            <span className="dg__panel-title">driver index (Redis GEO)</span>
            <span className="dg__panel-meta">
              {DEMO_OPTIONS.driversPerCity} drivers per city, heartbeat TTL {DEMO_OPTIONS.heartbeatTtlMs / 1000} s, ring
              on the latest match
            </span>
          </div>
          <div className="dg__maps">
            {snap.cities.map((c) => (
              <CityMap key={c.id} city={c} />
            ))}
          </div>
        </div>

        <div className="dg__panel">
          <div className="dg__panel-head">
            <span className="dg__panel-title">kafka topics</span>
            <span className="dg__panel-meta">{PARTITIONS} partitions each, consumer lag {snap.lag}</span>
          </div>
          <div className="dg__topics">
            {TOPICS.map((t) => {
              const depths = snap.partitionDepths[t] ?? [];
              const max = Math.max(1, ...depths);
              return (
                <div className="dg__topic" key={t}>
                  <span className="dg__topic-name mono">
                    {t}
                    <b>{snap.topicTotals[t] ?? 0}</b>
                  </span>
                  <span className="dg__bars">
                    {depths.map((d, p) => {
                      const city = snap.cities.find((c) => c.partition === p);
                      return (
                        <span className="dg__bar-slot" key={p} title={`partition ${p}: ${d}`}>
                          <motion.span
                            className={'dg__bar' + (city ? ` dg__bar--city${city.id}` : '')}
                            initial={false}
                            animate={{ height: `${Math.max(d > 0 ? 6 : 0, (d / max) * 100)}%` }}
                            transition={{ duration: reduce ? 0 : 0.2, ease }}
                          />
                          <i>{city ? `c${city.id}` : p}</i>
                        </span>
                      );
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="dg__panel">
          <div className="dg__panel-head">
            <span className="dg__panel-title">match trace</span>
            <span className="dg__panel-meta">
              {snap.traceRide ?? 'waiting for a poll'} · taken {snap.counters.taken}, grows {snap.counters.grows},
              widens {snap.counters.widens}
            </span>
          </div>
          <ul className="dg__trace">
            {snap.trace.map((l, i) => (
              <li className={`dg__trace-line dg__trace-line--${l.tone}`} key={i}>
                {l.text}
              </li>
            ))}
            {snap.trace.length === 0 && (
              <li className="dg__trace-line dg__trace-line--dim">
                search, claim, grow, widen, and the produce to ride-matches or ride-unmatched
              </li>
            )}
          </ul>
        </div>

        <div className="dg__panel">
          <div className="dg__panel-head">
            <span className="dg__panel-title">mysql shards</span>
            <span className="dg__panel-meta">shard = floorMod(city_id, 2); measured 301 / 302</span>
          </div>
          <div className="dg__tanks">
            {snap.byShard.map((count, i) => {
              const byCity = snap.byShardCity[i];
              const cities = Object.keys(byCity).map(Number).sort();
              return (
                <div className="dg__tank" key={i}>
                  <span className="dg__tank-name mono">
                    shard-{i}
                    <b>{count}</b>
                  </span>
                  <span className="dg__tank-well">
                    {cities.map((cid) => (
                      <motion.span
                        key={cid}
                        className={`dg__tank-fill dg__tank-fill--city${cid}`}
                        initial={false}
                        animate={{ height: `${Math.min(100, (byCity[cid] / SHARD_TARGET[i]) * 100)}%` }}
                        transition={{ duration: reduce ? 0 : 0.2, ease }}
                      >
                        city {cid}: {byCity[cid]}
                      </motion.span>
                    ))}
                  </span>
                  <span className="dg__tank-rule mono">city {i === 0 ? 2 : 1} lands here</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="dg__panel dg__panel--wide">
          <div className="dg__panel-head">
            <span className="dg__panel-title">kubernetes rolling update</span>
            <span className="dg__panel-meta">
              maxUnavailable 0, maxSurge 1, readiness gated
              {snap.rolloutMs !== null && ` · ${(snap.rolloutMs / 1000).toFixed(1)}s${snap.rolling ? ' so far' : ''}`}
            </span>
          </div>
          <div className="dg__deploys">
            {snap.deployments.map((d) => (
              <div className="dg__deploy" key={d.name}>
                <span className="dg__deploy-name mono">
                  {d.name}
                  <b>rev {d.revision}</b>
                </span>
                <span className="dg__pods">
                  {d.pods.map((p) => (
                    <span className={`dg__pod dg__pod--${p.phase.toLowerCase()}`} key={p.name} title={p.name}>
                      {p.name.slice(-5)} {p.phase}
                    </span>
                  ))}
                </span>
                <span className="dg__deploy-count mono">
                  served {d.served}
                  <b className={d.errors === 0 ? 'dg__zero' : 'dg__nonzero'}>errors {d.errors}</b>
                </span>
              </div>
            ))}
          </div>
          <ul className="dg__events mono">
            {snap.events.length === 0 && <li>no rollout yet</li>}
            {snap.events.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={snap.rides !== 'idle'}>
          {snap.rides === 'idle' ? 'Run 60 s load' : snap.finished ? 'Run finished' : 'Running…'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={burst} disabled={snap.rides === 'stopped'}>
          Burst {BURST_SIZE} rides
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={rollOut} disabled={snap.rolling}>
          {snap.rolling ? 'Rolling…' : 'Roll out'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={snap.now === 0 && !live}>
          Reset
        </button>
        <span className="demo__hint">
          {snap.finished
            ? `${snap.matched} matched, ${snap.unmatched} unmatched, ${snap.byShard[0]} / ${snap.byShard[1]} by shard`
            : 'seed 7, same fleet and rides every run'}
        </span>
      </div>
    </div>
  );
}
