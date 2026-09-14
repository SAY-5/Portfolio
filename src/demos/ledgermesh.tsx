import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './ledgermesh.css';
import { CHAOS, ChaosSession, type BreakerSnap, type ServiceSnap, type Snap } from './ledgermesh/sim';

// Real mechanism from ledgermesh: each service writes its state change and the
// event announcing it in one database transaction (the outbox), a relay
// publishes outbox rows to Kafka and stamps them only after the broker ack,
// and consumers record a processed marker per event id in the same
// transaction as their work, so redeliveries after a kill are ignored. The
// order saga moves PENDING to RESERVED to CONFIRMED or CANCELLED; the stock
// check sits behind a circuit breaker and a time limiter, and payment
// authorization runs Retry(CircuitBreaker(TimeLimiter(call))) and defers the
// payment instead of failing it. The load, the kill schedule and the payment
// processor all come from one seed, so every run reports the same figures.
const TICK_MS = 100;
const SPEEDS = [1, 2, 4, 8];
const STATES = ['CLOSED', 'OPEN', 'HALF_OPEN'] as const;

function ensure(ref: { current: ChaosSession | null }): ChaosSession {
  if (!ref.current) ref.current = new ChaosSession();
  return ref.current;
}

function short(name: string): string {
  return name.replace('-service', '');
}

function serviceState(s: ServiceSnap): string {
  if (!s.alive) return 'killed';
  if (!s.ready) return 'booting';
  return 'up';
}

function statusLine(snap: Snap): string {
  const t = (Math.min(snap.now, CHAOS.durationMs) / 1000).toFixed(1);
  if (snap.phase === 'idle') return `ready: seed ${CHAOS.seed}, ${CHAOS.rate} orders/s for ${CHAOS.durationMs / 1000} s`;
  if (snap.phase === 'done') return `settled at t+${(snap.now / 1000).toFixed(1)} s: ${snap.stats.submitted} orders, ${snap.stats.failed} failed or stuck`;
  const prefix = snap.paused ? 'paused, ' : '';
  if (snap.phase === 'draining') return `${prefix}load done, draining ${snap.inFlight} open orders`;
  return `${prefix}load t+${t} s, ${snap.stats.submitted} submitted, ${snap.inFlight} in flight`;
}

export default function LedgermeshDemo() {
  const reduce = useReducedMotion();
  const ref = useRef<ChaosSession | null>(null);
  const [snap, setSnap] = useState<Snap>(() => new ChaosSession().snapshot());
  const [speed, setSpeed] = useState(2);

  useEffect(() => {
    let seen = -1;
    const id = window.setInterval(() => {
      const s = ensure(ref);
      s.advance(TICK_MS * speed);
      if (s.version !== seen) {
        seen = s.version;
        setSnap(s.snapshot());
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [speed]);

  function act(fn: (s: ChaosSession) => void) {
    const s = ensure(ref);
    fn(s);
    setSnap(s.snapshot());
  }

  function reset(start: boolean) {
    const s = new ChaosSession();
    if (start) s.start();
    ref.current = s;
    setSnap(s.snapshot());
  }

  const st = snap.stats;
  const end = Math.max(CHAOS.durationMs * 1.25, snap.now + 2000);
  const pct = (ms: number) => `${Math.max(0, Math.min(100, (ms / end) * 100))}%`;
  const primary =
    snap.phase === 'idle'
      ? { label: 'Start chaos run', run: () => act((s) => s.start()) }
      : snap.phase === 'done'
        ? { label: 'Run again', run: () => reset(true) }
        : { label: snap.paused ? 'Resume' : 'Pause', run: () => act((s) => s.togglePause()) };

  return (
    <div className="demo lm" data-motion={reduce ? 'reduced' : 'full'} aria-label="ledgermesh saga chaos demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Outbox, saga and breakers under kills</h3>
      <p className="demo__lede">
        Start the chaos run: {CHAOS.rate} orders per second for {CHAOS.durationMs / 1000} s through the order, inventory
        and payment services, with three kills spread across the window and a restart after {CHAOS.restartAfterMs / 1000} s.
        Kill any service by hand at any point. Orders wait in the outbox or on a topic instead of failing, payments defer
        instead of failing, and the failed / stuck counter stays at 0.
      </p>

      <div className="lm__status mono" aria-live="polite">
        <span className="lm__dot" data-phase={snap.phase} data-paused={snap.paused} />
        {statusLine(snap)}
      </div>

      <div className="lm__stage">
        <section className="lm__panel lm__panel--wide" aria-label="Services">
          <div className="lm__head">
            <span className="lm__title">services</span>
            <span className="lm__meta">outbox poll 200 ms, 3 consumers per topic, boot 2.5 s after restart</span>
          </div>
          <div className="lm__services">
            {snap.services.map((s) => (
              <div key={s.name} className="lm__svc" data-state={serviceState(s)}>
                <div className="lm__svc-head">
                  <span className="lm__svc-name mono">{s.name}</span>
                  <span className="lm__svc-state mono">{serviceState(s)}</span>
                </div>
                <p className="lm__svc-note mono">{s.note}</p>
                <dl className="lm__kv mono">
                  <div>
                    <dt>outbox</dt>
                    <dd>{s.outbox}</dd>
                  </div>
                  <div>
                    <dt>relay</dt>
                    <dd>{s.relay}</dd>
                  </div>
                  <div>
                    <dt>lag</dt>
                    <dd>{s.lag}</dd>
                  </div>
                  <div>
                    <dt>restarts</dt>
                    <dd>{s.restarts}</dd>
                  </div>
                </dl>
                <button className="lm__kill mono" onClick={() => act((x) => x.kill(s.name))} disabled={!s.alive || snap.phase === 'done'}>
                  kill {short(s.name)}
                </button>
              </div>
            ))}
          </div>
          <ul className="lm__topics mono" aria-label="Topic lag">
            {snap.topics.map((t) => (
              <li key={t.name} data-busy={t.lag > 0}>
                {t.name} <b>{t.lag}</b>
              </li>
            ))}
          </ul>
          <p className="lm__note mono">
            The scheduled kills pick inventory or payment, as chaos/run.sh does. order-service is the entry point: while it
            is down POST /orders is refused, and the harness counts refused submissions as failed.
          </p>
        </section>

        <section className="lm__panel lm__panel--wide" aria-label="Saga counters">
          <div className="lm__head">
            <span className="lm__title">saga counters</span>
            <span className="lm__meta">
              {snap.inFlight} in flight, {snap.openPayments} open payments, stock probes live {st.stockProbes.live} / cache {st.stockProbes.cache}
            </span>
          </div>
          <div className="lm__stats">
            <Stat label="submitted" value={st.submitted} />
            <Stat label="confirmed" value={st.confirmed} />
            <Stat label="cancelled (stock)" value={st.cancelledStock} sub="SKU-SCARCE starts at 40 units" />
            <Stat label="failed / stuck" value={st.failed} pinned bad={st.failed > 0} sub={st.refused ? `${st.refused} refused at POST /orders` : 'held at 0'} />
            <Stat label="deferred payments" value={st.deferred} sub="picked up again by the sweeper" />
            <Stat label="retried, then ok" value={st.retries.successful_with_retry} sub={`${st.retries.failed_with_retry} exhausted, ${st.retries.failed_without_retry} not permitted`} />
            <Stat label="duplicates ignored" value={st.duplicates} />
            <Stat label="outbox backlog" value={st.outboxBacklog} />
            <Stat label="saga p50 / p95" value={`${(st.p50 / 1000).toFixed(1)} / ${(st.p95 / 1000).toFixed(1)}`} unit="s" />
          </div>
        </section>

        {snap.breakers.map((b) => (
          <Breaker key={b.owner} b={b} snap={snap} onFault={() => act((s) => s.setProcessorFault(!s.processorFault))} />
        ))}

        <section className="lm__panel" aria-label="Saga stream">
          <div className="lm__head">
            <span className="lm__title">saga stream</span>
            <span className="lm__meta">latest orders to reach a terminal state</span>
          </div>
          <ul className="lm__orders mono">
            {snap.recent.length === 0 && <li className="lm__empty">settled orders appear here once the run starts</li>}
            {snap.recent.map((o) => (
              <li key={o.id} data-status={o.path[o.path.length - 1]}>
                <span className="lm__ord-id">{o.id.slice(4, 12)}</span>
                <span className="lm__ord-path">
                  {o.path.join(' > ')}
                  {o.reason ? ` (${o.reason})` : ''}
                </span>
                <span className="lm__ord-meta">
                  {o.sku} x{o.quantity}, {(o.ms / 1000).toFixed(2)} s
                </span>
              </li>
            ))}
          </ul>
          {snap.lastStockout && (
            <p className="lm__note mono">
              last out of stock: {snap.lastStockout.id.slice(4, 12)} {snap.lastStockout.sku} x{snap.lastStockout.quantity} at t+
              {(snap.lastStockout.at / 1000).toFixed(1)} s, no stock touched
            </p>
          )}
        </section>

        <section className="lm__panel" aria-label="Notable events">
          <div className="lm__head">
            <span className="lm__title">notable events</span>
            <span className="lm__meta">kills, breakers, redeliveries, deferrals</span>
          </div>
          <ol className="lm__log mono">
            {snap.log.length === 0 && <li className="lm__empty">kills, breaker transitions and ignored duplicates appear here</li>}
            {snap.log.map((t, i) => (
              <li key={`${t.t}-${t.kind}-${i}`} data-kind={t.kind}>
                <span className="lm__at">{(t.t / 1000).toFixed(1)}s</span>
                <span className="lm__src">{short(t.source)}</span>
                <span className="lm__txt">{t.text}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="lm__panel lm__panel--wide" aria-label="Chaos summary">
          <div className="lm__head">
            <span className="lm__title">chaos summary</span>
            <span className="lm__meta">
              load ends at {CHAOS.durationMs / 1000} s, then the stack drains until every order is terminal
            </span>
          </div>
          <div className="lm__track" aria-label="Kill timeline">
            <span className="lm__track-load" style={{ width: pct(Math.min(snap.now, CHAOS.durationMs)) }} />
            <span className="lm__track-drain" style={{ left: pct(CHAOS.durationMs), width: pct(Math.max(0, snap.now - CHAOS.durationMs)) }} />
            {snap.kills.map((k) => (
              <span key={`${k.service}-${k.at}`} className="lm__outage" style={{ left: pct(k.at), width: pct(k.readyAt - k.at) }} />
            ))}
            <span className="lm__cursor" style={{ left: pct(snap.now) }} />
          </div>
          <p className="lm__track-labels mono">
            {snap.kills.length === 0
              ? `scheduled: ${snap.plan.map((k) => `${short(k.service)} @${k.at / 1000}s`).join(', ')}`
              : `kills: ${snap.kills.map((k) => `${short(k.service)} @${Math.round(k.at / 1000)}s, ready @${(k.readyAt / 1000).toFixed(1)}s`).join('; ')}`}
          </p>
          <pre className="lm__summary mono">{snap.summary}</pre>
          {snap.phase === 'done' && (
            <p className="lm__verdict" data-pass={st.failed === 0}>
              {st.failed === 0 ? `PASS: 0 failed or stuck across ${st.kills.length} kills` : `FAIL: ${st.failed} failed or stuck`}
            </p>
          )}
        </section>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={primary.run}>
          {primary.label}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={() => reset(false)}>
          Reset
        </button>
        <div className="lm__speeds" role="group" aria-label="Simulation speed">
          {SPEEDS.map((x) => (
            <button key={x} className="lm__speed mono" data-on={speed === x} aria-pressed={speed === x} onClick={() => setSpeed(x)}>
              {x}x
            </button>
          ))}
        </div>
        <label className="lm__toggle mono">
          <input type="checkbox" checked={snap.autoChaos} onChange={() => act((s) => s.setAutoChaos(!s.autoChaos))} /> scheduled kills
        </label>
        <span className="demo__hint">
          {snap.phase === 'done' ? 'same seed, same kills, same 0' : '1200 orders and 3 kills when complete'}
        </span>
      </div>
    </div>
  );
}

function Breaker({ b, snap, onFault }: { b: BreakerSnap; snap: Snap; onFault: () => void }) {
  const log = snap.breakerLog.filter((t) => t.owner === b.owner).slice(-4).reverse();
  const note =
    b.state === 'OPEN'
      ? `calls not permitted, half-open in ${(b.reopensInMs / 1000).toFixed(1)} s`
      : b.state === 'HALF_OPEN'
        ? `${b.trials.length} of ${b.permitted} trial calls answered`
        : `${b.window.length} calls in window, ${b.failureRate.toFixed(0)}% failed`;
  return (
    <section className="lm__panel" aria-label={`${b.owner} circuit breaker`}>
      <div className="lm__head">
        <span className="lm__title">{b.owner === 'inventory' ? 'breaker: order to inventory' : 'breaker: payment to processor'}</span>
        <span className="lm__meta">
          window {b.size}, min {b.minCalls}, opens at {b.threshold}%, open {b.waitMs / 1000} s, {b.permitted} trials
        </span>
      </div>
      <div className="lm__machine">
        {STATES.map((s, i) => (
          <span key={s} className="lm__state-wrap">
            <span className="lm__state mono" data-on={b.state === s} data-state={s}>
              {s.replace('_', '-')}
            </span>
            {i < STATES.length - 1 && <span className="lm__arrow mono">{'->'}</span>}
          </span>
        ))}
      </div>
      <div className="lm__window" aria-label="Call outcomes in the sliding window">
        {Array.from({ length: b.size }, (_, i) => {
          const v = b.window[i];
          return <span key={i} className="lm__cell" data-v={v === undefined ? 'none' : v ? 'ok' : 'fail'} />;
        })}
      </div>
      <p className="lm__note mono">
        {note}.{' '}
        {b.owner === 'inventory'
          ? 'Fallback: the last live stock value for the sku.'
          : 'Fallback: the payment is deferred and the sweeper retries it.'}
      </p>
      {b.owner === 'processor' && (
        <label className="lm__toggle mono">
          <input type="checkbox" checked={snap.processorFault} onChange={onFault} /> processor answers transient faults
        </label>
      )}
      <ul className="lm__trans mono">
        {log.length === 0 && <li className="lm__empty">no transitions yet</li>}
        {log.map((t, i) => (
          <li key={`${t.at}-${i}`}>
            <span className="lm__at">t+{(t.at / 1000).toFixed(1)}s</span> {t.from.replace('_', '-')} {'->'} {t.to.replace('_', '-')}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value, sub, unit, pinned, bad }: { label: string; value: number | string; sub?: string; unit?: string; pinned?: boolean; bad?: boolean }) {
  return (
    <div className="lm__stat" data-pinned={pinned === true} data-bad={bad === true}>
      <span className="lm__stat-label">{label}</span>
      <span className="lm__stat-val">
        {typeof value === 'number' ? value.toLocaleString('en-US') : value}
        {unit && <small>{unit}</small>}
      </span>
      {sub && <span className="lm__stat-sub">{sub}</span>}
    </div>
  );
}
