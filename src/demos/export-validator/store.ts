// Framework-agnostic store for the export validator. It holds the ruleset, the
// pasted record set, and the last validation result, persisting the ruleset and
// records to localStorage so a reload keeps the user's work. Editing a rule or
// the records clears any stale result, and Run validation recomputes it through
// the pure engine. Nothing here talks to a server.

import { validateRecords } from './engine';
import { parseRecords } from './parse';
import type {
  DataRecord,
  FieldRule,
  FieldType,
  Ruleset,
  ValidationResult,
} from './types';

const RULES_KEY = 'export-validator.ruleset.v1';
const RECORDS_KEY = 'export-validator.records.v1';

export type State = {
  ruleset: Ruleset;
  records: DataRecord[];
  result: ValidationResult | null;
};

// ---------- seed ----------

// A small shipment export keyed by the rules below. Some rows are deliberately
// broken so the first validation run has something to flag: a blank required
// id, a non-numeric qty, an out-of-range qty, a bad status enum, a malformed
// email, and a duplicate sku.
const SEED_RULESET: Ruleset = {
  fields: [
    { id: 'r-id', field: 'id', type: 'string', required: true, unique: true },
    { id: 'r-sku', field: 'sku', type: 'string', required: true, pattern: '^SKU-[0-9]{4}$', unique: true },
    { id: 'r-qty', field: 'qty', type: 'number', required: true, min: 1, max: 500, unique: false },
    { id: 'r-status', field: 'status', type: 'string', required: true, enum: ['packed', 'shipped', 'delivered'], unique: false },
    { id: 'r-email', field: 'email', type: 'string', required: false, pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', unique: false },
    { id: 'r-date', field: 'shipped_at', type: 'date', required: false, unique: false },
  ],
};

const SEED_CSV = [
  'id,sku,qty,status,email,shipped_at',
  '1001,SKU-0001,12,shipped,amy@example.com,2026-01-04',
  '1002,SKU-0002,3,packed,joe@example.com,2026-01-05',
  '1003,SKU-9999,xx,shipped,bad-email,2026-01-06',
  '1004,SKU-0004,900,delivered,kim@example.com,2026-01-07',
  '1005,BAD-SKU,7,returned,lee@example.com,2026-01-08',
  ',SKU-0006,5,packed,rae@example.com,not-a-date',
  '1007,SKU-0001,8,shipped,sam@example.com,2026-01-09',
].join('\n');

// ---------- persistence ----------

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage may be unavailable (private mode); the app still works in-memory.
  }
}

function loadState(): State {
  const ruleset = readJSON<Ruleset>(RULES_KEY, SEED_RULESET);
  const seededRecords = parseRecords(SEED_CSV).records;
  const records = readJSON<DataRecord[]>(RECORDS_KEY, seededRecords);
  return { ruleset, records, result: null };
}

// ---------- minimal external store ----------

let state: State = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

// ---------- ruleset actions ----------

function persistRuleset(ruleset: Ruleset): void {
  writeJSON(RULES_KEY, ruleset);
  // Editing the ruleset invalidates the last run.
  set({ ruleset, result: null });
}

function makeRuleId(): string {
  return `r-${Math.random().toString(36).slice(2, 8)}`;
}

export function addRule(): void {
  const rule: FieldRule = {
    id: makeRuleId(),
    field: `field_${state.ruleset.fields.length + 1}`,
    type: 'string',
    required: false,
    unique: false,
  };
  persistRuleset({ fields: [...state.ruleset.fields, rule] });
}

export function updateRule(id: string, patch: Partial<FieldRule>): void {
  const fields = state.ruleset.fields.map((f) =>
    f.id === id ? normalizeRule({ ...f, ...patch }) : f,
  );
  persistRuleset({ fields });
}

export function removeRule(id: string): void {
  persistRuleset({ fields: state.ruleset.fields.filter((f) => f.id !== id) });
}

// Keep a rule internally consistent: only number fields carry bounds, and a
// type change drops constraints that no longer apply.
function normalizeRule(rule: FieldRule): FieldRule {
  const next: FieldRule = { ...rule };
  if (next.type !== 'number') {
    delete next.min;
    delete next.max;
  }
  if (next.pattern !== undefined && next.pattern.trim() === '') {
    delete next.pattern;
  }
  if (next.enum && next.enum.length === 0) {
    delete next.enum;
  }
  return next;
}

// Set the enum from a comma-separated string typed in the UI.
export function setRuleEnum(id: string, raw: string): void {
  const values = raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
  updateRule(id, { enum: values.length > 0 ? values : undefined });
}

// ---------- record actions ----------

export function setRecordsFromText(text: string): void {
  const parsed = parseRecords(text);
  writeJSON(RECORDS_KEY, parsed.records);
  set({ records: parsed.records, result: null });
}

// ---------- validation ----------

export function runValidation(): void {
  const result = validateRecords(state.records, state.ruleset, Date.now());
  set({ result });
}

// ---------- reset ----------

export function resetAll(): void {
  try {
    localStorage.removeItem(RULES_KEY);
    localStorage.removeItem(RECORDS_KEY);
  } catch {
    // ignore storage errors
  }
  state = {
    ruleset: SEED_RULESET,
    records: parseRecords(SEED_CSV).records,
    result: null,
  };
  emit();
}

// ---------- derived ----------

// The union of fields declared in the ruleset and seen in the records, in a
// stable order: ruleset fields first, then any extra record columns.
export function allFields(s: State = state): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const rule of s.ruleset.fields) {
    if (!seen.has(rule.field)) {
      seen.add(rule.field);
      order.push(rule.field);
    }
  }
  for (const record of s.records) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
    }
  }
  return order;
}

// Serialise the invalid rows back to CSV for the export-invalid control.
export function invalidRowsCsv(s: State = state): string {
  if (!s.result) return '';
  const fields = allFields(s);
  const header = fields.join(',');
  const lines = s.result.invalidIndices.map((idx) => {
    const record = s.records[idx];
    return fields.map((f) => csvCell(record?.[f] ?? '')).join(',');
  });
  return [header, ...lines].join('\n');
}

// Quote a cell when it carries a comma, quote, or newline.
function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export type { FieldRule, FieldType, Ruleset, DataRecord, ValidationResult };
