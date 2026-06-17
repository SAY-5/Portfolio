import { useMemo, useState } from 'react';
import '../styles/demo.css';
import './queryflow.css';
import { ordersTable, columnByName } from './queryflow/data';
import {
  OPS_BY_TYPE,
  OP_LABELS,
  aggKey,
  opNeedsValue,
  runQuery,
  toSql,
} from './queryflow/engine';
import { useStore } from './queryflow/state';
import {
  addAggregate,
  addCondition,
  clearSaved,
  deleteSaved,
  getState,
  loadSaved,
  removeAggregate,
  removeCondition,
  resetQuery,
  saveQuery,
  setCombine,
  setLimit,
  setOrderBy,
  stampSavedAt,
  toggleColumn,
  toggleGroupBy,
  updateCondition,
} from './queryflow/store';
import type {
  Aggregate,
  AggregateSpec,
  Operator,
  Query,
  SavedQuery,
  SortDir,
} from './queryflow/types';

// QueryFlow is an in-browser visual query builder. It runs structured data
// queries over a seeded in-memory orders table using the engine in
// queryflow/engine.ts. A query is assembled from the UI (columns, typed WHERE
// filters with AND/OR, GROUP BY plus aggregates, ORDER BY, LIMIT), executed
// with plain JavaScript, and rendered as a result table next to a read-only
// SQL-like preview. The preview is display text only and is never executed,
// and nothing here uses eval or talks to a server. Saved queries persist in
// localStorage.

const AGG_FNS: Aggregate[] = ['count', 'sum', 'avg', 'min', 'max'];
const table = ordersTable;
const NUMERIC_COLS = table.columns.filter((c) => c.type === 'number').map((c) => c.name);

function defaultOpFor(field: string): Operator {
  const col = columnByName(table, field);
  return col ? OPS_BY_TYPE[col.type][0] : 'eq';
}

function aggLabel(a: AggregateSpec): string {
  const arg = a.fn === 'count' && a.field === '*' ? '*' : a.field;
  return `${a.fn.toUpperCase()}(${arg})`;
}

function formatCell(value: unknown): string {
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (value === null || value === undefined) return '';
  return String(value);
}

// Format a stored save-time. The number is a snapshot taken at save time, not
// a clock read during render, so this stays a pure function of its input.
function formatSavedAt(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')} ${hh}:${mm}`;
}

export default function QueryflowDemo() {
  const { query, saved } = useStore();
  const [result, setResult] = useState<ReturnType<typeof runQuery> | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [name, setName] = useState('');

  // New-filter and new-aggregate draft controls.
  const [filterField, setFilterField] = useState(table.columns[0].name);
  const [aggField, setAggField] = useState<string>('*');
  const [aggFn, setAggFn] = useState<Aggregate>('count');

  const sql = useMemo(() => toSql(table, query), [query]);
  const grouped = query.groupBy.length > 0 || query.aggregates.length > 0;
  const resultColumns: string[] = grouped
    ? [...query.groupBy, ...query.aggregates.map(aggKey)]
    : query.columns.length > 0
      ? query.columns
      : table.columns.map((c) => c.name);

  function run() {
    // Measure the synchronous engine run, snapshotting the timing into state
    // rather than reading any clock during render.
    const t0 = performance.now();
    const res = runQuery(table, query);
    const ms = performance.now() - t0;
    setResult(res);
    setElapsed(Math.round(ms * 1000) / 1000);
  }

  function onSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveQuery(trimmed);
    // The store puts the just-saved entry at the head of the list; stamp it
    // with a clock snapshot taken here in the event handler, not in render.
    const entry = getState().saved.find((s) => s.name === trimmed);
    if (entry) stampSavedAt(entry.id, Date.now());
    setName('');
  }

  return (
    <section className="demo qf" aria-label="QueryFlow visual query builder">
      <span className="demo__tag">in-browser query builder</span>
      <h2 className="demo__title">QueryFlow</h2>
      <p className="demo__lede">
        Build a structured query over a seeded orders table, run it in the
        browser, and read the SQL-like preview it produces. The preview is shown
        for reference only and is never executed: queries run as plain
        JavaScript over an in-memory dataset, with no eval and no server.
      </p>

      <div className="qf__grid">
        <div className="qf__builder">
          <ColumnPicker query={query} />
          <FilterBuilder
            query={query}
            filterField={filterField}
            setFilterField={setFilterField}
          />
          <GroupAggregate
            query={query}
            aggField={aggField}
            setAggField={setAggField}
            aggFn={aggFn}
            setAggFn={setAggFn}
          />
          <OrderLimit query={query} resultColumns={resultColumns} />
        </div>

        <div className="qf__side">
          <SqlPreview sql={sql} />
          <SaveBar name={name} setName={setName} onSave={onSave} saved={saved} />
        </div>
      </div>

      <div className="demo__controls">
        <button type="button" className="demo__btn" onClick={run}>
          Run query
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={() => {
            resetQuery();
            setResult(null);
            setElapsed(null);
          }}
        >
          Reset query
        </button>
        {result && !result.error && (
          <span className="demo__hint" role="status">
            {result.rowCount} row{result.rowCount === 1 ? '' : 's'}
            {elapsed !== null ? ` in ${elapsed} ms` : ''}
          </span>
        )}
      </div>

      <Results result={result} columns={resultColumns} />
    </section>
  );
}

// ---------- column picker ----------

function ColumnPicker({ query }: { query: Query }) {
  const grouped = query.groupBy.length > 0 || query.aggregates.length > 0;
  return (
    <fieldset className="qf__panel glass" disabled={grouped}>
      <legend className="qf__legend">Columns</legend>
      {grouped && (
        <p className="qf__note">
          Grouped queries return the group keys and aggregates below.
        </p>
      )}
      <div className="qf__cols" role="group" aria-label="Select output columns">
        {table.columns.map((c) => (
          <label key={c.name} className="qf__check">
            <input
              type="checkbox"
              checked={query.columns.includes(c.name)}
              onChange={() => toggleColumn(c.name)}
            />
            <span className="qf__col-name mono">{c.name}</span>
            <span className="qf__col-type">{c.type}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ---------- filter builder ----------

function FilterBuilder({
  query,
  filterField,
  setFilterField,
}: {
  query: Query;
  filterField: string;
  setFilterField: (v: string) => void;
}) {
  return (
    <fieldset className="qf__panel glass">
      <legend className="qf__legend">Filters (WHERE)</legend>

      {query.conditions.length > 1 && (
        <div className="qf__combine" role="radiogroup" aria-label="Combine filters">
          {(['AND', 'OR'] as const).map((c) => (
            <label key={c} className="qf__radio">
              <input
                type="radio"
                name="qf-combine"
                checked={query.combine === c}
                onChange={() => setCombine(c)}
              />
              <span className="mono">{c}</span>
            </label>
          ))}
        </div>
      )}

      <ul className="qf__conds">
        {query.conditions.map((cond) => {
          const col = columnByName(table, cond.field);
          const ops = col ? OPS_BY_TYPE[col.type] : [];
          const needsValue = opNeedsValue(cond.op);
          return (
            <li key={cond.id} className="qf__cond">
              <select
                className="qf__sel mono"
                aria-label="Filter field"
                value={cond.field}
                onChange={(e) => {
                  const field = e.target.value;
                  updateCondition(cond.id, { field, op: defaultOpFor(field), value: '' });
                }}
              >
                {table.columns.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
              <select
                className="qf__sel mono"
                aria-label="Filter operator"
                value={cond.op}
                onChange={(e) => updateCondition(cond.id, { op: e.target.value as Operator })}
              >
                {ops.map((op) => (
                  <option key={op} value={op}>{OP_LABELS[op]}</option>
                ))}
              </select>
              {needsValue ? (
                <input
                  className="qf__input mono"
                  aria-label="Filter value"
                  type={col?.type === 'date' ? 'date' : 'text'}
                  value={cond.value}
                  placeholder={col?.type === 'number' ? '0' : 'value'}
                  onChange={(e) => updateCondition(cond.id, { value: e.target.value })}
                />
              ) : (
                <span className="qf__cond-fixed mono">{OP_LABELS[cond.op]}</span>
              )}
              <button
                type="button"
                className="qf__icon-btn"
                aria-label={`Remove filter on ${cond.field}`}
                onClick={() => removeCondition(cond.id)}
              >
                ×
              </button>
            </li>
          );
        })}
        {query.conditions.length === 0 && (
          <li className="qf__empty">No filters: every row is returned.</li>
        )}
      </ul>

      <div className="qf__add-row">
        <select
          className="qf__sel mono"
          aria-label="New filter field"
          value={filterField}
          onChange={(e) => setFilterField(e.target.value)}
        >
          {table.columns.map((c) => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>
        <button
          type="button"
          className="demo__btn demo__btn--ghost qf__add-btn"
          onClick={() => addCondition(filterField, defaultOpFor(filterField), '')}
        >
          Add filter
        </button>
      </div>
    </fieldset>
  );
}

// ---------- group by + aggregates ----------

function GroupAggregate({
  query,
  aggField,
  setAggField,
  aggFn,
  setAggFn,
}: {
  query: Query;
  aggField: string;
  setAggField: (v: string) => void;
  aggFn: Aggregate;
  setAggFn: (v: Aggregate) => void;
}) {
  const fieldNeedsNumber = aggFn !== 'count';
  return (
    <fieldset className="qf__panel glass">
      <legend className="qf__legend">Group and aggregate</legend>

      <div className="qf__cols" role="group" aria-label="Group by columns">
        {table.columns
          .filter((c) => c.type !== 'number')
          .map((c) => (
            <label key={c.name} className="qf__check">
              <input
                type="checkbox"
                checked={query.groupBy.includes(c.name)}
                onChange={() => toggleGroupBy(c.name)}
              />
              <span className="qf__col-name mono">{c.name}</span>
            </label>
          ))}
      </div>

      <ul className="qf__aggs">
        {query.aggregates.map((a) => (
          <li key={a.id} className="qf__agg">
            <span className="qf__agg-label mono">{aggLabel(a)}</span>
            <button
              type="button"
              className="qf__icon-btn"
              aria-label={`Remove aggregate ${aggLabel(a)}`}
              onClick={() => removeAggregate(a.id)}
            >
              ×
            </button>
          </li>
        ))}
        {query.aggregates.length === 0 && (
          <li className="qf__empty">No aggregates yet.</li>
        )}
      </ul>

      <div className="qf__add-row">
        <select
          className="qf__sel mono"
          aria-label="Aggregate function"
          value={aggFn}
          onChange={(e) => {
            const fn = e.target.value as Aggregate;
            setAggFn(fn);
            if (fn !== 'count' && !NUMERIC_COLS.includes(aggField)) {
              setAggField(NUMERIC_COLS[0] ?? '*');
            }
          }}
        >
          {AGG_FNS.map((fn) => (
            <option key={fn} value={fn}>{fn.toUpperCase()}</option>
          ))}
        </select>
        <select
          className="qf__sel mono"
          aria-label="Aggregate field"
          value={aggField}
          onChange={(e) => setAggField(e.target.value)}
        >
          {!fieldNeedsNumber && <option value="*">*</option>}
          {(fieldNeedsNumber ? NUMERIC_COLS : table.columns.map((c) => c.name)).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <button
          type="button"
          className="demo__btn demo__btn--ghost qf__add-btn"
          onClick={() => addAggregate(aggFn, aggField)}
        >
          Add aggregate
        </button>
      </div>
    </fieldset>
  );
}

// ---------- order by + limit ----------

function OrderLimit({
  query,
  resultColumns,
}: {
  query: Query;
  resultColumns: string[];
}) {
  return (
    <fieldset className="qf__panel glass">
      <legend className="qf__legend">Order and limit</legend>
      <div className="qf__order">
        <label className="qf__field">
          <span className="qf__field-label">Order by</span>
          <select
            className="qf__sel mono"
            value={query.orderBy?.field ?? ''}
            onChange={(e) => {
              const field = e.target.value;
              if (!field) {
                setOrderBy(null);
                return;
              }
              setOrderBy({ field, dir: query.orderBy?.dir ?? 'asc' });
            }}
          >
            <option value="">none</option>
            {resultColumns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="qf__field">
          <span className="qf__field-label">Direction</span>
          <select
            className="qf__sel mono"
            disabled={!query.orderBy}
            value={query.orderBy?.dir ?? 'asc'}
            onChange={(e) =>
              query.orderBy &&
              setOrderBy({ field: query.orderBy.field, dir: e.target.value as SortDir })
            }
          >
            <option value="asc">asc</option>
            <option value="desc">desc</option>
          </select>
        </label>
        <label className="qf__field">
          <span className="qf__field-label">Limit</span>
          <input
            className="qf__input mono"
            type="number"
            min={0}
            value={query.limit ?? ''}
            placeholder="none"
            onChange={(e) => {
              const v = e.target.value;
              setLimit(v === '' ? null : Math.max(0, Math.floor(Number(v))));
            }}
          />
        </label>
      </div>
    </fieldset>
  );
}

// ---------- sql preview ----------

function SqlPreview({ sql }: { sql: string }) {
  return (
    <section className="qf__panel glass" aria-label="SQL preview">
      <h3 className="qf__legend">SQL-like preview</h3>
      <p className="qf__note">Display only. This text is never executed.</p>
      <pre className="qf__sql mono" tabIndex={0}>{sql}</pre>
    </section>
  );
}

// ---------- save bar + saved list ----------

function SaveBar({
  name,
  setName,
  onSave,
  saved,
}: {
  name: string;
  setName: (v: string) => void;
  onSave: () => void;
  saved: SavedQuery[];
}) {
  return (
    <section className="qf__panel glass" aria-label="Saved queries">
      <h3 className="qf__legend">Saved queries</h3>
      <form
        className="qf__save-row"
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <input
          className="qf__input mono"
          aria-label="Query name"
          value={name}
          placeholder="name this query"
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="demo__btn demo__btn--ghost qf__add-btn">
          Save
        </button>
      </form>
      <ul className="qf__saved">
        {saved.map((s) => (
          <li key={s.id} className="qf__saved-item">
            <button
              type="button"
              className="qf__saved-load mono"
              onClick={() => loadSaved(s.id)}
            >
              <span className="qf__saved-name">{s.name}</span>
              {s.savedAt > 0 && (
                <span className="qf__saved-when">{formatSavedAt(s.savedAt)}</span>
              )}
            </button>
            <button
              type="button"
              className="qf__icon-btn"
              aria-label={`Delete saved query ${s.name}`}
              onClick={() => deleteSaved(s.id)}
            >
              ×
            </button>
          </li>
        ))}
        {saved.length === 0 && <li className="qf__empty">No saved queries yet.</li>}
      </ul>
      {saved.length > 0 && (
        <button type="button" className="qf__clear mono" onClick={clearSaved}>
          Clear all saved queries
        </button>
      )}
    </section>
  );
}

// ---------- results ----------

function Results({
  result,
  columns,
}: {
  result: ReturnType<typeof runQuery> | null;
  columns: string[];
}) {
  if (!result) {
    return (
      <div className="qf__results qf__results--idle" role="status">
        Build a query and press Run to see results.
      </div>
    );
  }
  if (result.error) {
    return (
      <div className="qf__results qf__results--error" role="alert">
        {result.error}
      </div>
    );
  }
  const cols = result.columns.length > 0 ? result.columns : columns;
  return (
    <div className="qf__results">
      <div
        className="qf__table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Query results"
      >
        <table className="qf__table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c} scope="col" className="mono">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c} className="mono">{formatCell(row[c])}</td>
                ))}
              </tr>
            ))}
            {result.rows.length === 0 && (
              <tr>
                <td className="qf__empty" colSpan={cols.length}>
                  No rows match this query.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
