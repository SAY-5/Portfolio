import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './launchbridge.css';
import { BENCH, BridgeSim, BURST, type BridgeSnap, type Tamper, type TimelineSnap } from './launchbridge/sim';
import { DESTINATIONS } from './launchbridge/delivery';
import { COMPUTED_LABEL, MEASURED, MEASURED_LABEL, MEASURED_LATENCY } from './launchbridge/provenance';
import { STEP_LABELS, STEP_ORDER } from './launchbridge/service';

// Real mechanism from launchbridge, in the service's order. api.py refuses a
// body over 1 MB with 413 before anything else is read. A source signs
// `<unix seconds>.<raw body>` with HMAC-SHA256; the service checks the
// timestamp against a 300 s window, compares the digest in constant time,
// writes the signature into the signature_nonces store (a repeat is 409
// whether its first arrival was accepted or deduplicated), then inserts
// (source, event_key) into the processed_events ledger with ON CONFLICT DO
// NOTHING so a re-send becomes a no-op. An accepted event fans out to every
// destination whose routing rules match (sources, event_types globs and when
// predicates from destinations.yaml), and each delivery carries that
// destination's transformed payload. The worker posts signed envelopes,
// retries 408, 425, 429 and 5xx with exponential backoff and 20 percent jitter
// up to a bounded attempt count, and a failed delivery can be replayed as a
// new series with the same idempotency key. The per-destination rate limit and
// circuit breaker gate is not ported, and the page says so. Clocks are virtual
// and the PRNG is seeded.
const TICK_MS = 100;
const BENCH_MS_PER_TICK = 200;
const PHASES = ['first-pass', 'duplicates', 'rejections', 'settling', 'replay', 'resettling', 'done'] as const;
const NO_TAMPER: Tamper = { flipByte: false, wrongSecret: false, stale: false, oversize: false };

function ensure(ref: { current: BridgeSim | null }): BridgeSim {
  if (!ref.current) ref.current = new BridgeSim();
  return ref.current;
}

function statusText(status: number, error: string | null, deliveries: number): string {
  if (status === 202) return `202 Accepted, ${deliveries} ${deliveries === 1 ? 'delivery' : 'deliveries'} enqueued`;
  if (status === 200) return '200 OK, deduplicated: true, no deliveries';
  return `${status} ${error ?? ''}`;
}

export default function LaunchbridgeDemo() {
  const reduce = useReducedMotion();
  const ref = useRef<BridgeSim | null>(null);
  const [snap, setSnap] = useState<BridgeSnap>(() => new BridgeSim().snapshot());
  const [tamper, setTamper] = useState<Tamper>(NO_TAMPER);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    let seen = -1;
    const id = window.setInterval(() => {
      const s = ensure(ref);
      s.tick(BENCH_MS_PER_TICK, speed);
      if (s.version !== seen) {
        seen = s.version;
        setSnap(s.snapshot());
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [speed]);

  function act(fn: (s: BridgeSim) => void) {
    const s = ensure(ref);
    fn(s);
    setSnap(s.snapshot());
  }

  function reset() {
    ref.current = new BridgeSim();
    setTamper(NO_TAMPER);
    setSnap(ref.current.snapshot());
  }

  const last = snap.last;
  const failedStep = last?.steps.find((s) => !s.ok)?.id;
  const b = snap.burst;
  const bs = b?.stats;
  const open = bs ? bs.deliveries.pending + bs.deliveries.in_progress : 0;
  const burstStatus = !b ? 'idle, the burst has not run' : b.phase === 'done' ? `done, ${b.posted} posted, ${bs?.deliveries.delivered ?? 0} delivered` : `${b.phase}, ${b.posted} posted, ${open} open`;
  const toggle = (key: keyof Tamper) => setTamper((t) => ({ ...t, [key]: !t[key] }));

  return (
    <div className="demo lb" data-motion={reduce ? 'reduced' : 'full'} aria-label="launchbridge webhook demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Signed, deduplicated, routed, retried, replayed</h3>
      <p className="demo__lede">
        Sign a webhook and send it, then pad the body past the limit, flip a byte in transit, sign with the wrong secret,
        backdate the timestamp or replay a captured request: each one stops at a named verification step. Re-sending the
        same event id is accepted once and deduplicated after, and replaying either request is refused by the nonce store.
        Routing rules decide which destinations an event reaches, deliveries retry with jittered backoff until they land or
        run out of attempts, and the burst run pushes {BURST.total} events through the same path.
      </p>

      <div className="lb__stage">
        <section className="lb__panel lb__panel--wide" aria-label="Signed webhook">
          <div className="lb__head">
            <span className="lb__title">POST /webhooks/{BENCH.source}</span>
            <span className="lb__meta">
              secret orders-dev-secret, tolerance {BENCH.tolerance} s, body limit {BENCH.bodyLimit.toLocaleString('en-US')} bytes; routed by source, event type and predicates
              (destinations.yaml)
            </span>
          </div>
          <div className="lb__bench">
            <div className="lb__compose">
              <span className="lb__label">next payload</span>
              <pre className="lb__code mono">{snap.nextPayload}</pre>
              <div className="lb__checks mono">
                <label>
                  <input type="checkbox" checked={snap.typed} onChange={() => act((s) => s.setTyped(!s.typed))} /> payload carries type {BENCH.eventType} (billing routes on
                  order.*)
                </label>
              </div>
              <span className="lb__label lb__label--gap">tamper after signing</span>
              <div className="lb__checks mono">
                <label>
                  <input type="checkbox" checked={tamper.oversize} onChange={() => toggle('oversize')} /> pad the body past {BENCH.bodyLimit.toLocaleString('en-US')} bytes
                </label>
                <label>
                  <input type="checkbox" checked={tamper.flipByte} onChange={() => toggle('flipByte')} /> flip one byte in transit
                </label>
                <label>
                  <input type="checkbox" checked={tamper.wrongSecret} onChange={() => toggle('wrongSecret')} /> sign with the wrong secret
                </label>
                <label>
                  <input type="checkbox" checked={tamper.stale} onChange={() => toggle('stale')} /> timestamp {BENCH.staleSeconds} s old
                </label>
              </div>
              <div className="lb__row">
                <button className="demo__btn lb__small" onClick={() => act((s) => s.send(tamper))}>
                  Sign and send
                </button>
                <button className="demo__btn demo__btn--ghost lb__small" onClick={() => act((s) => s.replay())} disabled={!snap.canReplay}>
                  Replay last request
                </button>
                <button className="demo__btn demo__btn--ghost lb__small" onClick={() => act((s) => s.resend())} disabled={!snap.canReplay}>
                  Re-send same event id
                </button>
              </div>
              {last && (
                <dl className="lb__headers mono">
                  <dt>X-Timestamp</dt>
                  <dd>{last.timestamp}</dd>
                  <dt>X-Signature</dt>
                  <dd>{last.signature.slice(0, 26)}...</dd>
                  {last.expected && last.expected !== last.signature && (
                    <>
                      <dt>expected</dt>
                      <dd className="lb__bad">{last.expected.slice(0, 26)}...</dd>
                    </>
                  )}
                  <dt>body</dt>
                  <dd>{last.body}</dd>
                  {last.flipped && (
                    <>
                      <dt>in transit</dt>
                      <dd className="lb__bad">{last.flipped}</dd>
                    </>
                  )}
                </dl>
              )}
            </div>
            <div className="lb__verify">
              <span className="lb__label">{last ? last.label : 'verification runs in this order'}</span>
              <ol className="lb__steps mono">
                {STEP_ORDER.map((id, i) => {
                  const step = last?.steps.find((s) => s.id === id);
                  const state = !step ? 'skipped' : step.ok ? 'ok' : 'fail';
                  return (
                    <li key={id} data-state={last ? state : 'idle'}>
                      <span className="lb__step-n">{i}</span>
                      <span className="lb__step-name">{STEP_LABELS[id]}</span>
                      <span className="lb__step-detail">{step ? step.detail : last ? 'not reached' : ''}</span>
                    </li>
                  );
                })}
              </ol>
              {last && (
                <p className="lb__response mono" data-ok={last.status < 300} aria-live="polite">
                  {statusText(last.status, last.error, last.deliveries)}
                  {failedStep ? `, stopped at step ${STEP_ORDER.indexOf(failedStep)}` : ''}
                </p>
              )}
              {last && last.decisions.length > 0 && (
                <>
                  <span className="lb__label lb__label--gap">registry.route(source, payload)</span>
                  <ul className="lb__routes mono" aria-label="Routing decisions">
                    {last.decisions.map((d) => (
                      <li key={d.destination} data-routed={d.routed}>
                        <span>{d.destination}</span>
                        <span>{d.routed ? 'matched, delivery enqueued' : d.reason}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
          <div className="lb__ledger">
            <div className="lb__counts mono">
              <span>
                accepted <b>{snap.counts.accepted}</b>
              </span>
              <span>
                deduplicated <b>{snap.counts.deduplicated}</b>
              </span>
              {Object.entries(snap.counts.rejected).map(([reason, n]) => (
                <span key={reason}>
                  {reason} <b className="lb__bad">{n}</b>
                </span>
              ))}
            </div>
            <ul className="lb__rows mono" aria-label="processed_events ledger">
              {snap.ledger.length === 0 && (
                <li className="lb__empty">processed_events rows appear here: (source, event_key) unique; signature_nonces, written first, refuses a replayed signature</li>
              )}
              {snap.ledger.map((row) => (
                <li key={row.signature}>
                  <span>{BENCH.source}</span>
                  <span>{row.key}</span>
                  <span className="lb__faint">sig {row.signature}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lb__panel lb__panel--wide" aria-label="Delivery attempts">
          <div className="lb__head">
            <span className="lb__title">delivery attempts</span>
            <span className="lb__meta">
              {DESTINATIONS.map((d) => `${d.name}: ${d.retry.maxAttempts} attempts, ${d.retry.baseDelaySeconds} s doubling to ${d.retry.maxDelaySeconds} s, jitter ${d.retry.jitter * 100}%`).join('; ')}
              . Rate limit and circuit breaker gate not ported: the service defers rather than fails when either trips, this page never defers.
            </span>
          </div>
          <div className="lb__row">
            <label className="lb__toggle mono">
              <input type="checkbox" checked={snap.down} onChange={() => act((s) => s.setDown(!s.down))} /> destinations answer 503 for new events
            </label>
            <button className="demo__btn demo__btn--ghost lb__small" onClick={() => act((s) => s.replayFailed())} disabled={snap.counts.failed === 0}>
              Replay failed deliveries ({snap.counts.failed})
            </button>
          </div>
          <div className="lb__chips" role="group" aria-label="Delivery">
            {snap.choices.length === 0 && <span className="lb__empty">send an event or run the burst to get deliveries</span>}
            {snap.choices.map((c) => (
              <button
                key={c.id}
                className="lb__chip mono"
                data-on={snap.timeline?.id === c.id}
                aria-pressed={snap.timeline?.id === c.id}
                data-status={c.status}
                onClick={() => act((s) => s.select(c.id))}
              >
                {c.label} <em>{c.status}</em>
              </button>
            ))}
          </div>
          {snap.timeline && <Timeline t={snap.timeline} />}
        </section>

        <section className="lb__panel lb__panel--wide" aria-label="Burst run">
          <div className="lb__head">
            <span className="lb__title">burst run</span>
            <span className="lb__meta">
              {BURST.total} events: {BURST.total - BURST.duplicates} unique, {BURST.duplicates} re-sends, {BURST.hard} answered 400, {BURST.flaky} answered 503 twice, {BURST.badSignatures} bad signatures
            </span>
          </div>
          <div className="lb__row">
            <button className="demo__btn lb__small" onClick={() => act((s) => s.startBurst())} disabled={snap.burstRunning}>
              {snap.burstRunning ? 'Running burst' : b?.phase === 'done' ? 'Run burst again' : 'Start burst'}
            </button>
            <div className="lb__speeds" role="group" aria-label="Burst speed">
              {[1, 2, 4].map((x) => (
                <button key={x} className="lb__speed mono" data-on={speed === x} aria-pressed={speed === x} onClick={() => setSpeed(x)}>
                  {x}x
                </button>
              ))}
            </div>
          </div>
          <div className="lb__status mono" aria-live="polite">
            <span className="lb__status-dot" data-live={snap.burstRunning} />
            {burstStatus}
          </div>
          <ol className="lb__phases mono" aria-label="Burst phases">
            {PHASES.map((ph) => {
              const at = b ? PHASES.indexOf(b.phase as (typeof PHASES)[number]) : -1;
              const i = PHASES.indexOf(ph);
              return (
                <li key={ph} data-state={at === -1 ? 'idle' : i < at || b?.phase === 'done' ? 'done' : i === at ? 'now' : 'idle'}>
                  {ph}
                </li>
              );
            })}
          </ol>
          <div className="lb__stats">
            <Stat label="received" value={bs?.events.received ?? 0} sub={`${b?.posted ?? 0} posted; README run ${MEASURED.counts.received}`} />
            <Stat label="deduplicated" value={bs?.events.deduplicated ?? 0} sub={`README run ${MEASURED.counts.deduplicated}`} />
            <Stat
              label="signature rejections"
              value={bs?.signature_rejections ?? 0}
              sub={b?.rejectionStatuses.length ? `statuses ${b.rejectionStatuses.join(', ')}; README run ${MEASURED.counts.signatureRejections}` : `wrong secret, stale, replay; README run ${MEASURED.counts.signatureRejections}`}
            />
            <Stat label="delivered" value={bs?.deliveries.delivered ?? 0} sub={`README run ${MEASURED.counts.delivered}`} />
            <Stat label="retried" value={bs?.retries ?? 0} sub={`attempts beyond the first; README run ${MEASURED.counts.retried}`} />
            <Stat
              label="failed then replayed"
              value={`${b?.failedFirstPass ?? bs?.deliveries.failed ?? 0} / ${bs?.replays.delivered ?? 0}`}
              sub={`README run ${MEASURED.counts.failed} / ${MEASURED.counts.replayed}`}
            />
            <Stat
              label="dispatch p50 / p95, simulated"
              value={bs?.latency_ms.p50 != null ? `${bs.latency_ms.p50} / ${bs.latency_ms.p95 ?? '-'}` : '-'}
              sub={`virtual clock, ms. ${MEASURED_LABEL}: ${MEASURED_LATENCY}, ${MEASURED.loadCaveat}`}
            />
            <Stat label="left failed" value={b?.phase === 'done' ? (bs?.deliveries.failed ?? 0) : '-'} sub={`must be 0; README run ${MEASURED.counts.stillFailed}`} pinned bad={b?.phase === 'done' && (bs?.deliveries.failed ?? 0) > 0} />
          </div>
          {b?.phase === 'done' && (
            <>
              <p className="lb__note mono">
                {COMPUTED_LABEL}. The counts match the README run ({MEASURED_LABEL}); its durations do not: that run measured {MEASURED_LATENCY}, and its README says every
                duration {MEASURED.loadCaveat}. 6 of the README run&apos;s 8 checks run here; the smoke suite, /ops/overview and the ingest-rate line are not simulated, so those
                lines and the two checks that read them are marked not simulated. No delivery here is deferred, because the rate limit and circuit breaker gate is not ported.
              </p>
              <pre className="lb__summary mono">
                {b.lines.map((line, i) => (
                  <span key={i} className="lb__line">
                    {line}
                  </span>
                ))}
              </pre>
              <p className="lb__verdict" data-pass={b.checks.every((c) => c.ok)}>
                {b.checks.every((c) => c.ok) ? `PASS: ${b.checks.length} of ${b.checks.length} simulated checks (the README run has ${MEASURED.counts.checks}), 0 left failed` : 'FAIL: a check did not hold'}
              </p>
            </>
          )}
        </section>
      </div>

      <div className="demo__controls">
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">seeded PRNG, virtual clocks: the burst reproduces its counts and backoffs every run; bench timestamps move with deliveries and by 1 s per action</span>
      </div>
    </div>
  );
}

function Timeline({ t }: { t: TimelineSnap }) {
  const segments: { kind: 'attempt' | 'backoff'; ms: number; label: string; state: string }[] = [];
  for (const a of t.attempts) {
    segments.push({ kind: 'attempt', ms: a.durationMs, label: `${a.status}`, state: a.outcome });
    if (a.backoffMs !== null) segments.push({ kind: 'backoff', ms: a.backoffMs, label: `${a.backoffMs} ms`, state: 'wait' });
  }
  const total = segments.reduce((n, s) => n + s.ms, 0) || 1;
  const verdict =
    t.status === 'delivered'
      ? `delivered after ${t.attempts.length} attempt${t.attempts.length === 1 ? '' : 's'}`
      : t.status === 'failed'
        ? t.attempts[t.attempts.length - 1]?.outcome === 'permanent'
          ? `failed: ${t.attempts[t.attempts.length - 1]?.status} is not retryable`
          : `failed: retries exhausted after ${t.attempts.length} of ${t.maxAttempts}`
        : t.status === 'replayed'
          ? 'failed, then replayed as a new series'
          : t.nextInMs !== null
            ? `pending, attempt ${t.attempts.length + 1} in ${(t.nextInMs / 1000).toFixed(1)} s`
            : t.status;
  return (
    <div className="lb__timeline">
      <div className="lb__tl-head mono">
        <span>
          {t.destination}, series {t.series}, key {t.key.slice(0, 8)}...:{t.destination}
        </span>
        <b data-status={t.status}>{verdict}</b>
      </div>
      <p className="lb__tl-payload mono">
        <span className="lb__faint">{t.transform ? `envelope payload, transformed for ${t.destination} (${t.transform}): ` : 'envelope payload, passed through unchanged: '}</span>
        {t.payload}
      </p>
      <div className="lb__track" aria-label="Attempts and backoff, to scale">
        {segments.length === 0 && <span className="lb__empty">claimed on the next worker poll</span>}
        {segments.map((s, i) => (
          <span key={i} className="lb__seg" data-kind={s.kind} data-state={s.state} style={{ flexGrow: Math.max(s.ms, total * 0.04) }} title={s.label}>
            {s.kind === 'attempt' ? s.label : ''}
          </span>
        ))}
      </div>
      <ol className="lb__attempts mono">
        {t.attempts.map((a) => (
          <li key={a.n} data-outcome={a.outcome}>
            <span className="lb__faint">#{a.n} t+{a.offsetMs} ms</span>
            <span>
              HTTP {a.status} in {a.durationMs} ms, {a.outcome}
            </span>
            <span className="lb__faint">
              {a.backoffMs !== null ? `backoff ${a.backoffMs} ms (base ${a.baseMs} ms, jitter within 20%)` : 'no retry scheduled'}
            </span>
          </li>
        ))}
      </ol>
      {t.attempts.length > 0 && <p className="lb__note mono">Round trips and backoffs run on the virtual clock.</p>}
    </div>
  );
}

function Stat({ label, value, sub, pinned, bad }: { label: string; value: number | string; sub?: string; pinned?: boolean; bad?: boolean }) {
  return (
    <div className="lb__stat" data-pinned={pinned === true} data-bad={bad === true}>
      <span className="lb__stat-label">{label}</span>
      <span className="lb__stat-val">{value}</span>
      {sub && <span className="lb__stat-sub">{sub}</span>}
    </div>
  );
}
