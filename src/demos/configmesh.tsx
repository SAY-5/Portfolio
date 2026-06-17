// configmesh: an in-browser multi-environment configuration manager. Define
// typed config keys, set base defaults, override per environment, diff two
// environments, and surface validation errors. The resolution/validation/diff
// logic is the pure engine in ./configmesh/engine.ts; this file is the UI shell
// and persists through the external store in ./configmesh/store.ts. No eval, no
// network, deterministic given the stored document.

import { useState } from 'react';
import '../styles/demo.css';
import './configmesh.css';
import { useConfigDoc } from './configmesh/state';
import {
  addKey,
  clearBase,
  clearOverride,
  deleteKey,
  resetAll,
  setBase,
  setOverride,
  updateKey,
} from './configmesh/store';
import {
  coerceValue,
  diffEnvironments,
  formatValue,
  resolveEnvironment,
  validateEnvironment,
} from './configmesh/engine';
import type { ConfigKey, ConfigType, ConfigValue } from './configmesh/types';

const TYPES: ConfigType[] = ['string', 'number', 'bool'];

function KeysPanel() {
  const doc = useConfigDoc();
  const [name, setName] = useState('');
  const [type, setType] = useState<ConfigType>('string');
  const [required, setRequired] = useState(false);
  const [error, setError] = useState('');

  // Draft text for the base-default editors, keyed by key name. Edits are
  // committed on blur/enter so typing a partial number does not thrash storage.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  function submitKey() {
    const ok = addKey(name, type, required);
    if (!ok) {
      setError('Name must be a unique identifier (letters, digits, dot, dash).');
      return;
    }
    setName('');
    setType('string');
    setRequired(false);
    setError('');
  }

  function commitBase(keyName: string, keyType: ConfigType, raw: string) {
    if (raw.trim() === '') {
      clearBase(keyName);
      setDrafts((d) => {
        const next = { ...d };
        delete next[keyName];
        return next;
      });
      return;
    }
    const value = coerceValue(raw, keyType);
    if (value === null) return; // reject malformed; leave prior value intact
    setBase(keyName, value);
    setDrafts((d) => {
      const next = { ...d };
      delete next[keyName];
      return next;
    });
  }

  function draftFor(keyName: string, current: ConfigValue | undefined): string {
    if (keyName in drafts) return drafts[keyName];
    return current === undefined ? '' : String(current);
  }

  return (
    <section className="cm-panel glass" aria-labelledby="cm-keys-h">
      <div className="cm-panel__head">
        <h4 id="cm-keys-h" className="cm-panel__title">
          Keys and base defaults
        </h4>
        <span className="cm-panel__meta">{doc.keys.length} keys</span>
      </div>

      <form
        className="cm-keyform"
        onSubmit={(e) => {
          e.preventDefault();
          submitKey();
        }}
      >
        <label className="cm-field">
          <span className="cm-field__label">Key name</span>
          <input
            className="cm-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="feature.new_nav"
            aria-invalid={error !== ''}
          />
        </label>
        <label className="cm-field">
          <span className="cm-field__label">Type</span>
          <select
            className="cm-input"
            value={type}
            onChange={(e) => setType(e.target.value as ConfigType)}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="cm-check">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          <span>required</span>
        </label>
        <button type="submit" className="demo__btn">
          Add key
        </button>
      </form>
      {error && (
        <p className="cm-error" role="alert">
          {error}
        </p>
      )}

      <div className="cm-table-wrap">
        <table className="cm-table">
          <caption className="cm-sr-only">
            Config keys with their type, required flag, and base default
          </caption>
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Type</th>
              <th scope="col">Required</th>
              <th scope="col">Base default</th>
              <th scope="col">
                <span className="cm-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {doc.keys.map((key) => {
              const baseVal = doc.base[key.name];
              return (
                <tr key={key.name}>
                  <th scope="row" className="cm-key-name mono">
                    {key.name}
                  </th>
                  <td>
                    <select
                      className="cm-input cm-input--sm"
                      value={key.type}
                      aria-label={`type for ${key.name}`}
                      onChange={(e) =>
                        updateKey(key.name, {
                          type: e.target.value as ConfigType,
                        })
                      }
                    >
                      {TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <label className="cm-check cm-check--bare">
                      <input
                        type="checkbox"
                        checked={key.required}
                        aria-label={`required for ${key.name}`}
                        onChange={(e) =>
                          updateKey(key.name, { required: e.target.checked })
                        }
                      />
                    </label>
                  </td>
                  <td>
                    {key.type === 'bool' ? (
                      <select
                        className="cm-input cm-input--sm"
                        aria-label={`base default for ${key.name}`}
                        value={baseVal === undefined ? '' : String(baseVal)}
                        onChange={(e) =>
                          e.target.value === ''
                            ? clearBase(key.name)
                            : setBase(key.name, e.target.value === 'true')
                        }
                      >
                        <option value="">(unset)</option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : (
                      <input
                        className="cm-input cm-input--sm"
                        aria-label={`base default for ${key.name}`}
                        inputMode={key.type === 'number' ? 'decimal' : 'text'}
                        value={draftFor(key.name, baseVal)}
                        placeholder="(unset)"
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [key.name]: e.target.value }))
                        }
                        onBlur={(e) =>
                          commitBase(key.name, key.type, e.target.value)
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitBase(
                              key.name,
                              key.type,
                              (e.target as HTMLInputElement).value,
                            );
                          }
                        }}
                      />
                    )}
                  </td>
                  <td className="cm-row-actions">
                    <button
                      type="button"
                      className="cm-icon-btn"
                      aria-label={`delete ${key.name}`}
                      onClick={() => deleteKey(key.name)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// A value editor for one key, used by the environment panel to set or clear an
// override. Booleans use a tri-state select (inherit / true / false); other
// types use a text input committed on blur or Enter.
function ValueEditor({
  envId,
  configKey,
  currentValue,
  overridden,
}: {
  envId: string;
  configKey: ConfigKey;
  currentValue: ConfigValue | undefined;
  overridden: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit(raw: string) {
    setDraft(null);
    if (raw.trim() === '') {
      clearOverride(envId, configKey.name);
      return;
    }
    const value = coerceValue(raw, configKey.type);
    if (value === null) return;
    setOverride(envId, configKey.name, value);
  }

  if (configKey.type === 'bool') {
    return (
      <select
        className="cm-input cm-input--sm"
        aria-label={`override ${configKey.name}`}
        value={overridden ? String(currentValue) : ''}
        onChange={(e) =>
          e.target.value === ''
            ? clearOverride(envId, configKey.name)
            : setOverride(envId, configKey.name, e.target.value === 'true')
        }
      >
        <option value="">inherit</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  const shown =
    draft !== null
      ? draft
      : overridden && currentValue !== undefined
        ? String(currentValue)
        : '';

  return (
    <input
      className="cm-input cm-input--sm"
      aria-label={`override ${configKey.name}`}
      inputMode={configKey.type === 'number' ? 'decimal' : 'text'}
      placeholder="inherit"
      value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit((e.target as HTMLInputElement).value);
        }
      }}
    />
  );
}

function EnvironmentPanel() {
  const doc = useConfigDoc();
  const [activeId, setActiveId] = useState(doc.environments[0]?.id ?? '');

  // Guard against a stored active id that no longer exists.
  const active =
    doc.environments.find((e) => e.id === activeId) ?? doc.environments[0];
  if (!active) return null;

  const rows = resolveEnvironment(doc, active);
  const overrideCount = rows.filter((r) => r.overridden).length;

  return (
    <section className="cm-panel glass" aria-labelledby="cm-env-h">
      <div className="cm-panel__head">
        <h4 id="cm-env-h" className="cm-panel__title">
          Environment view
        </h4>
        <span className="cm-panel__meta">
          {overrideCount} of {rows.length} overridden
        </span>
      </div>

      <div className="cm-tabs" role="tablist" aria-label="select environment">
        {doc.environments.map((env) => {
          const isActive = env.id === active.id;
          return (
            <button
              key={env.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`cm-tab${isActive ? ' cm-tab--active' : ''}`}
              onClick={() => setActiveId(env.id)}
            >
              {env.name}
            </button>
          );
        })}
      </div>

      <div className="cm-table-wrap">
        <table className="cm-table">
          <caption className="cm-sr-only">
            Effective values for the {active.name} environment
          </caption>
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Source</th>
              <th scope="col">Effective value</th>
              <th scope="col">Override</th>
              <th scope="col">
                <span className="cm-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const configKey = doc.keys.find((k) => k.name === row.name)!;
              return (
                <tr key={row.name}>
                  <th scope="row" className="cm-key-name mono">
                    {row.name}
                  </th>
                  <td>
                    <span
                      className={`cm-badge ${
                        row.overridden
                          ? 'cm-badge--override'
                          : 'cm-badge--inherit'
                      }`}
                    >
                      {row.overridden ? 'override' : 'inherited'}
                    </span>
                  </td>
                  <td className="cm-val">
                    {row.value === undefined ? (
                      <span className="cm-unset">{formatValue(row.value)}</span>
                    ) : (
                      formatValue(row.value)
                    )}
                  </td>
                  <td>
                    <ValueEditor
                      envId={active.id}
                      configKey={configKey}
                      currentValue={row.value}
                      overridden={row.overridden}
                    />
                  </td>
                  <td className="cm-row-actions">
                    <button
                      type="button"
                      className="cm-icon-btn"
                      aria-label={`clear override for ${row.name} in ${active.name}`}
                      disabled={!row.overridden}
                      onClick={() => clearOverride(active.id, row.name)}
                    >
                      Clear
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DiffPanel() {
  const doc = useConfigDoc();
  const [fromId, setFromId] = useState(doc.environments[0]?.id ?? '');
  const [toId, setToId] = useState(
    doc.environments[1]?.id ?? doc.environments[0]?.id ?? '',
  );

  const fromEnv = doc.environments.find((e) => e.id === fromId);
  const toEnv = doc.environments.find((e) => e.id === toId);
  const entries =
    fromEnv && toEnv ? diffEnvironments(doc, fromEnv.id, toEnv.id) : [];

  return (
    <section className="cm-panel glass" aria-labelledby="cm-diff-h">
      <div className="cm-panel__head">
        <h4 id="cm-diff-h" className="cm-panel__title">
          Diff environments
        </h4>
        <span className="cm-panel__meta">{entries.length} differences</span>
      </div>

      <div className="cm-env-select">
        <label>
          from
          <select
            className="cm-input cm-input--sm"
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
          >
            {doc.environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
        </label>
        <span className="cm-arrow" aria-hidden="true">
          to
        </span>
        <label>
          to
          <select
            className="cm-input cm-input--sm"
            value={toId}
            onChange={(e) => setToId(e.target.value)}
          >
            {doc.environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div role="list" aria-label="diff entries">
        {entries.length === 0 ? (
          <p className="cm-empty">
            {fromId === toId
              ? 'Pick two different environments to compare.'
              : 'No differences in effective values.'}
          </p>
        ) : (
          entries.map((entry) => (
            <div className="cm-diff-row" role="listitem" key={entry.key}>
              <span className={`cm-diff-tag cm-diff-tag--${entry.kind}`}>
                {entry.kind}
              </span>
              <span className="cm-diff-key">{entry.key}</span>
              {entry.kind === 'changed' ? (
                <span className="cm-diff-val">
                  {formatValue(entry.from)}{' '}
                  <span className="cm-arrow" aria-hidden="true">
                    to
                  </span>{' '}
                  {formatValue(entry.to)}
                </span>
              ) : (
                <span className="cm-diff-val">{formatValue(entry.value)}</span>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ValidationPanel() {
  const doc = useConfigDoc();
  const results = doc.environments.map((env) => ({
    env,
    issues: validateEnvironment(doc, env),
  }));
  const total = results.reduce((sum, r) => sum + r.issues.length, 0);

  return (
    <section className="cm-panel glass" aria-labelledby="cm-val-h">
      <div className="cm-panel__head">
        <h4 id="cm-val-h" className="cm-panel__title">
          Validation
        </h4>
        <span className="cm-panel__meta" aria-live="polite">
          {total === 0 ? 'all valid' : `${total} issues`}
        </span>
      </div>

      {results.map(({ env, issues }) => (
        <div key={env.id}>
          <p className="cm-field__label">{env.name}</p>
          {issues.length === 0 ? (
            <p className="cm-ok-line">
              <span aria-hidden="true">+</span> no missing required keys or type
              errors
            </p>
          ) : (
            <div role="list" aria-label={`issues for ${env.name}`}>
              {issues.map((issue) => (
                <div
                  className="cm-issue"
                  role="listitem"
                  key={`${env.id}.${issue.key}.${issue.kind}`}
                >
                  {issue.kind === 'missing-required' ? (
                    <>
                      <span className="cm-issue__sev">missing</span>
                      <span className="cm-issue__text">
                        required key <span className="mono">{issue.key}</span> has
                        no effective value
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="cm-issue__sev cm-issue__sev--type">
                        type
                      </span>
                      <span className="cm-issue__text">
                        <span className="mono">{issue.key}</span> expects{' '}
                        {issue.expected} but holds a {issue.got}
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

export default function ConfigmeshDemo() {
  const doc = useConfigDoc();

  return (
    <div className="demo cm" aria-label="configmesh configuration manager">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Multi-environment configuration manager</h3>
      <p className="demo__lede">
        Define typed config keys with base defaults, override them per
        environment, diff two environments, and catch missing required keys and
        type errors. Everything resolves in the browser and persists locally.
      </p>

      <KeysPanel />
      <EnvironmentPanel />
      <div className="cm-grid-2">
        <DiffPanel />
        <ValidationPanel />
      </div>

      <div className="demo__controls">
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={resetAll}
        >
          Reset to seed
        </button>
        <span className="demo__hint">
          {doc.environments.length} environments,{' '}
          {Object.keys(doc.base).length} base defaults set
        </span>
      </div>
    </div>
  );
}
