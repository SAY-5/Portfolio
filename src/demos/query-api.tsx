import { useState } from 'react';
import '../styles/demo.css';
import './query-api.css';
import { ROUTES } from './query-api/mockapi';
import { useStore } from './query-api/state';
import {
  addRow,
  editRow,
  lastResponse,
  loadDraft,
  loadExample,
  removeRow,
  removeSaved,
  resetAll,
  saveToCollection,
  send,
  setBody,
  setMethod,
  setPath,
  type State,
} from './query-api/store';
import type { HistoryEntry, KeyValue, Method } from './query-api/types';

// In-browser REST request console. The user composes a request (method, path,
// query params, headers, JSON body), sends it against a mock backend that runs
// entirely client-side, and sees a realistic JSON response with status and
// timing. Requests can be saved to a named collection and replayed, and every
// send is recorded in a local history. Nothing leaves the browser: there is no
// real fetch and no eval anywhere in the router.

const METHODS: Method[] = ['GET', 'POST'];

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 400 && status < 500) return 'client';
  if (status >= 500) return 'server';
  return 'info';
}

function statusWord(status: number): string {
  if (status >= 200 && status < 300) return 'Success';
  if (status >= 400 && status < 500) return 'Client error';
  if (status >= 500) return 'Server error';
  return 'Informational';
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function QueryApiDemo() {
  const state = useStore();
  // Snapshot the wall clock into state at mount so render stays pure; each send
  // refreshes it through an event handler, never during render.
  const [clock, setClock] = useState(() => Date.now());
  const [saveName, setSaveName] = useState('');

  const current = lastResponse(state);

  function onSend() {
    const now = Date.now();
    setClock(now);
    send(now);
  }

  function onSave() {
    if (saveName.trim().length === 0) return;
    saveToCollection(saveName);
    setSaveName('');
  }

  return (
    <div className="qa">
      <header className="qa-head">
        <div>
          <p className="qa-eyebrow">REST console</p>
          <h1 className="qa-title">query-api</h1>
        </div>
        <p className="qa-lede">
          Compose a request, send it against the in-browser mock backend, and read
          back a real JSON response with status and timing. No request ever leaves
          the page.
        </p>
      </header>

      <div className="qa-grid">
        <Builder state={state} onSend={onSend} clock={clock} />
        <Viewer current={current} bodyError={state.bodyError} />
      </div>

      <Collections
        state={state}
        saveName={saveName}
        setSaveName={setSaveName}
        onSave={onSave}
      />
    </div>
  );
}

// ---------- request builder ----------

function Builder({
  state,
  onSend,
  clock,
}: {
  state: State;
  onSend: () => void;
  clock: number;
}) {
  const { draft } = state;
  return (
    <section className="glass qa-panel" aria-labelledby="qa-builder-h">
      <div className="qa-panel-head">
        <h2 id="qa-builder-h" className="qa-panel-title">
          Request
        </h2>
        <span className="qa-clock" aria-hidden="true">
          session {new Date(clock).toLocaleTimeString()}
        </span>
      </div>

      <div className="qa-line">
        <label className="qa-field qa-method">
          <span className="qa-label">Method</span>
          <select
            value={draft.method}
            onChange={(e) => setMethod(e.target.value as Method)}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="qa-field qa-path">
          <span className="qa-label">Path</span>
          <input
            type="text"
            value={draft.path}
            spellCheck={false}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/users"
          />
        </label>
        <button type="button" className="qa-send" onClick={onSend}>
          Send
        </button>
      </div>

      <div className="qa-examples" role="group" aria-label="Example requests">
        {ROUTES.map((r, i) => (
          <button
            key={r.path + r.method}
            type="button"
            className="qa-chip"
            onClick={() => loadExample(i)}
          >
            <span className={`qa-verb ${r.method.toLowerCase()}`}>{r.method}</span>
            {r.label}
          </button>
        ))}
      </div>

      <Rows field="query" title="Query params" rows={draft.query} />
      <Rows field="headers" title="Headers" rows={draft.headers} />

      {draft.method === 'POST' && (
        <label className="qa-field qa-body">
          <span className="qa-label">JSON body</span>
          <textarea
            value={draft.body}
            spellCheck={false}
            rows={8}
            onChange={(e) => setBody(e.target.value)}
            placeholder={'{\n  "name": "...",\n  "email": "...@..."\n}'}
            aria-describedby={state.bodyError ? 'qa-body-err' : undefined}
          />
        </label>
      )}
    </section>
  );
}

function Rows({
  field,
  title,
  rows,
}: {
  field: 'query' | 'headers';
  title: string;
  rows: KeyValue[];
}) {
  return (
    <fieldset className="qa-rows">
      <legend className="qa-label">{title}</legend>
      {rows.map((r) => (
        <div className="qa-row" key={r.id}>
          <input
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => editRow(field, r.id, { enabled: e.target.checked })}
            aria-label={`Enable ${title} row`}
          />
          <input
            type="text"
            className="qa-k"
            value={r.key}
            spellCheck={false}
            placeholder="key"
            aria-label={`${title} key`}
            onChange={(e) => editRow(field, r.id, { key: e.target.value })}
          />
          <input
            type="text"
            className="qa-v"
            value={r.value}
            spellCheck={false}
            placeholder="value"
            aria-label={`${title} value`}
            onChange={(e) => editRow(field, r.id, { value: e.target.value })}
          />
          <button
            type="button"
            className="qa-x"
            aria-label={`Remove ${title} row`}
            onClick={() => removeRow(field, r.id)}
          >
            &times;
          </button>
        </div>
      ))}
      <button type="button" className="qa-add" onClick={() => addRow(field)}>
        + Add {title.toLowerCase()}
      </button>
    </fieldset>
  );
}

// ---------- response viewer ----------

function Viewer({
  current,
  bodyError,
}: {
  current: HistoryEntry | null;
  bodyError: string | null;
}) {
  return (
    <section className="glass qa-panel" aria-labelledby="qa-resp-h" aria-live="polite">
      <div className="qa-panel-head">
        <h2 id="qa-resp-h" className="qa-panel-title">
          Response
        </h2>
        {current && (
          <span className="qa-timing">{current.durationMs.toFixed(2)} ms</span>
        )}
      </div>

      {bodyError && (
        <p id="qa-body-err" className="qa-note" role="alert">
          {bodyError}
        </p>
      )}

      {!current && !bodyError && (
        <p className="qa-empty">Send a request to see the response here.</p>
      )}

      {current && (
        <>
          <div className="qa-status-line">
            <span className={`qa-badge ${statusClass(current.status)}`}>
              <span className="qa-vh">{statusWord(current.status)} response, status </span>
              {current.status} {current.response.statusText}
            </span>
            <span className="qa-status-meta">
              {current.method} {current.path}
            </span>
          </div>

          {current.status === 400 && (
            <p className="qa-note" role="status">
              Validation:{' '}
              {String(
                (current.response.body as { error?: string }).error ?? 'bad request',
              )}
            </p>
          )}

          <h3 className="qa-sub" id="qa-body-h">
            Body
          </h3>
          <pre
            className="qa-json"
            tabIndex={0}
            role="region"
            aria-labelledby="qa-body-h"
          >
            {pretty(current.response.body)}
          </pre>

          <h3 className="qa-sub">Response headers</h3>
          <dl className="qa-headers">
            {Object.entries(current.response.headers).map(([k, v]) => (
              <div className="qa-hrow" key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}

// ---------- collection + history ----------

function Collections({
  state,
  saveName,
  setSaveName,
  onSave,
}: {
  state: State;
  saveName: string;
  setSaveName: (v: string) => void;
  onSave: () => void;
}) {
  return (
    <section className="glass qa-panel qa-collections" aria-labelledby="qa-coll-h">
      <div className="qa-panel-head">
        <h2 id="qa-coll-h" className="qa-panel-title">
          Collection and history
        </h2>
        <button type="button" className="qa-reset" onClick={resetAll}>
          Reset all
        </button>
      </div>

      <form
        className="qa-save"
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <label className="qa-field qa-savefield">
          <span className="qa-label">Save current request as</span>
          <input
            type="text"
            value={saveName}
            placeholder="List active users"
            onChange={(e) => setSaveName(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="qa-add"
          disabled={saveName.trim().length === 0}
        >
          Save
        </button>
      </form>

      <div className="qa-cols">
        <div>
          <h3 className="qa-sub">Saved ({state.collection.length})</h3>
          {state.collection.length === 0 ? (
            <p className="qa-empty">No saved requests yet.</p>
          ) : (
            <ul className="qa-list">
              {state.collection.map((s) => (
                <li key={s.id} className="qa-item">
                  <button
                    type="button"
                    className="qa-item-main"
                    onClick={() => loadDraft(s.request)}
                  >
                    <span className={`qa-verb ${s.request.method.toLowerCase()}`}>
                      {s.request.method}
                    </span>
                    <span className="qa-item-name">{s.name}</span>
                    <span className="qa-item-path">{s.request.path}</span>
                  </button>
                  <button
                    type="button"
                    className="qa-x"
                    aria-label={`Delete saved request ${s.name}`}
                    onClick={() => removeSaved(s.id)}
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="qa-sub">History ({state.history.length})</h3>
          {state.history.length === 0 ? (
            <p className="qa-empty">No requests sent yet.</p>
          ) : (
            <ul className="qa-list">
              {state.history.map((h) => (
                <li key={h.id} className="qa-item">
                  <button
                    type="button"
                    className="qa-item-main"
                    onClick={() => loadDraft(h.request)}
                  >
                    <span className={`qa-verb ${h.method.toLowerCase()}`}>
                      {h.method}
                    </span>
                    <span className="qa-item-path">{h.path}</span>
                    <span className={`qa-badge sm ${statusClass(h.status)}`}>
                      {h.status}
                    </span>
                    <span className="qa-item-time">{h.durationMs.toFixed(1)} ms</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
