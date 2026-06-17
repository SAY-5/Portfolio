import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './streamcatalog.css';
import { useStore } from './streamcatalog/state';
import {
  addConsumer,
  addProducer,
  currentVersion,
  findTopic,
  previewChange,
  registerVersion,
  removeConsumer,
  removeProducer,
  resetAll,
  type Topic,
} from './streamcatalog/store';
import { VERDICT_LABEL } from './streamcatalog/engine';
import { FIELD_TYPES, type Field, type FieldType, type Verdict } from './streamcatalog/types';

// In-browser stream/topic catalog and schema-compatibility checker. Topics, the
// full schema-version history, and producers/consumers persist in localStorage.
// Selecting a topic shows its current schema, its version history, and who
// writes and reads it. The schema editor proposes a new version (add, remove,
// retype, or toggle required on fields) and shows a live compatibility verdict
// with a reason for every change, before you register it. A breaking change can
// be registered only with an explicit override, and the affected consumers are
// named. Nothing here uses eval.

const ease = [0.22, 1, 0.36, 1] as const;

const VERDICT_TONE: Record<Verdict, string> = {
  full: 'ok',
  backward: 'ok',
  forward: 'ok',
  breaking: 'bad',
};

// A draft row in the schema editor; `key` keeps row identity stable while the
// name is edited.
type DraftField = Field & { key: string };

let draftSeq = 0;
function draftKey(): string {
  draftSeq += 1;
  return `d${draftSeq}`;
}

function toDraft(fields: Field[]): DraftField[] {
  return fields.map((f) => ({ ...f, key: draftKey() }));
}

export default function StreamcatalogDemo() {
  const reduce = useReducedMotion();
  const { topics } = useStore();
  const [activeId, setActiveId] = useState(topics[0]?.id ?? '');
  const [draft, setDraft] = useState<DraftField[] | null>(null);
  const [allowBreaking, setAllowBreaking] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [prodName, setProdName] = useState('');
  const [consName, setConsName] = useState('');

  const active = findTopic(activeId) ?? topics[0];

  const proposed: Field[] | null = useMemo(
    () => (draft ? draft.map(({ name, type, required }) => ({ name, type, required })) : null),
    [draft],
  );

  const report = useMemo(
    () => (active && proposed ? previewChange(active.id, proposed) : null),
    [active, proposed],
  );

  if (!active) return null;
  const cur = currentVersion(active);

  // Consumers put at risk when a breaking change is registered: such a change
  // can stop existing readers from decoding the stream.
  const affectedConsumers =
    report && report.verdict === 'breaking' ? active.consumers : [];

  function select(id: string) {
    setActiveId(id);
    setDraft(null);
    setAllowBreaking(false);
    setFlash(null);
  }

  function startEdit(topic: Topic) {
    setDraft(toDraft(currentVersion(topic).fields));
    setAllowBreaking(false);
    setFlash(null);
  }

  function cancelEdit() {
    setDraft(null);
    setAllowBreaking(false);
  }

  function updateField(key: string, patch: Partial<Field>) {
    setDraft((d) => (d ? d.map((f) => (f.key === key ? { ...f, ...patch } : f)) : d));
  }

  function removeField(key: string) {
    setDraft((d) => (d ? d.filter((f) => f.key !== key) : d));
  }

  function addField() {
    setDraft((d) =>
      d
        ? [...d, { key: draftKey(), name: `field${d.length + 1}`, type: 'string', required: false }]
        : d,
    );
  }

  function register() {
    if (!proposed) return;
    // Snapshot the clock once here so the store and render stay clock-free.
    const now = Date.now();
    const result = registerVersion(active.id, proposed, allowBreaking, now);
    if (result.ok) {
      setFlash({ ok: true, text: `registered v${result.version}: ${VERDICT_LABEL[result.report.verdict]}` });
      setDraft(null);
      setAllowBreaking(false);
    } else {
      setFlash({ ok: false, text: result.reason });
    }
  }

  function submitProducer(e: React.FormEvent) {
    e.preventDefault();
    addProducer(active.id, prodName);
    setProdName('');
  }

  function submitConsumer(e: React.FormEvent) {
    e.preventDefault();
    addConsumer(active.id, consName);
    setConsName('');
  }

  return (
    <div className="demo sc" aria-label="streamcatalog topic catalog and schema compatibility demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Browse topics, evolve schemas safely</h3>
      <p className="demo__lede">
        Pick a topic to inspect its current schema, its version history, and who
        writes and reads it. Propose a new schema version and a pure engine scores
        it as compatible or breaking with a reason for every change, before you
        register it. Everything persists in your browser.
      </p>

      <div className="sc__layout">
        <nav className="sc__list glass" aria-label="topics">
          <h4 className="sc__list-head">Topics</h4>
          <ul className="sc__list-items">
            {topics.map((t) => {
              const v = currentVersion(t);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`sc__list-item ${t.id === active.id ? 'is-active' : ''}`}
                    aria-current={t.id === active.id ? 'true' : undefined}
                    onClick={() => select(t.id)}
                  >
                    <span className="sc__list-name mono">{t.name}</span>
                    <span className="sc__list-meta">
                      <span className="sc__chip">v{v.version}</span>
                      <span className="sc__chip">{v.fields.length} fields</span>
                      <span className="sc__chip">{t.producers.length}P</span>
                      <span className="sc__chip">{t.consumers.length}C</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section className="sc__detail" aria-label={`topic ${active.name}`}>
          <header className="sc__detail-head">
            <div>
              <h4 className="sc__detail-name mono">{active.name}</h4>
              <p className="sc__detail-desc">{active.description}</p>
            </div>
            <span className="sc__version-pill">current v{cur.version}</span>
          </header>

          {!draft && (
            <div className="sc__panel glass">
              <div className="sc__panel-head">
                <h5 className="sc__panel-title">Current schema</h5>
                <button type="button" className="demo__btn sc__btn-sm" onClick={() => startEdit(active)}>
                  Propose change
                </button>
              </div>
              <SchemaTable fields={cur.fields} />
            </div>
          )}

          {draft && (
            <div className="sc__panel glass">
              <div className="sc__panel-head">
                <h5 className="sc__panel-title">Proposed schema (from v{cur.version})</h5>
                <button type="button" className="demo__btn demo__btn--ghost sc__btn-sm" onClick={cancelEdit}>
                  Cancel
                </button>
              </div>

              <div className="sc__editor" role="group" aria-label="proposed schema fields">
                <div className="sc__erow sc__erow--head" aria-hidden="true">
                  <span>field</span>
                  <span>type</span>
                  <span>required</span>
                  <span />
                </div>
                {draft.map((f) => (
                  <div className="sc__erow" key={f.key}>
                    <input
                      className="sc__input mono"
                      value={f.name}
                      aria-label="field name"
                      onChange={(e) => updateField(f.key, { name: e.target.value })}
                    />
                    <select
                      className="sc__select mono"
                      value={f.type}
                      aria-label={`type of ${f.name}`}
                      onChange={(e) => updateField(f.key, { type: e.target.value as FieldType })}
                    >
                      {FIELD_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <label className="sc__req">
                      <input
                        type="checkbox"
                        checked={f.required}
                        aria-label={`${f.name} required`}
                        onChange={(e) => updateField(f.key, { required: e.target.checked })}
                      />
                      <span>required</span>
                    </label>
                    <button
                      type="button"
                      className="sc__row-del"
                      aria-label={`remove field ${f.name}`}
                      onClick={() => removeField(f.key)}
                    >
                      remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="demo__btn demo__btn--ghost sc__btn-sm sc__add-field"
                  onClick={addField}
                >
                  Add field
                </button>
              </div>

              {report && (
                <div
                  className={`sc__verdict sc__verdict--${VERDICT_TONE[report.verdict]}`}
                  role="status"
                  aria-live="polite"
                >
                  <div className="sc__verdict-head">
                    <span className="sc__verdict-label">{VERDICT_LABEL[report.verdict]}</span>
                    {report.identical && <span className="sc__verdict-sub">no change from current</span>}
                  </div>
                  {report.changes.length > 0 && (
                    <ul className="sc__reasons">
                      {report.changes.map((c) => (
                        <li
                          key={c.field + c.kind}
                          className={c.backward && c.forward ? 'ok' : c.backward || c.forward ? 'warn' : 'bad'}
                        >
                          {c.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                  {affectedConsumers.length > 0 && (
                    <p className="sc__impact">
                      breaking change affects {affectedConsumers.length} consumer
                      {affectedConsumers.length === 1 ? '' : 's'}:{' '}
                      {affectedConsumers.map((c) => c.name).join(', ')}
                    </p>
                  )}
                </div>
              )}

              <div className="sc__register">
                {report && report.verdict === 'breaking' && (
                  <label className="sc__req sc__override">
                    <input
                      type="checkbox"
                      checked={allowBreaking}
                      onChange={(e) => setAllowBreaking(e.target.checked)}
                    />
                    <span>allow breaking change</span>
                  </label>
                )}
                <button
                  type="button"
                  className="demo__btn"
                  disabled={
                    !report || report.identical || (report.verdict === 'breaking' && !allowBreaking)
                  }
                  onClick={register}
                >
                  Register v{cur.version + 1}
                </button>
              </div>
            </div>
          )}

          <AnimatePresence>
            {flash && (
              <motion.div
                key={flash.text}
                className={`sc__flash ${flash.ok ? 'is-ok' : 'is-bad'}`}
                role="status"
                aria-live="polite"
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.25, ease }}
              >
                {flash.text}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="sc__panel glass">
            <h5 className="sc__panel-title">Version history</h5>
            <ol className="sc__history">
              {[...active.versions].reverse().map((v) => (
                <li key={v.version} className={v.version === cur.version ? 'is-current' : ''}>
                  <span className="sc__hist-v mono">v{v.version}</span>
                  <span className="sc__hist-note">{v.note}</span>
                  <span className="sc__hist-count">{v.fields.length} fields</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="sc__io">
            <EndpointPanel
              title="Producers"
              kind="producer"
              endpoints={active.producers}
              value={prodName}
              onValue={setProdName}
              onSubmit={submitProducer}
              onRemove={(id) => removeProducer(active.id, id)}
            />
            <EndpointPanel
              title="Consumers"
              kind="consumer"
              endpoints={active.consumers}
              value={consName}
              onValue={setConsName}
              onSubmit={submitConsumer}
              onRemove={(id) => removeConsumer(active.id, id)}
            />
          </div>
        </section>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn demo__btn--ghost"
          type="button"
          onClick={() => {
            resetAll();
            select(topics[0].id);
          }}
        >
          Reset catalog
        </button>
        <span className="demo__hint">
          compatible versions register directly; a breaking change needs an explicit override.
        </span>
      </div>
    </div>
  );
}

function SchemaTable({ fields }: { fields: Field[] }) {
  return (
    <table className="sc__schema">
      <thead>
        <tr>
          <th scope="col">field</th>
          <th scope="col">type</th>
          <th scope="col">required</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((f) => (
          <tr key={f.name}>
            <td className="mono">{f.name}</td>
            <td className="mono">{f.type}</td>
            <td>{f.required ? 'yes' : 'no'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type EndpointPanelProps = {
  title: string;
  kind: 'producer' | 'consumer';
  endpoints: { id: string; name: string }[];
  value: string;
  onValue: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onRemove: (id: string) => void;
};

function EndpointPanel({ title, kind, endpoints, value, onValue, onSubmit, onRemove }: EndpointPanelProps) {
  return (
    <div className="sc__panel glass">
      <h5 className="sc__panel-title">
        {title} <span className="sc__count-badge">{endpoints.length}</span>
      </h5>
      <ul className="sc__endpoints">
        {endpoints.map((e) => (
          <li key={e.id}>
            <span className="mono">{e.name}</span>
            <button
              type="button"
              className="sc__row-del"
              aria-label={`remove ${kind} ${e.name}`}
              onClick={() => onRemove(e.id)}
            >
              remove
            </button>
          </li>
        ))}
        {endpoints.length === 0 && <li className="sc__empty">none registered</li>}
      </ul>
      <form className="sc__add" onSubmit={onSubmit}>
        <input
          className="sc__input mono"
          value={value}
          placeholder={`add ${kind}`}
          aria-label={`new ${kind} name`}
          onChange={(e) => onValue(e.target.value)}
        />
        <button type="submit" className="demo__btn demo__btn--ghost sc__btn-sm">
          Add
        </button>
      </form>
    </div>
  );
}
