import { useMemo, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './export-validator.css';
import { useStore } from './export-validator/state';
import {
  addRule,
  allFields,
  invalidRowsCsv,
  removeRule,
  resetAll,
  runValidation,
  setRecordsFromText,
  setRuleEnum,
  updateRule,
} from './export-validator/store';
import type {
  DataRecord,
  FieldRule,
  FieldType,
  RecordResult,
  RuleKind,
  ValidationResult,
} from './export-validator/types';

// In-browser export validator. A ruleset of per-field rules (required, type,
// a safely compiled regex, numeric bounds, an enum, and uniqueness) is checked
// against a tabular record set pasted as CSV or JSON. The engine is pure and
// the parsers read text only, so nothing is eval'd and nothing leaves the page.
// The ruleset, records, and last result persist in localStorage.

const TYPES: FieldType[] = ['string', 'number', 'bool', 'date'];

const RULE_LABELS: Record<RuleKind, string> = {
  required: 'Required',
  type: 'Type',
  pattern: 'Pattern',
  min: 'Below min',
  max: 'Above max',
  enum: 'Enum',
  unique: 'Unique',
};

// Quote a cell for CSV when it carries a comma, quote, or newline.
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Render the record set back into editable CSV text for the paste pane.
function recordsToText(fields: string[], records: DataRecord[]): string {
  const header = fields.join(',');
  const lines = records.map((r) => fields.map((f) => csvCell(r[f] ?? '')).join(','));
  return [header, ...lines].join('\n');
}

export default function ExportValidatorDemo() {
  const { ruleset, records, result } = useStore();
  const reduce = useReducedMotion();
  const fields = useMemo(
    () => allFields({ ruleset, records, result }),
    [ruleset, records, result],
  );

  // The records pane is an editable text buffer. While untouched it mirrors the
  // store; once edited it commits on blur or when Run validation is pressed.
  const storeText = useMemo(() => recordsToText(fields, records), [fields, records]);
  const [draft, setDraft] = useState<string | null>(null);
  const shownDraft = draft ?? storeText;

  const resultByIndex = useMemo(() => {
    const map = new Map<number, RecordResult>();
    if (result) for (const r of result.records) map.set(r.index, r);
    return map;
  }, [result]);

  function commitDraft() {
    if (draft !== null) {
      setRecordsFromText(draft);
      setDraft(null);
    }
  }

  function handleRun() {
    commitDraft();
    runValidation();
  }

  function handleReset() {
    resetAll();
    setDraft(null);
  }

  function exportInvalid() {
    const csv = invalidRowsCsv({ ruleset, records, result });
    if (!csv) return;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'invalid-rows.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="demo" aria-labelledby="vex-title">
      <span className="demo__tag">export validator</span>
      <h3 className="demo__title" id="vex-title">
        Validate a tabular export against a field ruleset
      </h3>
      <p className="demo__lede">
        Define per-field rules, paste records as CSV or JSON, then run the
        checks. Each record is marked pass or fail with its failing fields
        highlighted, and the report groups every issue by the rule that caught
        it. Validation runs in the browser over a pure engine; patterns compile
        through a guarded RegExp, never eval.
      </p>

      <RulesetTable fields={ruleset.fields} />

      <RecordsPane
        value={shownDraft}
        onChange={(v) => setDraft(v)}
        onBlur={commitDraft}
      />

      <FieldsTable
        fields={fields}
        records={records}
        resultByIndex={resultByIndex}
        reduce={Boolean(reduce)}
      />

      <div className="demo__controls">
        <button type="button" className="demo__btn" onClick={handleRun}>
          Run validation
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={exportInvalid}
          disabled={!result || result.invalidCount === 0}
        >
          Export invalid rows
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={handleReset}
        >
          Reset
        </button>
        <span className="demo__hint" role="status">
          {result
            ? `${result.validCount} valid / ${result.invalidCount} invalid of ${result.total}`
            : 'no run yet'}
        </span>
      </div>

      {result ? <Report result={result} /> : null}
    </section>
  );
}

// ---------- ruleset table ----------

function RulesetTable({ fields }: { fields: FieldRule[] }) {
  return (
    <div className="vex__block">
      <div className="vex__block-head">
        <h4 className="vex__block-title">Field rules</h4>
        <button type="button" className="vex__add" onClick={addRule}>
          + Add field
        </button>
      </div>
      <div className="vex__scroll">
        <table className="vex__table" aria-label="Field rules">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Type</th>
              <th scope="col">Required</th>
              <th scope="col">Pattern</th>
              <th scope="col">Min</th>
              <th scope="col">Max</th>
              <th scope="col">Enum</th>
              <th scope="col">Unique</th>
              <th scope="col">
                <span className="vex__sr">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {fields.map((rule) => (
              <RuleRow key={rule.id} rule={rule} />
            ))}
            {fields.length === 0 ? (
              <tr>
                <td colSpan={9} className="vex__empty">
                  No rules. Add a field to start.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RuleRow({ rule }: { rule: FieldRule }) {
  const isNumber = rule.type === 'number';
  return (
    <tr>
      <td>
        <input
          className="vex__in"
          aria-label={`field name for ${rule.field}`}
          value={rule.field}
          onChange={(e) => updateRule(rule.id, { field: e.target.value })}
        />
      </td>
      <td>
        <select
          className="vex__in"
          aria-label={`type for ${rule.field}`}
          value={rule.type}
          onChange={(e) => updateRule(rule.id, { type: e.target.value as FieldType })}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </td>
      <td className="vex__center">
        <input
          type="checkbox"
          aria-label={`required for ${rule.field}`}
          checked={rule.required}
          onChange={(e) => updateRule(rule.id, { required: e.target.checked })}
        />
      </td>
      <td>
        <input
          className="vex__in vex__in--mono"
          aria-label={`pattern for ${rule.field}`}
          placeholder="(none)"
          value={rule.pattern ?? ''}
          onChange={(e) => updateRule(rule.id, { pattern: e.target.value })}
        />
      </td>
      <td>
        <input
          className="vex__in vex__in--num"
          type="number"
          aria-label={`min for ${rule.field}`}
          disabled={!isNumber}
          value={rule.min ?? ''}
          onChange={(e) =>
            updateRule(rule.id, {
              min: e.target.value === '' ? undefined : Number(e.target.value),
            })
          }
        />
      </td>
      <td>
        <input
          className="vex__in vex__in--num"
          type="number"
          aria-label={`max for ${rule.field}`}
          disabled={!isNumber}
          value={rule.max ?? ''}
          onChange={(e) =>
            updateRule(rule.id, {
              max: e.target.value === '' ? undefined : Number(e.target.value),
            })
          }
        />
      </td>
      <td>
        <input
          className="vex__in"
          aria-label={`allowed values for ${rule.field}`}
          placeholder="a, b, c"
          value={rule.enum ? rule.enum.join(', ') : ''}
          onChange={(e) => setRuleEnum(rule.id, e.target.value)}
        />
      </td>
      <td className="vex__center">
        <input
          type="checkbox"
          aria-label={`unique for ${rule.field}`}
          checked={rule.unique}
          onChange={(e) => updateRule(rule.id, { unique: e.target.checked })}
        />
      </td>
      <td className="vex__center">
        <button
          type="button"
          className="vex__del"
          aria-label={`remove ${rule.field}`}
          onClick={() => removeRule(rule.id)}
        >
          &times;
        </button>
      </td>
    </tr>
  );
}

// ---------- records paste pane ----------

function RecordsPane({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <div className="vex__block">
      <div className="vex__block-head">
        <h4 className="vex__block-title">Records</h4>
        <span className="vex__hint">paste CSV or a JSON array of objects</span>
      </div>
      <label className="vex__sr" htmlFor="vex-records">
        Records as CSV or JSON
      </label>
      <textarea
        id="vex-records"
        className="vex__textarea"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        rows={8}
      />
    </div>
  );
}

// ---------- per-record results table ----------

function FieldsTable({
  fields,
  records,
  resultByIndex,
  reduce,
}: {
  fields: string[];
  records: DataRecord[];
  resultByIndex: Map<number, RecordResult>;
  reduce: boolean;
}) {
  return (
    <div className="vex__block">
      <div className="vex__block-head">
        <h4 className="vex__block-title">Parsed rows</h4>
        <span className="vex__hint">{records.length} rows</span>
      </div>
      <div className="vex__scroll">
        <table className="vex__table vex__table--rows" aria-label="Parsed records">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Result</th>
              {fields.map((f) => (
                <th scope="col" key={f}>
                  {f}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((record, idx) => {
              const res = resultByIndex.get(idx);
              const failing = new Set(res?.failingFields ?? []);
              const status: 'none' | 'pass' | 'fail' = !res
                ? 'none'
                : res.ok
                  ? 'pass'
                  : 'fail';
              return (
                <tr key={idx} className={`vex__row vex__row--${status}`}>
                  <td className="vex__idx">{idx + 1}</td>
                  <td>
                    <span
                      className={`vex__badge vex__badge--${status}`}
                      data-reduce={reduce ? 'true' : 'false'}
                    >
                      {status === 'none' ? 'idle' : status}
                    </span>
                  </td>
                  {fields.map((f) => {
                    const bad = failing.has(f);
                    return (
                      <td
                        key={f}
                        className={bad ? 'vex__cell vex__cell--bad' : 'vex__cell'}
                        title={
                          bad
                            ? res?.issues
                                .filter((i) => i.field === f)
                                .map((i) => i.message)
                                .join('; ')
                            : undefined
                        }
                      >
                        {record[f] ?? ''}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {records.length === 0 ? (
              <tr>
                <td colSpan={fields.length + 2} className="vex__empty">
                  No records parsed.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- report ----------

function Report({ result }: { result: ValidationResult }) {
  const max = Math.max(1, ...result.breakdown.map((b) => b.count));
  return (
    <div className="vex__report glass" role="region" aria-label="Validation report">
      <div className="vex__summary">
        <div className="vex__stat vex__stat--ok">
          <span className="vex__stat-val">{result.validCount}</span>
          <span className="vex__stat-unit">valid</span>
        </div>
        <div className="vex__stat vex__stat--bad">
          <span className="vex__stat-val">{result.invalidCount}</span>
          <span className="vex__stat-unit">invalid</span>
        </div>
        <div className="vex__stat">
          <span className="vex__stat-val">{result.total}</span>
          <span className="vex__stat-unit">rows</span>
        </div>
      </div>

      <h4 className="vex__block-title vex__report-sub">Issues by rule</h4>
      {result.breakdown.length === 0 ? (
        <p className="vex__clean">Every record passed every rule.</p>
      ) : (
        <ul className="vex__bars">
          {result.breakdown.map((b) => (
            <li className="vex__bar-row" key={b.rule}>
              <span className="vex__bar-label">{RULE_LABELS[b.rule]}</span>
              <span className="vex__bar-track" aria-hidden="true">
                <span
                  className="vex__bar-fill"
                  style={{ width: `${(b.count / max) * 100}%` }}
                />
              </span>
              <span className="vex__bar-count">{b.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
