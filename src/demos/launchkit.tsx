import { useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './launchkit.css';

// Real behavior from the project: tenant isolation is enforced server-side by a
// TenantScope. A cross-tenant id reads as a 404 and writes re-check ownership.
// Stripe webhook idempotency has two layers (a processed_events check plus a
// unique constraint) so a replayed delivery never double-applies a transition.

type Note = { id: string; title: string };

const tenantA: Note[] = [
  { id: 'note_a1', title: 'Onboarding checklist' },
  { id: 'note_a2', title: 'Q3 launch plan' },
];
const tenantB: Note[] = [
  { id: 'note_b1', title: 'Pricing experiment' },
  { id: 'note_b2', title: 'Renewal follow-up' },
];

type Mode = 'tenant' | 'webhook';
const ease = [0.22, 1, 0.36, 1] as const;

export default function LaunchkitDemo() {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<Mode>('tenant');

  // Tenant isolation state: which note id Acme (tenant A) is requesting.
  const [requestId, setRequestId] = useState<string | null>(null);

  // Webhook idempotency state.
  const [deliveries, setDeliveries] = useState<
    { key: number; applied: boolean }[]
  >([]);
  const [credits, setCredits] = useState(0);

  const requestedFromB = requestId !== null && requestId.startsWith('note_b');
  const requestedFromA = requestId !== null && requestId.startsWith('note_a');

  function requestNote(id: string) {
    setRequestId(id);
  }

  function sendWebhook() {
    // First delivery applies the transition; replays hit the idempotency layer
    // and are skipped, so the credited amount only moves once.
    setDeliveries((prev) => {
      const firstTime = prev.length === 0;
      if (firstTime) setCredits(50);
      return [...prev, { key: prev.length, applied: firstTime }];
    });
  }

  function reset() {
    setRequestId(null);
    setDeliveries([]);
    setCredits(0);
  }

  return (
    <div className="demo" aria-label="launchkit tenant isolation demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Tenant isolation and webhook idempotency</h3>
      <p className="demo__lede">
        Two tenants share one database behind a TenantScope. Read a row from the
        other tenant and the guard returns a 404. Replay a Stripe webhook and
        the idempotency layer applies the transition exactly once.
      </p>

      <div className="lk__stage">
        <div className="lk__tabs" role="tablist" aria-label="demo mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'tenant'}
            className={`lk__tab${mode === 'tenant' ? ' lk__tab--on' : ''}`}
            onClick={() => setMode('tenant')}
          >
            Tenant isolation
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'webhook'}
            className={`lk__tab${mode === 'webhook' ? ' lk__tab--on' : ''}`}
            onClick={() => setMode('webhook')}
          >
            Webhook idempotency
          </button>
        </div>

        {mode === 'tenant' && (
          <>
            <div className="lk__lanes">
              <div className="lk__lane lk__lane--active">
                <div className="lk__lane-title">Acme (your token)</div>
                {tenantA.map((n) => (
                  <button
                    type="button"
                    key={n.id}
                    className="lk__row"
                    style={{ width: '100%', cursor: 'pointer' }}
                    onClick={() => requestNote(n.id)}
                  >
                    <span className="lk__row-id">{n.id}</span>
                    {n.title}
                    {requestId === n.id && (
                      <span className="lk__badge lk__badge--ok">read</span>
                    )}
                  </button>
                ))}
              </div>
              <div className="lk__lane">
                <div className="lk__lane-title">Globex (other tenant)</div>
                {tenantB.map((n) => (
                  <button
                    type="button"
                    key={n.id}
                    className={`lk__row${requestId === n.id ? ' lk__row--target' : ''}`}
                    style={{ width: '100%', cursor: 'pointer' }}
                    onClick={() => requestNote(n.id)}
                  >
                    <span className="lk__row-id">{n.id}</span>
                    {n.title}
                    {requestId === n.id && (
                      <span className="lk__badge lk__badge--block">404</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <AnimatePresence mode="wait">
              {requestId && (
                <motion.div
                  key={requestId}
                  className={`lk__readout${requestedFromB ? ' lk__readout--block' : ' lk__readout--ok'}`}
                  initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.3, ease }}
                >
                  {requestedFromA ? (
                    <>
                      <span className="lk__readout-code">200</span>
                      <span className="lk__readout-text">
                        GET /notes/{requestId} resolves inside your tenant scope.
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="lk__readout-code">404</span>
                      <span className="lk__readout-text">
                        TenantScope injected your tenant filter, so {requestId}{' '}
                        is invisible and reads as not found.
                      </span>
                    </>
                  )}
                </motion.div>
              )}
              {!requestId && (
                <motion.div
                  key="empty"
                  className="lk__readout"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <span className="lk__readout-text">
                    Pick a row to send GET /notes/&lt;id&gt; with the Acme token.
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        {mode === 'webhook' && (
          <div className="lk__webhook">
            <div className="lk__state">
              <div className="lk__stat">
                <div className="lk__stat-name">Deliveries</div>
                <div className="lk__stat-val">{deliveries.length}</div>
                <div className="lk__stat-meta">
                  {deliveries.length === 0
                    ? 'no webhook received yet'
                    : 'same evt_001 delivered'}
                </div>
              </div>
              <div className="lk__stat">
                <div className="lk__stat-name">Credit applied</div>
                <div className="lk__stat-val">${credits}</div>
                <div className="lk__stat-meta">
                  {credits > 0 ? 'transition applied once' : 'not yet applied'}
                </div>
              </div>
            </div>

            <div className="lk__events">
              <AnimatePresence initial={false}>
                {deliveries.map((d) => (
                  <motion.div
                    key={d.key}
                    className="lk__event"
                    initial={{ opacity: 0, x: reduce ? 0 : -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: reduce ? 0 : 0.3, ease }}
                  >
                    <span className="lk__event-id">evt_001</span>
                    <span style={{ color: 'var(--text-faint)' }}>
                      checkout.session.completed
                    </span>
                    <span
                      className={`lk__event-tag${d.applied ? ' lk__event-tag--applied' : ' lk__event-tag--skipped'}`}
                    >
                      {d.applied ? 'applied' : 'skipped (replay)'}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
              {deliveries.length === 0 && (
                <div className="lk__event" style={{ color: 'var(--text-faint)' }}>
                  Send the webhook, then send it again to replay.
                </div>
              )}
            </div>

            <AnimatePresence>
              {deliveries.length > 1 && (
                <motion.div
                  className="lk__verdict"
                  initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4, ease }}
                >
                  <span className="lk__verdict-head">Applied exactly once</span>
                  <span className="lk__verdict-text">
                    The processed_events check caught the replay and the unique
                    constraint backs it up, so {deliveries.length} deliveries of
                    evt_001 still credit ${credits} a single time.
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="demo__controls">
        {mode === 'webhook' && (
          <button type="button" className="demo__btn" onClick={sendWebhook}>
            {deliveries.length === 0 ? 'Send webhook' : 'Replay webhook'}
          </button>
        )}
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={reset}
        >
          Reset
        </button>
        <span className="demo__hint">
          {mode === 'tenant'
            ? 'cross-tenant id reads as 404'
            : 'replays never double-apply'}
        </span>
      </div>
    </div>
  );
}
