import { useMemo, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './api-platform.css';
import { useGateway } from './api-platform/state';
import {
  addKey,
  addRoute,
  advanceWindow,
  removeKey,
  removeRoute,
  resetAll,
  sendRequest,
  setKeyActive,
  updateRoute,
} from './api-platform/store';
import { matchRoute } from './api-platform/engine';
import type { Decision, Status } from './api-platform/types';

const STATUS_LABEL: Record<Status, string> = {
  200: '200 Routed',
  401: '401 Unauthorized',
  403: '403 Forbidden',
  429: '429 Too Many Requests',
};

const STATUS_TONE: Record<Status, string> = {
  200: 'ok',
  401: 'warn',
  403: 'deny',
  429: 'rate',
};

// In-browser API gateway configurator and request simulator. Define routes
// (path prefix to upstream, auth requirement, per-key rate limit) and API keys,
// then send simulated requests and watch the gateway admit or deny each one
// with the right status: 200 routed, 401 missing or unknown key, 403 inactive
// key, 429 over the per-key rate limit. State persists in localStorage and runs
// through a pure, deterministic engine. Nothing talks to a server, and the
// engine never evaluates strings or reads a real clock for its decision.

export default function ApiPlatformDemo() {
  const reduce = useReducedMotion();
  const { routes, keys, log, window: clock } = useGateway();

  // ---- request composer state ----
  const [path, setPath] = useState('/v1/users/42');
  const [reqKey, setReqKey] = useState<string>('k-live');
  const [lastDecision, setLastDecision] = useState<Decision | null>(null);

  // ---- new-route form state ----
  const [nrPrefix, setNrPrefix] = useState('');
  const [nrUpstream, setNrUpstream] = useState('');
  const [nrAuth, setNrAuth] = useState(true);
  const [nrLimit, setNrLimit] = useState(5);

  // ---- new-key form state ----
  const [nkLabel, setNkLabel] = useState('');

  function onAddRoute(e: React.FormEvent) {
    e.preventDefault();
    if (!nrPrefix.trim() || !nrUpstream.trim()) return;
    addRoute({
      prefix: nrPrefix,
      upstream: nrUpstream.trim(),
      requiresAuth: nrAuth,
      rateLimit: Math.max(0, Math.floor(nrLimit) || 0),
    });
    setNrPrefix('');
    setNrUpstream('');
    setNrAuth(true);
    setNrLimit(5);
  }

  function onAddKey(e: React.FormEvent) {
    e.preventDefault();
    if (!nkLabel.trim()) return;
    addKey(nkLabel);
    setNkLabel('');
  }

  // A live preview of which route the composed path would hit, shown next to
  // the composer so the user sees the longest-prefix match before sending.
  const preview = useMemo(() => matchRoute(routes, path.trim() || '/'), [routes, path]);

  function onSend() {
    const trimmed = path.trim() || '/';
    const keyId = reqKey === '' ? null : reqKey;
    setLastDecision(sendRequest(trimmed, keyId));
  }

  return (
    <div className="ap" data-reduce={reduce ? 'true' : 'false'}>
      <header className="ap__head">
        <div>
          <h2 className="ap__title">API gateway</h2>
          <p className="ap__sub">
            Configure routes and keys, then send requests and watch admission. Fixed window{' '}
            <span className="mono">#{clock}</span>.
          </p>
        </div>
        <div className="ap__head-actions">
          <button type="button" className="ap__btn" onClick={advanceWindow}>
            Advance window
          </button>
          <button type="button" className="ap__btn ap__btn--ghost" onClick={resetAll}>
            Reset
          </button>
        </div>
      </header>

      <div className="ap__grid">
        {/* ---------- routes ---------- */}
        <section className="ap__panel glass" aria-labelledby="ap-routes-h">
          <h3 id="ap-routes-h" className="ap__panel-title">
            Routes
          </h3>
          <div className="ap__table-wrap" role="region" aria-label="Route table" tabIndex={0}>
            <table className="ap__table">
              <thead>
                <tr>
                  <th scope="col">Prefix</th>
                  <th scope="col">Upstream</th>
                  <th scope="col">Auth</th>
                  <th scope="col">Limit / window</th>
                  <th scope="col">
                    <span className="ap__sr">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.prefix}</td>
                    <td className="mono ap__dim">{r.upstream}</td>
                    <td>
                      <label className="ap__switch">
                        <input
                          type="checkbox"
                          checked={r.requiresAuth}
                          onChange={(e) => updateRoute(r.id, { requiresAuth: e.target.checked })}
                          aria-label={`Require auth for ${r.prefix}`}
                        />
                        <span>{r.requiresAuth ? 'required' : 'open'}</span>
                      </label>
                    </td>
                    <td>
                      <input
                        className="ap__num"
                        type="number"
                        min={0}
                        value={r.rateLimit}
                        onChange={(e) =>
                          updateRoute(r.id, { rateLimit: Math.max(0, Number(e.target.value) || 0) })
                        }
                        aria-label={`Rate limit for ${r.prefix}, 0 is unlimited`}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ap__icon"
                        onClick={() => removeRoute(r.id)}
                        aria-label={`Delete route ${r.prefix}`}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {routes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="ap__empty">
                      No routes. Add one below.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <form className="ap__form" onSubmit={onAddRoute} aria-label="Add route">
            <div className="ap__field">
              <label htmlFor="nr-prefix">Prefix</label>
              <input
                id="nr-prefix"
                className="ap__input mono"
                placeholder="/v1/orders"
                value={nrPrefix}
                onChange={(e) => setNrPrefix(e.target.value)}
              />
            </div>
            <div className="ap__field">
              <label htmlFor="nr-upstream">Upstream</label>
              <input
                id="nr-upstream"
                className="ap__input mono"
                placeholder="orders-svc"
                value={nrUpstream}
                onChange={(e) => setNrUpstream(e.target.value)}
              />
            </div>
            <div className="ap__field ap__field--narrow">
              <label htmlFor="nr-limit">Limit</label>
              <input
                id="nr-limit"
                className="ap__input ap__num"
                type="number"
                min={0}
                value={nrLimit}
                onChange={(e) => setNrLimit(Number(e.target.value))}
              />
            </div>
            <label className="ap__check">
              <input
                type="checkbox"
                checked={nrAuth}
                onChange={(e) => setNrAuth(e.target.checked)}
              />
              <span>requires auth</span>
            </label>
            <button type="submit" className="ap__btn">
              Add route
            </button>
          </form>
        </section>

        {/* ---------- keys ---------- */}
        <section className="ap__panel glass" aria-labelledby="ap-keys-h">
          <h3 id="ap-keys-h" className="ap__panel-title">
            API keys
          </h3>
          <ul className="ap__keys">
            {keys.map((k) => (
              <li key={k.id} className="ap__key">
                <span className="ap__key-dot" data-active={k.active} aria-hidden="true" />
                <span className="ap__key-label mono">{k.label}</span>
                <span className="ap__key-state" data-active={k.active}>
                  {k.active ? 'active' : 'inactive'}
                </span>
                <button
                  type="button"
                  className="ap__icon"
                  onClick={() => setKeyActive(k.id, !k.active)}
                  aria-label={`${k.active ? 'Deactivate' : 'Activate'} key ${k.label}`}
                >
                  {k.active ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  type="button"
                  className="ap__icon"
                  onClick={() => removeKey(k.id)}
                  aria-label={`Delete key ${k.label}`}
                >
                  Remove
                </button>
              </li>
            ))}
            {keys.length === 0 && <li className="ap__empty">No keys yet.</li>}
          </ul>
          <form className="ap__form" onSubmit={onAddKey} aria-label="Add API key">
            <div className="ap__field ap__field--grow">
              <label htmlFor="nk-label">New key label</label>
              <input
                id="nk-label"
                className="ap__input mono"
                placeholder="mobile-app"
                value={nkLabel}
                onChange={(e) => setNkLabel(e.target.value)}
              />
            </div>
            <button type="submit" className="ap__btn">
              Add key
            </button>
          </form>
        </section>

        {/* ---------- simulator ---------- */}
        <section className="ap__panel glass ap__panel--wide" aria-labelledby="ap-sim-h">
          <h3 id="ap-sim-h" className="ap__panel-title">
            Request simulator
          </h3>
          <div className="ap__composer">
            <div className="ap__field ap__field--grow">
              <label htmlFor="sim-path">Request path</label>
              <input
                id="sim-path"
                className="ap__input mono"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSend();
                }}
              />
            </div>
            <div className="ap__field">
              <label htmlFor="sim-key">Present key</label>
              <select
                id="sim-key"
                className="ap__input mono"
                value={reqKey}
                onChange={(e) => setReqKey(e.target.value)}
              >
                <option value="">(no key)</option>
                {keys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                    {k.active ? '' : ' (inactive)'}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="ap__btn ap__btn--send" onClick={onSend}>
              Send
            </button>
          </div>

          <p className="ap__match" aria-live="polite">
            {preview.route ? (
              <>
                Matches <span className="mono">{preview.route.prefix}</span> to{' '}
                <span className="mono ap__dim">{preview.route.upstream}</span>
                {preview.candidates.length > 1 && (
                  <span className="ap__faint">
                    {' '}
                    (over {preview.candidates.length - 1} shorter prefix
                    {preview.candidates.length - 1 > 1 ? 'es' : ''})
                  </span>
                )}
              </>
            ) : (
              <span className="ap__faint">No route covers this path.</span>
            )}
          </p>

          {lastDecision && (
            <div
              className="ap__decision"
              data-tone={STATUS_TONE[lastDecision.status]}
              role="status"
              aria-live="polite"
            >
              <span className="ap__decision-code mono">{STATUS_LABEL[lastDecision.status]}</span>
              <span className="ap__decision-reason">{lastDecision.reason}</span>
              {lastDecision.match.route && (
                <span className="ap__decision-route mono ap__faint">
                  route {lastDecision.match.route.prefix}
                </span>
              )}
            </div>
          )}
        </section>

        {/* ---------- traffic ---------- */}
        <section className="ap__panel glass ap__panel--wide" aria-labelledby="ap-traffic-h">
          <h3 id="ap-traffic-h" className="ap__panel-title">
            Traffic
          </h3>

          <UsageMeters />

          <ol className="ap__log" aria-label="Request log">
            {log.map((entry) => (
              <li key={entry.id} className="ap__log-row" data-tone={STATUS_TONE[entry.status]}>
                <span className="ap__log-status mono">{entry.status}</span>
                <span className="ap__log-path mono">{entry.path}</span>
                <span className="ap__log-key mono ap__faint">
                  {entry.keyId ? keyLabel(keys, entry.keyId) : 'anon'}
                </span>
                <span className="ap__log-reason">{entry.reason}</span>
                <span className="ap__log-win mono ap__faint">w{entry.window}</span>
              </li>
            ))}
            {log.length === 0 && <li className="ap__empty">No requests sent yet.</li>}
          </ol>
        </section>
      </div>
    </div>
  );
}

function keyLabel(keys: { id: string; label: string }[], id: string): string {
  return keys.find((k) => k.id === id)?.label ?? id;
}

// Per key+route rate-limit usage in the current window. Reads counts from the
// live snapshot so the bars fill as requests are admitted and empty when the
// window advances.
function UsageMeters() {
  const { routes, keys, counts, window: clock } = useGateway();

  const rows = useMemo(() => {
    const out: { keyId: string; label: string; prefix: string; used: number; limit: number }[] = [];
    for (const k of keys) {
      for (const r of routes) {
        if (r.rateLimit <= 0) continue;
        const used = counts[`${k.id}::${r.id}::${clock}`] ?? 0;
        if (used === 0) continue;
        out.push({ keyId: k.id, label: k.label, prefix: r.prefix, used, limit: r.rateLimit });
      }
    }
    return out;
  }, [routes, keys, counts, clock]);

  if (rows.length === 0) {
    return (
      <p className="ap__faint ap__meters-empty">
        No metered usage in window #{clock}. Send keyed requests to a rate-limited route.
      </p>
    );
  }

  return (
    <ul className="ap__meters" aria-label="Rate limit usage in current window">
      {rows.map((row) => {
        const pct = Math.min(100, Math.round((row.used / row.limit) * 100));
        const full = row.used >= row.limit;
        return (
          <li key={`${row.keyId}-${row.prefix}`} className="ap__meter">
            <span className="ap__meter-label mono">
              {row.label} {row.prefix}
            </span>
            <span
              className="ap__meter-bar"
              role="progressbar"
              aria-valuenow={row.used}
              aria-valuemin={0}
              aria-valuemax={row.limit}
              aria-label={`${row.label} on ${row.prefix}`}
            >
              <span className="ap__meter-fill" data-full={full} style={{ width: `${pct}%` }} />
            </span>
            <span className="ap__meter-num mono">
              {row.used}/{row.limit}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
