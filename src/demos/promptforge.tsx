import { useMemo, useState } from 'react';
import '../styles/demo.css';
import './promptforge.css';
import type { Template, VarDef, VarType } from './promptforge/types';
import {
  diffLines,
  diffStat,
  formatTime,
  isClean,
  isDirty,
  render,
} from './promptforge/engine';
import { useStore } from './promptforge/state';
import {
  activateVersion,
  createTemplate,
  deleteTemplate,
  removeVar,
  renameTemplate,
  resetAll,
  saveVersion,
  selectedTemplate,
  selectTemplate,
  setBody,
  updateVar,
} from './promptforge/store';

// In-browser PromptForge: author a text template with {{variable}}
// placeholders, declare each variable's type and default, preview the rendered
// output against your own inputs, snapshot immutable versions, and diff or
// restore any prior version. Templates and versions persist in localStorage and
// nothing leaves the page: rendering is a plain string substitution with no
// eval and no network. The seed template is plain order-notice copy so a first
// visitor has something concrete to edit.

type View = 'editor' | 'preview' | 'versions';

const VAR_TYPES: VarType[] = ['text', 'number', 'enum'];

export default function PromptforgeDemo() {
  const state = useStore();
  const tpl = selectedTemplate(state);

  const [view, setView] = useState<View>('editor');
  // Per-template preview values, keyed by template id then variable name.
  const [values, setValues] = useState<Record<string, Record<string, string>>>(
    {},
  );
  const [newName, setNewName] = useState('');
  const [copied, setCopied] = useState(false);

  function setValue(tplId: string, name: string, value: string) {
    setValues((prev) => ({
      ...prev,
      [tplId]: { ...(prev[tplId] ?? {}), [name]: value },
    }));
  }

  return (
    <div className="demo pf">
      <header className="demo__head">
        <span className="demo__tag">PromptForge</span>
        <h1 className="demo__title">Template manager</h1>
        <p className="demo__lede">
          Author a template with <code>{'{{variable}}'}</code> placeholders,
          preview it against your own inputs, then snapshot and diff versions.
          Everything is stored locally in your browser.
        </p>
      </header>

      <div className="pf__layout">
        <TemplateRail
          templates={state.templates}
          selectedId={state.selectedId}
          newName={newName}
          onNewName={setNewName}
          onCreate={() => {
            createTemplate(newName);
            setNewName('');
            setView('editor');
          }}
        />

        <section className="pf__main glass" aria-label="Template workspace">
          {!tpl ? (
            <p className="pf__empty">
              No template selected. Create one to begin.
            </p>
          ) : (
            <>
              <TemplateHeader tpl={tpl} view={view} onView={setView} />
              {view === 'editor' && <Editor tpl={tpl} />}
              {view === 'preview' && (
                <Preview
                  tpl={tpl}
                  values={values[tpl.id] ?? {}}
                  onValue={(name, value) => setValue(tpl.id, name, value)}
                  copied={copied}
                  onCopied={setCopied}
                />
              )}
              {view === 'versions' && <Versions tpl={tpl} />}
            </>
          )}
        </section>
      </div>

      <footer className="pf__footer">
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={() => {
            resetAll();
            setValues({});
            setView('editor');
          }}
        >
          Reset all data
        </button>
        <span className="pf__footnote">
          Local only. No network, no code execution: rendering is plain text
          substitution.
        </span>
      </footer>
    </div>
  );
}

// ---------- template rail ----------

function TemplateRail({
  templates,
  selectedId,
  newName,
  onNewName,
  onCreate,
}: {
  templates: Template[];
  selectedId: string | null;
  newName: string;
  onNewName: (v: string) => void;
  onCreate: () => void;
}) {
  return (
    <nav className="pf__rail glass" aria-label="Templates">
      <h2 className="pf__rail-title">Templates</h2>
      <ul className="pf__list">
        {templates.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className={`pf__list-item${t.id === selectedId ? ' is-active' : ''}`}
              aria-current={t.id === selectedId ? 'true' : undefined}
              onClick={() => selectTemplate(t.id)}
            >
              <span className="pf__list-name">{t.name}</span>
              <span className="pf__list-meta mono">
                {t.versions.length} ver{t.versions.length === 1 ? '' : 's'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <form
        className="pf__new"
        onSubmit={(e) => {
          e.preventDefault();
          onCreate();
        }}
      >
        <label className="pf__sr" htmlFor="pf-new">
          New template name
        </label>
        <input
          id="pf-new"
          className="pf__input"
          value={newName}
          placeholder="New template name"
          onChange={(e) => onNewName(e.target.value)}
        />
        <button type="submit" className="demo__btn">
          Add
        </button>
      </form>
    </nav>
  );
}

// ---------- header + tabs ----------

function TemplateHeader({
  tpl,
  view,
  onView,
}: {
  tpl: Template;
  view: View;
  onView: (v: View) => void;
}) {
  return (
    <div className="pf__topbar">
      <div className="pf__name-row">
        <label className="pf__sr" htmlFor="pf-name">
          Template name
        </label>
        <input
          id="pf-name"
          className="pf__name-input"
          value={tpl.name}
          onChange={(e) => renameTemplate(tpl.id, e.target.value)}
        />
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={() => deleteTemplate(tpl.id)}
        >
          Delete
        </button>
      </div>
      <div className="pf__tabs" role="tablist" aria-label="Workspace views">
        {(['editor', 'preview', 'versions'] as View[]).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            className={`pf__tab${view === v ? ' is-active' : ''}`}
            onClick={() => onView(v)}
          >
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- editor ----------

function Editor({ tpl }: { tpl: Template }) {
  const active = tpl.versions.find((v) => v.id === tpl.activeVersionId);
  const dirty = isDirty(tpl.body, tpl.vars, active);

  return (
    <div className="pf__editor" role="tabpanel" aria-label="Editor">
      <div className="pf__field">
        <label className="pf__label" htmlFor="pf-body">
          Template body
        </label>
        <textarea
          id="pf-body"
          className="pf__textarea mono"
          value={tpl.body}
          spellCheck={false}
          rows={10}
          placeholder="Write your template. Reference variables as {{name}}."
          onChange={(e) => setBody(tpl.id, e.target.value)}
        />
      </div>

      <div className="pf__vars">
        <h3 className="pf__subtitle">
          Variables{' '}
          <span className="pf__count mono">{tpl.vars.length}</span>
        </h3>
        {tpl.vars.length === 0 ? (
          <p className="pf__hint">
            Add a <code>{'{{placeholder}}'}</code> to the body and it appears
            here.
          </p>
        ) : (
          <ul className="pf__var-list">
            {tpl.vars.map((v) => (
              <VarRow key={v.name} tplId={tpl.id} def={v} />
            ))}
          </ul>
        )}
      </div>

      <div className="pf__save-row">
        <button
          type="button"
          className="demo__btn"
          disabled={!dirty}
          onClick={() => saveVersion(tpl.id)}
        >
          {tpl.versions.length === 0 ? 'Save first version' : 'Save version'}
        </button>
        <span className="pf__save-meta mono" aria-live="polite">
          {dirty ? 'Unsaved changes' : 'Saved'}
        </span>
      </div>
    </div>
  );
}

function VarRow({ tplId, def }: { tplId: string; def: VarDef }) {
  return (
    <li className="pf__var-row">
      <span className="pf__var-name mono">{def.name}</span>

      <label className="pf__sr" htmlFor={`type-${def.name}`}>
        Type for {def.name}
      </label>
      <select
        id={`type-${def.name}`}
        className="pf__select"
        value={def.type}
        onChange={(e) =>
          updateVar(tplId, def.name, { type: e.target.value as VarType })
        }
      >
        {VAR_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <label className="pf__sr" htmlFor={`default-${def.name}`}>
        Default for {def.name}
      </label>
      <input
        id={`default-${def.name}`}
        className="pf__input"
        value={def.default}
        placeholder="default"
        onChange={(e) =>
          updateVar(tplId, def.name, { default: e.target.value })
        }
      />

      {def.type === 'enum' && (
        <>
          <label className="pf__sr" htmlFor={`options-${def.name}`}>
            Options for {def.name}
          </label>
          <input
            id={`options-${def.name}`}
            className="pf__input pf__input--wide"
            value={def.options.join(', ')}
            placeholder="comma, separated, options"
            onChange={(e) =>
              updateVar(tplId, def.name, {
                options: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </>
      )}

      <button
        type="button"
        className="pf__var-remove"
        aria-label={`Remove variable ${def.name}`}
        onClick={() => removeVar(tplId, def.name)}
      >
        Remove
      </button>
    </li>
  );
}

// ---------- preview ----------

function Preview({
  tpl,
  values,
  onValue,
  copied,
  onCopied,
}: {
  tpl: Template;
  values: Record<string, string>;
  onValue: (name: string, value: string) => void;
  copied: boolean;
  onCopied: (v: boolean) => void;
}) {
  const result = useMemo(
    () => render(tpl.body, tpl.vars, values),
    [tpl.body, tpl.vars, values],
  );
  const clean = isClean(result);

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.output);
      onCopied(true);
      window.setTimeout(() => onCopied(false), 1500);
    } catch {
      onCopied(false);
    }
  }

  return (
    <div className="pf__preview" role="tabpanel" aria-label="Preview">
      <div className="pf__inputs">
        <h3 className="pf__subtitle">Values</h3>
        {tpl.vars.length === 0 ? (
          <p className="pf__hint">No variables declared yet.</p>
        ) : (
          <ul className="pf__input-list">
            {tpl.vars.map((v) => (
              <li key={v.name} className="pf__input-row">
                <label className="pf__input-label mono" htmlFor={`val-${v.name}`}>
                  {v.name}
                </label>
                {v.type === 'enum' ? (
                  <select
                    id={`val-${v.name}`}
                    className="pf__select"
                    value={values[v.name] ?? v.default}
                    onChange={(e) => onValue(v.name, e.target.value)}
                  >
                    <option value="">(choose)</option>
                    {v.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`val-${v.name}`}
                    className="pf__input"
                    type={v.type === 'number' ? 'number' : 'text'}
                    value={values[v.name] ?? ''}
                    placeholder={v.default || v.name}
                    onChange={(e) => onValue(v.name, e.target.value)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pf__output-pane">
        <div className="pf__output-head">
          <h3 className="pf__subtitle">Output</h3>
          <button type="button" className="demo__btn demo__btn--ghost" onClick={copy}>
            {copied ? 'Copied' : 'Copy output'}
          </button>
        </div>
        <pre className="pf__output mono" aria-live="polite">
          {result.output || '(empty)'}
        </pre>

        {!clean && (
          <div className="pf__warns" role="status">
            {result.undeclared.length > 0 && (
              <p className="pf__warn">
                Undeclared: {result.undeclared.join(', ')}
              </p>
            )}
            {result.missing.length > 0 && (
              <p className="pf__warn">Missing value: {result.missing.join(', ')}</p>
            )}
            {result.invalidEnum.length > 0 && (
              <p className="pf__warn">
                Not an allowed option: {result.invalidEnum.join(', ')}
              </p>
            )}
          </div>
        )}
        {clean && tpl.body !== '' && (
          <p className="pf__ok" role="status">
            All variables resolved.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------- versions ----------

function Versions({ tpl }: { tpl: Template }) {
  const versions = tpl.versions;
  const [left, setLeft] = useState<string>(versions[0]?.id ?? '');
  const [right, setRight] = useState<string>(
    versions[versions.length - 1]?.id ?? '',
  );

  const a = versions.find((v) => v.id === left);
  const b = versions.find((v) => v.id === right);
  const lines = useMemo(
    () => (a && b ? diffLines(a.body, b.body) : []),
    [a, b],
  );
  const stat = useMemo(() => diffStat(lines), [lines]);

  if (versions.length === 0) {
    return (
      <div className="pf__versions" role="tabpanel" aria-label="Versions">
        <p className="pf__hint">
          No versions yet. Save one from the editor to start a history.
        </p>
      </div>
    );
  }

  return (
    <div className="pf__versions" role="tabpanel" aria-label="Versions">
      <ul className="pf__ver-list">
        {versions.map((v) => (
          <li
            key={v.id}
            className={`pf__ver${v.id === tpl.activeVersionId ? ' is-active' : ''}`}
          >
            <div className="pf__ver-info">
              <span className="pf__ver-label mono">{v.label}</span>
              <span className="pf__ver-time">{formatTime(v.savedAt)}</span>
              {v.id === tpl.activeVersionId && (
                <span className="pf__ver-badge">active</span>
              )}
            </div>
            <button
              type="button"
              className="demo__btn demo__btn--ghost"
              onClick={() => activateVersion(tpl.id, v.id)}
            >
              Restore
            </button>
          </li>
        ))}
      </ul>

      <div className="pf__diff-controls">
        <label className="pf__diff-label">
          Base
          <select
            className="pf__select"
            value={left}
            onChange={(e) => setLeft(e.target.value)}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className="pf__diff-label">
          Compare
          <select
            className="pf__select"
            value={right}
            onChange={(e) => setRight(e.target.value)}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <span className="pf__diff-stat mono">
          +{stat.added} / -{stat.removed}
        </span>
      </div>

      <pre className="pf__diff mono" aria-label="Line diff">
        {lines.length === 0 ? (
          <span className="pf__diff-same">(no lines)</span>
        ) : (
          lines.map((line, i) => (
            <span key={i} className={`pf__diff-${line.kind}`}>
              {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '- ' : '  '}
              {line.text}
              {'\n'}
            </span>
          ))
        )}
      </pre>
    </div>
  );
}
