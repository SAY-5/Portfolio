import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './conduit.css';
import { ConduitSim, TICK_MS, type Snap } from './conduit/sim';
import { RUN_ID, UNIQUE_PER_CONNECTOR } from './conduit/engine';
import { NEW_CONNECTOR_NAME, NEW_CONNECTOR_YAML } from './conduit/specs';
import type { BreakerState } from './conduit/throttle';

// Real mechanism from conduit: every task is enqueued on its connector's SQS
// work queue with an idempotency key, sha256 of connector, task id and
// revision. The worker checks the payload against the source schema and the
// mapping rules (a misfit goes to the quarantine queue), claims the key with
// a conditional put (a delivered key is acknowledged as deduplicated), takes
// a token from the connector's bucket, and delivers with full-jitter retries.
// A failed delivery is never acknowledged, so SQS redrives it into the DLQ
// after maxReceiveCount receives, and target failures feed a breaker that
// stops the worker polling. Terraform reads the same YAML files. The run uses
// a seeded PRNG and one virtual clock per worker, so every run reports 300
// submitted, 60 deduplicated, 60 retried and 10 dead-lettered then replayed.
const STATES: BreakerState[] = ['closed', 'open', 'half_open'];

function statusLine(s: Snap): string {
  const queued = s.lanes.reduce((n, l) => n + l.queued + l.inFlight, 0);
  switch (s.phase) {
    case 'draining':
      return `make demo t+${s.wall.toFixed(1)}s, ${queued} messages on the work queues`;
    case 'clearing':
      return 'queues drained, clearing the webhook fault';
    case 'replaying':
      return `replaying dead letters onto conduit-webhook-crm, t+${s.wall.toFixed(1)}s`;
    case 'done':
      return s.breaker.outage
        ? `outage on webhook-crm, breaker ${s.breaker.state.replace('_', '-')}`
        : `run complete: ${s.summary?.deliveredAfter ?? 0} delivered, ${s.summary?.deduplicated ?? 0} deduplicated, DLQ ${s.deadLetters.length}`;
    default:
      return 'ready';
  }
}

export default function ConduitDemo() {
  const reduce = useReducedMotion();
  const simRef = useRef<ConduitSim | null>(null);
  const [snap, setSnap] = useState<Snap>(() => new ConduitSim().snapshot());

  function sim(): ConduitSim {
    if (!simRef.current) simRef.current = new ConduitSim();
    return simRef.current;
  }

  useEffect(() => {
    const id = window.setInterval(() => {
      const s = sim();
      s.tick();
      setSnap(s.snapshot());
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  function act(fn: (s: ConduitSim) => void) {
    const s = sim();
    fn(s);
    if (reduce && s.run.busy) {
      let guard = 0;
      while (s.run.busy && guard++ < 2000) s.tick();
    }
    setSnap(s.snapshot());
  }

  const sum = snap.summary;
  const b = snap.bucket;
  const br = snap.breaker;
  const tokenPct = Math.max(0, Math.min(100, (b.tokens / b.capacity) * 100));
  const dedupPer = Object.fromEntries(snap.lanes.map((l) => [l.name, l.dedup]));
  const summaryText = sum
    ? [
        `tasks submitted        ${sum.submitted}  (${sum.unique} unique + ${sum.duplicates} duplicate resubmits)`,
        `deduplicated           ${sum.deduplicated}  (must equal duplicates: ${sum.deduplicated === sum.duplicates ? 'ok' : 'MISMATCH'})`,
        'delivered per connector',
        ...Object.entries(sum.delivered).map(([n, v]) => `  ${n.padEnd(15)}${String(v).padStart(3)} delivered, ${dedupPer[n]} deduplicated`),
        `retried                ${sum.retried}  (jira fake returned 429 ${sum.rejected429} times for ${sum.rateLimitedTasks} tasks)`,
        `dead-lettered          ${sum.deadLettered}  (conduit-webhook-crm-dlq after maxReceiveCount=2)`,
        `DLQ replay             ${sum.replayed} replayed after clearing the fault; DLQ now ${sum.dlqAfterReplay}; webhook delivered ${sum.webhookAfter}/${UNIQUE_PER_CONNECTOR}`,
        `paced sends            ${sum.paced} held back by the token buckets`,
        `new integration        ${sum.planSummary}`,
      ].join('\n')
    : '';

  return (
    <div className="demo" aria-label="conduit connector kit demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Queues, idempotency keys, backoff and dead letters</h3>
      <p className="demo__lede">
        The make demo run submits 300 tasks across three connectors with faults on: the Jira fake answers 429 twice for 30
        tasks and the webhook fake answers 400 for 10. Resubmits are deduplicated on the idempotency key, the 429s back off
        and deliver, the 400s bounce into the dead-letter queue, and replay drains it once the fault is cleared.
      </p>

      <div className="cd__status mono" aria-live="polite">
        <span className="cd__status-dot" data-live={snap.busy} data-done={snap.phase === 'done'} />
        {statusLine(snap)}
      </div>

      <div className="cd__stage">
        <section className="cd__panel cd__panel--wide" aria-label="Connector queues">
          <div className="cd__panel-head">
            <span className="cd__panel-title">connector queues</span>
            <span className="cd__panel-meta">{snap.submitted} submitted, one worker per connector, batches of 10</span>
          </div>
          <div className="cd__lanes">
            {snap.lanes.map((l) => (
              <div key={l.name} className="cd__lane" data-active={l.queued + l.inFlight > 0}>
                <div className="cd__lane-head">
                  <span className="cd__lane-name mono">{l.name}</span>
                  <span className="cd__lane-meta mono">
                    {l.type}, {l.rate}/s burst {l.burst}, maxReceiveCount {l.maxReceive}
                  </span>
                </div>
                <div className="cd__bars">
                  <div className="cd__bar" aria-label={`${l.queued} queued, ${l.inFlight} in flight`}>
                    <span className="cd__bar-q" style={{ width: `${Math.min(100, l.queued)}%` }} />
                    <span className="cd__bar-f" style={{ width: `${Math.min(100 - Math.min(100, l.queued), l.inFlight)}%` }} />
                    <span className="cd__bar-label mono">queue {l.queued} + {l.inFlight} in flight</span>
                  </div>
                  <div className="cd__bar" aria-label={`${l.delivered} of ${UNIQUE_PER_CONNECTOR} delivered`}>
                    <span className="cd__bar-d" style={{ width: `${(Math.min(l.delivered, UNIQUE_PER_CONNECTOR) / UNIQUE_PER_CONNECTOR) * 100}%` }} />
                    <span className="cd__bar-label mono">delivered {l.delivered} / {UNIQUE_PER_CONNECTOR}</span>
                  </div>
                </div>
                <dl className="cd__counts mono">
                  <div><dt>dedup</dt><dd>{l.dedup}</dd></div>
                  <div><dt>retried</dt><dd>{l.retried}</dd></div>
                  <div><dt>paced</dt><dd>{l.paced}</dd></div>
                  <div data-hot={l.dlq > 0}><dt>dlq</dt><dd>{l.dlq}</dd></div>
                  <div data-hot={l.quarantine > 0}><dt>quarantine</dt><dd>{l.quarantine}</dd></div>
                </dl>
              </div>
            ))}
          </div>
          <ul className="cd__log mono" aria-label="Worker log">
            {snap.log.length === 0 && <li className="cd__log-empty">worker log lines appear once tasks are submitted</li>}
            {snap.log.map((e) => (
              <li key={e.seq} data-kind={e.kind}>
                <span className="cd__log-t">t+{e.t.toFixed(1)}</span>
                <span className="cd__log-c">{e.connector}</span>
                <span className="cd__log-e">{e.event}</span>
                <span className="cd__log-d">{[e.taskId, e.detail].filter(Boolean).join(' ')}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="cd__panel" aria-label="Token bucket">
          <div className="cd__panel-head">
            <span className="cd__panel-title">token bucket, jira-support</span>
            <span className="cd__panel-meta">{b.rate} tokens/s, burst {b.capacity}, Retry-After cap {b.maxPenalty} s</span>
          </div>
          <div className="cd__bucket" aria-label="bucket level">
            <span className="cd__bucket-fill" style={{ width: `${tokenPct}%` }} />
            <span className="cd__bucket-label mono">
              {b.tokens >= 0 ? `${b.tokens.toFixed(1)} / ${b.capacity} tokens` : `${(-b.tokens).toFixed(1)} tokens reserved ahead`}
            </span>
          </div>
          <dl className="cd__kv mono">
            <dt>paced sends</dt>
            <dd>{b.waits}, {b.waitSeconds.toFixed(2)} s waited</dd>
            <dt>429 responses</dt>
            <dd>{b.rejected}, each retried with full jitter</dd>
            <dt>Retry-After honoured</dt>
            <dd>{b.honored}, pausing every send on the connector</dd>
          </dl>
          <p className="cd__note">
            acquire() reserves a token and returns the wait; tokens go negative while reservations are outstanding, so a
            backlog leaves 1/rate apart once the burst is spent. A 429 feeds the bucket, not the breaker.
          </p>
        </section>

        <section className="cd__panel" aria-label="Breaker and dead-letter queue">
          <div className="cd__panel-head">
            <span className="cd__panel-title">breaker and DLQ, webhook-crm</span>
            <span className="cd__panel-meta">{br.threshold} consecutive failures, {br.recovery} s recovery, one probe</span>
          </div>
          <div className="cd__machine">
            {STATES.map((st) => (
              <span key={st} className="cd__state" data-on={br.state === st}>
                {st.replace('_', '-')}
                {st === 'open' && br.state === 'open' ? <em>{br.remaining.toFixed(1)}s</em> : null}
              </span>
            ))}
          </div>
          <dl className="cd__kv mono">
            <dt>opens</dt>
            <dd>{br.opens}, polling paused {br.paused.toFixed(1)} s</dd>
            <dt>dead letters</dt>
            <dd>{snap.deadLetters.length === 0 ? 'none' : snap.deadLetters.slice(0, 6).map((d) => d.id.replace(`${RUN_ID}-webhook-crm-`, '')).join(', ') + (snap.deadLetters.length > 6 ? ` +${snap.deadLetters.length - 6}` : '')}</dd>
          </dl>
          <div className="cd__row">
            <button className="demo__btn demo__btn--ghost cd__small" disabled={snap.busy || br.outage} onClick={() => act((s) => s.setOutage(true))}>
              Start 503 outage
            </button>
            <button className="demo__btn demo__btn--ghost cd__small" disabled={snap.busy || !br.outage} onClick={() => act((s) => s.setOutage(false))}>
              Clear outage
            </button>
            <button className="demo__btn demo__btn--ghost cd__small" disabled={snap.busy || snap.deadLetters.length === 0} onClick={() => act((s) => s.replay())}>
              Replay DLQ
            </button>
          </div>
          <p className="cd__note">
            An outage fails every call with 503. Three consecutive failures open the breaker and the worker stops polling;
            after 15 s one probe is admitted. Each probe and each batch receive counts toward maxReceiveCount 2, so a long
            outage moves messages into the DLQ; replay after the fault clears drains it to 0.
          </p>
        </section>

        <section className="cd__panel" aria-label="Quarantine">
          <div className="cd__panel-head">
            <span className="cd__panel-title">quarantine, jira-support</span>
            <span className="cd__panel-meta">source schema v2, then mapping rules</span>
          </div>
          <div className="cd__row">
            <button className="demo__btn demo__btn--ghost cd__small" disabled={snap.busy} onClick={() => act((s) => s.sendMalformed())}>
              Send malformed payload
            </button>
            <span className="cd__count mono">
              quarantine {snap.quarantine.depth}, dlq {snap.quarantine.dlq}
            </span>
          </div>
          <pre className="cd__pre mono">
            {snap.quarantine.note
              ? JSON.stringify({ task_id: 'T-91', ...snap.quarantine.note }, null, 2)
              : 'T-91 carries priority "critical", which schemas/jira-support/v2.yaml does not list.'}
          </pre>
          <p className="cd__note">
            A payload that can never be delivered is moved to conduit-jira-support-quarantine with a note naming the stage,
            field and reason. It is not retried and never reaches the dead-letter queue, which stays reserved for deliveries
            that could not complete.
          </p>
        </section>

        <section className="cd__panel" aria-label="Terraform plan">
          <div className="cd__panel-head">
            <span className="cd__panel-title">one YAML, one plan</span>
            <span className="cd__panel-meta">connectors/{NEW_CONNECTOR_NAME}.yaml</span>
          </div>
          <pre className="cd__pre mono">{NEW_CONNECTOR_YAML.trimEnd()}</pre>
          <p className="cd__plan-summary mono">{snap.plan.summary}</p>
          <ul className="cd__plan mono">
            {snap.plan.add.map((r) => (
              <li key={r.address} data-quarantine={r.address.endsWith('quarantine')}>
                <span>+ {r.address.replace(`module.connector["${NEW_CONNECTOR_NAME}"].`, '')}</span>
                <small>{r.detail}</small>
              </li>
            ))}
          </ul>
        </section>

        <section className="cd__panel cd__panel--wide" aria-label="Demo summary">
          <div className="cd__panel-head">
            <span className="cd__panel-title">demo summary</span>
            <span className="cd__panel-meta">run {RUN_ID}, read back from the queues, inboxes and worker stats</span>
          </div>
          {sum ? (
            <>
              <pre className="cd__pre cd__pre--summary mono">{summaryText}</pre>
              <p className="cd__verdict" data-pass={sum.ok}>
                {sum.ok ? 'PASS: deduplicated equals resubmits, dead letters equal hard failures, replay drained the DLQ' : `FAIL: ${sum.problems.join('; ')}`}
              </p>
            </>
          ) : (
            <p className="cd__empty">The summary block prints once the queues drain and the dead letters are replayed.</p>
          )}
        </section>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={() => act((s) => s.start())} disabled={snap.busy}>
          {snap.busy ? 'Running make demo…' : snap.phase === 'done' ? 'Run again' : 'Start make demo run'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={() => act((s) => s.reset())}>
          Reset
        </button>
        <span className="demo__hint">seeded run {RUN_ID}, 300 tasks, same figures every time</span>
      </div>
    </div>
  );
}
