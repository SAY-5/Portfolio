import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './failsafe.css';
import { DemoSim, type ReplicaSnap, type Snap } from './failsafe/sim';
import { CHAOS } from './failsafe/chaos';
import type { BreakerState } from './failsafe/breaker';

// Real mechanism from failsafe: a request passes a per-key token bucket, then
// the forwarder tries a replica the pool still admits; a connection error
// pulls that replica and fails the attempt over to another one with backoff,
// and only after max_attempts does the client see a 5xx. Every replica has its
// own breaker. The chaos run kills replicas under load and the counter that
// matters, client-visible failures, is expected to stay at 0. All of it runs on
// a seeded PRNG and a simulated clock, so the same buttons give the same run.
const TICK_MS = 100;
const SIM_MS_PER_TICK = 200;

const STATES: BreakerState[] = ['closed', 'half_open', 'open'];
const REPLICA_Y = [16, 66, 116];

function fmtMs(v: number): string {
  return v >= 100 ? v.toFixed(0) : v.toFixed(1);
}

function replicaPhase(r: ReplicaSnap): string {
  if (!r.alive) return 'killed';
  if (!r.healthy) return 'restarting';
  if (r.breaker.state !== 'closed') return r.breaker.state.replace('_', '-');
  return 'healthy';
}

export default function FailsafeDemo() {
  const reduce = useReducedMotion();
  const simRef = useRef<DemoSim | null>(null);
  const [snap, setSnap] = useState<Snap>(() => new DemoSim().snapshot());
  const [capacity, setCapacity] = useState(20);
  const [refill, setRefill] = useState(10);
  const [picked, setPicked] = useState('upstream-1');

  function sim(): DemoSim {
    if (!simRef.current) simRef.current = new DemoSim();
    return simRef.current;
  }

  useEffect(() => {
    const id = window.setInterval(() => {
      const s = sim();
      s.tick(SIM_MS_PER_TICK);
      setSnap(s.snapshot());
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  function refresh() {
    setSnap(sim().snapshot());
  }
  function start() {
    sim().run.start();
    refresh();
  }
  function reset() {
    simRef.current = new DemoSim();
    setCapacity(20);
    setRefill(10);
    refresh();
  }
  function kill(name: string) {
    sim().run.kill(name);
    refresh();
  }
  function randomKill() {
    sim().run.randomKill();
    refresh();
  }
  function toggleAuto() {
    sim().run.autoKill = !sim().run.autoKill;
    refresh();
  }
  function onBucket(cap: number, rate: number) {
    setCapacity(cap);
    setRefill(rate);
    sim().setBucket(cap, rate);
    refresh();
  }
  function burst(n: number) {
    sim().burst(n);
    refresh();
  }
  function record(ok: boolean) {
    sim().breakerRecord(picked, ok);
    refresh();
  }

  const sum = snap.summary;
  const elapsedS = (sum.elapsedMs / 1000).toFixed(1);
  const status = snap.running
    ? `chaos run t+${elapsedS}s, ${snap.replicas.filter((r) => r.healthy).length}/3 replicas in rotation`
    : snap.finished
      ? `run complete: ${sum.total} requests, ${sum.clientFailed} client-visible failures`
      : 'ready';
  const chosen = snap.replicas.find((r) => r.name === picked) ?? snap.replicas[0];
  const bucketPct = Math.max(0, Math.min(100, (snap.bucket.tokens / snap.bucket.capacity) * 100));

  return (
    <div className="demo" aria-label="failsafe gateway chaos demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Rate limit, break, retry, fail over</h3>
      <p className="demo__lede">
        Start the chaos run: {CHAOS.rps} requests per second flow through the gateway to three
        replicas while replicas get killed and restarted. In-flight requests to a dead replica
        retry once on a live one, so retries and failovers count up and client-visible
        failures stay at 0. The token bucket and the breakers below are live on the same clock.
      </p>

      <div className="fg__status mono" aria-live="polite">
        <span className="fg__status-dot" data-live={snap.running} data-done={snap.finished} />
        {status}
      </div>

      <div className="fg__stage">
        <div className="fg__panel fg__panel--wide">
          <div className="fg__panel-head">
            <span className="fg__panel-title">gateway fan-out</span>
            <span className="fg__panel-meta">
              route /orders, retry max_attempts {4}, health probe every 1 s
            </span>
          </div>
          <div className="fg__fanout">
            <svg className="fg__svg" viewBox="0 0 360 168" role="img" aria-label="gateway routing requests to three replicas">
              <rect x="12" y="58" width="96" height="52" rx="10" className="fg__gw" />
              <text x="60" y="80" textAnchor="middle" className="fg__gw-label">gateway</text>
              <text x="60" y="97" textAnchor="middle" className="fg__gw-sub">
                {snap.running ? `${CHAOS.rps} rps` : 'idle'}
              </text>
              {snap.replicas.map((r, i) => {
                const y = REPLICA_Y[i];
                const path = `M 108 84 C 180 84, 180 ${y + 18}, 250 ${y + 18}`;
                const inRotation = r.healthy && r.breaker.state !== 'open';
                const dots = snap.running && inRotation && !reduce ? [0, 0.6] : [];
                return (
                  <g key={r.name} className="fg__rep" data-phase={replicaPhase(r)}>
                    <path d={path} className="fg__link" data-on={inRotation} />
                    {dots.map((delay) => (
                      <circle key={delay} r="3" className="fg__dot">
                        <animateMotion dur="1.1s" begin={`${delay}s`} repeatCount="indefinite" path={path} />
                      </circle>
                    ))}
                    <rect x="250" y={y} width="98" height="36" rx="8" className="fg__rep-box" />
                    <text x="260" y={y + 15} className="fg__rep-name">{r.name}</text>
                    <text x="260" y={y + 29} className="fg__rep-state">
                      {replicaPhase(r)}
                      {!r.alive ? ` ${(r.restartInMs / 1000).toFixed(1)}s` : ''}
                    </text>
                    <text x="340" y={y + 29} textAnchor="end" className="fg__rep-served">{r.served}</text>
                  </g>
                );
              })}
            </svg>
            <div className="fg__kills">
              {snap.replicas.map((r) => (
                <button
                  key={r.name}
                  className="fg__kill"
                  onClick={() => kill(r.name)}
                  disabled={!r.alive}
                >
                  kill {r.name.replace('upstream-', 'replica ')}
                </button>
              ))}
              <button className="fg__kill" onClick={randomKill} disabled={snap.replicas.every((r) => !r.alive)}>
                kill random
              </button>
              <label className="fg__auto mono">
                <input type="checkbox" checked={snap.autoKill} onChange={toggleAuto} /> auto kill during run
              </label>
            </div>
          </div>
          <ul className="fg__recent mono">
            {snap.recent.length === 0 && <li className="fg__recent-empty">requests appear here once the run starts</li>}
            {snap.recent.map((o) => (
              <li key={o.id} className="fg__req" data-status={o.status} data-retried={o.retries.length > 0}>
                <span className="fg__req-id">#{o.id}</span>
                <span className="fg__req-line">
                  {o.method} {o.path} {'->'} {o.status}
                  {o.replica ? ` via ${o.replica}` : ''}
                </span>
                <span className="fg__req-note">
                  {o.retries.map((r, i) => `${r} retry${o.failovers[i] ? `, failover ${o.failovers[i][0]} to ${o.failovers[i][1]}` : ''}`).join('; ')}
                </span>
                <span className="fg__req-ms">{fmtMs(o.latencyMs)} ms</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="fg__panel fg__panel--wide">
          <div className="fg__panel-head">
            <span className="fg__panel-title">chaos summary</span>
            <span className="fg__panel-meta">
              {CHAOS.durationMs / 1000} s at {CHAOS.rps} rps, kills restart after {CHAOS.restartAfterMs / 1000} s
            </span>
          </div>
          <div className="fg__stats">
            <Stat label="total requests" value={sum.total} />
            <Stat label="successful (2xx)" value={sum.ok} />
            <Stat label="rate limited (429)" value={sum.rateLimited} />
            <Stat label="client-visible failed" value={sum.clientFailed} pinned bad={sum.clientFailed > 0} />
            <Stat label="retries" value={sum.retriesTotal} sub={Object.entries(sum.retries).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'} />
            <Stat label="failovers" value={sum.failovers} />
            <Stat label="breaker transitions" value={sum.breakerTransitions} />
            <Stat label="kills" value={sum.kills} />
            <Stat label="latency p50 / p95" value={`${fmtMs(sum.p50)} / ${fmtMs(sum.p95)}`} unit="ms" />
          </div>
          <div className="fg__timeline mono">
            <span className="fg__timeline-head">kill timeline</span>
            {snap.timeline.length === 0 && <span className="fg__timeline-empty">no kills yet</span>}
            {snap.timeline.map((e, i) => (
              <span key={i} className="fg__timeline-row" data-kind={e.kind}>
                <b>t+{(Math.max(0, e.at - (snap.now - sum.elapsedMs)) / 1000).toFixed(1)}s</b> {e.kind} {e.replica}
              </span>
            ))}
          </div>
          {snap.finished && (
            <p className="fg__verdict" data-pass={sum.clientFailed === 0}>
              {sum.clientFailed === 0
                ? `PASS: 0 client-visible failures across ${sum.kills} kills`
                : `FAIL: ${sum.clientFailed} client-visible failures`}
            </p>
          )}
        </div>

        <div className="fg__panel">
          <div className="fg__panel-head">
            <span className="fg__panel-title">token bucket</span>
            <span className="fg__panel-meta">tokens = min(capacity, tokens + elapsed x rate)</span>
          </div>
          <label className="fg__slider mono">
            <span>capacity {capacity}</span>
            <input type="range" min={1} max={200} value={capacity} onChange={(e) => onBucket(Number(e.target.value), refill)} />
          </label>
          <label className="fg__slider mono">
            <span>refill {refill}/s</span>
            <input type="range" min={1} max={400} value={refill} onChange={(e) => onBucket(capacity, Number(e.target.value))} />
          </label>
          <div className="fg__bucket" aria-label="bucket level">
            <div className="fg__bucket-fill" style={{ width: `${bucketPct}%` }} />
            <span className="fg__bucket-label mono">
              {snap.bucket.tokens.toFixed(1)} / {snap.bucket.capacity} tokens
            </span>
          </div>
          <div className="fg__row">
            <button className="demo__btn demo__btn--ghost fg__small" onClick={() => burst(25)}>Send burst of 25</button>
            <button className="demo__btn demo__btn--ghost fg__small" onClick={() => burst(1)}>Send one</button>
          </div>
          <div className="fg__counts mono">
            <span>200 <b>{snap.bucket.allowed}</b></span>
            <span>429 <b className="fg__warn">{snap.bucket.limited}</b></span>
            <span>
              Retry-After{' '}
              <b>{snap.bucket.lastRetryAfterMs === null ? 'n/a' : `${snap.bucket.lastRetryAfterMs} ms`}</b>
            </span>
          </div>
        </div>

        <div className="fg__panel">
          <div className="fg__panel-head">
            <span className="fg__panel-title">circuit breaker</span>
            <span className="fg__panel-meta">window 20, ratio 0.5 after 5, 3 consecutive, open 3 s, 2 probes</span>
          </div>
          <div className="fg__tabs">
            {snap.replicas.map((r) => (
              <button
                key={r.name}
                className={'fg__tab' + (r.name === picked ? ' fg__tab--on' : '')}
                onClick={() => setPicked(r.name)}
              >
                {r.name}
              </button>
            ))}
          </div>
          <div className="fg__machine">
            {STATES.map((s, i) => (
              <span key={s} className="fg__state-wrap">
                <span className="fg__state" data-on={chosen.breaker.state === s} data-state={s}>
                  {s.replace('_', '-')}
                  {s === 'open' && chosen.breaker.state === 'open' && (
                    <em>{(chosen.breaker.remainingOpenMs / 1000).toFixed(1)}s</em>
                  )}
                </span>
                {i < STATES.length - 1 && <span className="fg__arrow">{'<->'}</span>}
              </span>
            ))}
          </div>
          <div className="fg__window" aria-label="failure window">
            {Array.from({ length: 20 }, (_, i) => {
              const o = chosen.breaker.outcomes[i];
              return <span key={i} className="fg__cell" data-v={o === undefined ? 'none' : o ? 'ok' : 'fail'} />;
            })}
          </div>
          <div className="fg__row">
            <button className="demo__btn demo__btn--ghost fg__small" onClick={() => record(false)}>Record failure</button>
            <button className="demo__btn demo__btn--ghost fg__small" onClick={() => record(true)}>Record success</button>
          </div>
          <p className="fg__note mono">
            {chosen.breaker.requests} in window, {Math.round(chosen.breaker.failureRate * 100)}% failed,{' '}
            {chosen.breaker.consecutive} consecutive. {snap.breakerNote}
          </p>
          <ul className="fg__trans mono">
            {chosen.breaker.transitions.length === 0 && <li className="fg__trans-empty">no transitions</li>}
            {chosen.breaker.transitions.slice(-5).map((t, i) => (
              <li key={i}>
                {t.from.replace('_', '-')} {'->'} {t.to.replace('_', '-')}
              </li>
            ))}
          </ul>
        </div>

        <div className="fg__panel fg__panel--wide">
          <div className="fg__panel-head">
            <span className="fg__panel-title">/metrics</span>
            <span className="fg__panel-meta">Prometheus exposition, scraped by the Grafana dashboard</span>
          </div>
          <ul className="fg__metrics mono">
            {snap.metrics.map((m) => (
              <li key={m.name} className="fg__metric" data-pinned={m.pinned === true}>
                <span className="fg__metric-name">{m.name}</span>
                <span className="fg__metric-val">{m.value}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={start} disabled={snap.running}>
          {snap.running ? 'Running chaos…' : snap.finished ? 'Run again' : 'Start chaos run'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">
          {snap.finished
            ? 'same seed, same kills, same 0'
            : `seeded run, ${CHAOS.totalRequests} requests when complete`}
        </span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  unit,
  pinned,
  bad,
}: {
  label: string;
  value: number | string;
  sub?: string;
  unit?: string;
  pinned?: boolean;
  bad?: boolean;
}) {
  return (
    <div className="fg__stat" data-pinned={pinned === true} data-bad={bad === true}>
      <span className="fg__stat-label">{label}</span>
      <span className="fg__stat-val">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {sub && <span className="fg__stat-sub">{sub}</span>}
    </div>
  );
}
