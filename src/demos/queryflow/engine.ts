// The QueryFlow execution engine. It interprets a structured Query over an
// in-memory Table using ordinary JavaScript: filter, group, aggregate, sort,
// limit. There is no eval, no Function constructor, and no SQL string is ever
// executed. The SQL-like text the UI shows is produced for display only by
// toSql below and is never parsed or run.

import type {
  Aggregate,
  AggregateSpec,
  Column,
  Condition,
  Operator,
  Query,
  QueryResult,
  Row,
  Table,
} from './types';
import { columnByName } from './data';

// Operators valid for each column type. The builder uses this to offer only
// sensible operators, and validateQuery uses it to reject a mismatch.
export const OPS_BY_TYPE: Record<Column['type'], Operator[]> = {
  string: ['eq', 'neq', 'contains', 'startsWith', 'in'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  date: ['eq', 'before', 'after', 'onOrBefore', 'onOrAfter'],
  boolean: ['isTrue', 'isFalse'],
};

export const OP_LABELS: Record<Operator, string> = {
  eq: '=',
  neq: '!=',
  contains: 'contains',
  startsWith: 'starts with',
  in: 'in',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  before: 'before',
  after: 'after',
  onOrBefore: 'on or before',
  onOrAfter: 'on or after',
  isTrue: 'is true',
  isFalse: 'is false',
};

// Operators that need no typed value (boolean predicates).
const VALUELESS: Operator[] = ['isTrue', 'isFalse'];

export function opNeedsValue(op: Operator): boolean {
  return !VALUELESS.includes(op);
}

function parseDate(s: string): number {
  return new Date(s + (s.length === 10 ? 'T00:00:00Z' : '')).getTime();
}

// Coerce a raw text value against the column type. Returns null when the text
// cannot be read as that type, which the engine reports as a typed error.
function coerce(
  col: Column,
  raw: string,
): { ok: true; value: number | string | string[] } | { ok: false } {
  if (col.type === 'number') {
    const n = Number(raw.trim());
    if (raw.trim() === '' || Number.isNaN(n)) return { ok: false };
    return { ok: true, value: n };
  }
  if (col.type === 'date') {
    const t = parseDate(raw.trim());
    if (Number.isNaN(t)) return { ok: false };
    return { ok: true, value: raw.trim() };
  }
  // string: an `in` list is comma separated.
  return { ok: true, value: raw };
}

// Validate the whole query without running it. Returns an error string for the
// first problem found, or null when the query is safe to execute.
export function validateQuery(table: Table, q: Query): string | null {
  if (q.table !== table.name) return `unknown table "${q.table}"`;

  for (const c of q.conditions) {
    const col = columnByName(table, c.field);
    if (!col) return `unknown field "${c.field}" in filter`;
    if (!OPS_BY_TYPE[col.type].includes(c.op)) {
      return `operator "${OP_LABELS[c.op]}" does not apply to ${col.type} field "${c.field}"`;
    }
    if (opNeedsValue(c.op) && coerce(col, c.value).ok === false) {
      return `value "${c.value}" is not a valid ${col.type} for "${c.field}"`;
    }
  }

  const grouped = q.groupBy.length > 0 || q.aggregates.length > 0;
  if (grouped) {
    for (const g of q.groupBy) {
      if (!columnByName(table, g)) return `unknown GROUP BY field "${g}"`;
    }
    for (const a of q.aggregates) {
      if (a.fn !== 'count') {
        const col = columnByName(table, a.field);
        if (!col) return `unknown aggregate field "${a.field}"`;
        if (col.type !== 'number') {
          return `${a.fn.toUpperCase()} requires a numeric field, but "${a.field}" is ${col.type}`;
        }
      }
    }
    // In a grouped query the only selectable columns are the group keys; the
    // output is group keys plus aggregates.
  } else if (q.columns.length > 0) {
    for (const name of q.columns) {
      if (!columnByName(table, name)) return `unknown column "${name}"`;
    }
  }

  if (q.orderBy) {
    const orderCols = grouped
      ? [...q.groupBy, ...q.aggregates.map(aggKey)]
      : table.columns.map((c) => c.name);
    if (!orderCols.includes(q.orderBy.field)) {
      return `cannot ORDER BY "${q.orderBy.field}"; it is not in the result`;
    }
  }

  if (q.limit !== null && (!Number.isInteger(q.limit) || q.limit < 0)) {
    return `LIMIT must be a non-negative whole number`;
  }
  return null;
}

function testCondition(col: Column, c: Condition, row: Row): boolean {
  const cell = row[c.field];
  if (c.op === 'isTrue') return cell === true;
  if (c.op === 'isFalse') return cell === false;

  const co = coerce(col, c.value);
  if (!co.ok) return false;

  if (col.type === 'number') {
    const a = cell as number;
    const b = co.value as number;
    switch (c.op) {
      case 'eq': return a === b;
      case 'neq': return a !== b;
      case 'gt': return a > b;
      case 'gte': return a >= b;
      case 'lt': return a < b;
      case 'lte': return a <= b;
    }
  }
  if (col.type === 'date') {
    const a = parseDate(cell as string);
    const b = parseDate(co.value as string);
    switch (c.op) {
      case 'eq': return a === b;
      case 'before': return a < b;
      case 'after': return a > b;
      case 'onOrBefore': return a <= b;
      case 'onOrAfter': return a >= b;
    }
  }
  // string
  const a = String(cell);
  const raw = co.value as string;
  switch (c.op) {
    case 'eq': return a === raw;
    case 'neq': return a !== raw;
    case 'contains': return a.toLowerCase().includes(raw.toLowerCase());
    case 'startsWith': return a.toLowerCase().startsWith(raw.toLowerCase());
    case 'in':
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .includes(a);
  }
  return false;
}

function applyWhere(table: Table, q: Query): Row[] {
  if (q.conditions.length === 0) return table.rows;
  return table.rows.filter((row) => {
    const results = q.conditions.map((c) => {
      const col = columnByName(table, c.field);
      return col ? testCondition(col, c, row) : false;
    });
    return q.combine === 'AND' ? results.every(Boolean) : results.some(Boolean);
  });
}

export function aggKey(a: AggregateSpec): string {
  return a.fn === 'count' && a.field === '*' ? 'count' : `${a.fn}_${a.field}`;
}

function runAggregate(fn: Aggregate, field: string, rows: Row[]): number {
  if (fn === 'count') return rows.length;
  const nums = rows.map((r) => r[field] as number).filter((n) => typeof n === 'number');
  if (nums.length === 0) return 0;
  switch (fn) {
    case 'sum': return round2(nums.reduce((a, b) => a + b, 0));
    case 'avg': return round2(nums.reduce((a, b) => a + b, 0) / nums.length);
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function applyGroup(q: Query, rows: Row[]): { columns: string[]; rows: Row[] } {
  const keys = q.groupBy;
  const buckets = new Map<string, Row[]>();
  const order: string[] = [];
  for (const row of rows) {
    const k = keys.map((g) => String(row[g])).join('');
    let bucket = buckets.get(k);
    if (!bucket) {
      bucket = [];
      buckets.set(k, bucket);
      order.push(k);
    }
    bucket.push(row);
  }
  // No group keys but aggregates present: a single grand-total row.
  if (keys.length === 0) {
    const out: Row = {};
    for (const a of q.aggregates) out[aggKey(a)] = runAggregate(a.fn, a.field, rows);
    return { columns: q.aggregates.map(aggKey), rows: rows.length ? [out] : [] };
  }
  const outRows: Row[] = order.map((k) => {
    const bucket = buckets.get(k)!;
    const out: Row = {};
    keys.forEach((g) => { out[g] = bucket[0][g]; });
    for (const a of q.aggregates) out[aggKey(a)] = runAggregate(a.fn, a.field, bucket);
    return out;
  });
  return { columns: [...keys, ...q.aggregates.map(aggKey)], rows: outRows };
}

function applyOrderLimit(q: Query, columns: string[], rows: Row[]): Row[] {
  let out = rows;
  if (q.orderBy) {
    const { field, dir } = q.orderBy;
    const factor = dir === 'asc' ? 1 : -1;
    out = [...rows].sort((ra, rb) => {
      const a = ra[field];
      const b = rb[field];
      if (a === b) return 0;
      if (typeof a === 'number' && typeof b === 'number') return (a - b) * factor;
      return String(a).localeCompare(String(b)) * factor;
    });
  }
  if (q.limit !== null) out = out.slice(0, q.limit);
  void columns;
  return out;
}

// Run the query. On any validation failure it returns an error result rather
// than throwing, so the UI can render the message inline.
export function runQuery(table: Table, q: Query): QueryResult {
  const error = validateQuery(table, q);
  if (error) return { columns: [], rows: [], rowCount: 0, error };

  const filtered = applyWhere(table, q);
  const grouped = q.groupBy.length > 0 || q.aggregates.length > 0;

  let columns: string[];
  let rows: Row[];
  if (grouped) {
    const g = applyGroup(q, filtered);
    columns = g.columns;
    rows = g.rows;
  } else {
    columns = q.columns.length > 0 ? q.columns : table.columns.map((c) => c.name);
    rows = filtered.map((r) => {
      const out: Row = {};
      for (const c of columns) out[c] = r[c];
      return out;
    });
  }

  rows = applyOrderLimit(q, columns, rows);
  return { columns, rows, rowCount: rows.length, error: null };
}

// ---------- SQL-like text preview (display only, never executed) ----------

function quote(col: Column | undefined, raw: string): string {
  if (col && col.type === 'number') return raw.trim() === '' ? 'NULL' : raw.trim();
  if (col && col.type === 'date') return `'${raw.trim()}'`;
  return `'${raw.replace(/'/g, "''")}'`;
}

function condSql(table: Table, c: Condition): string {
  const col = columnByName(table, c.field);
  if (c.op === 'isTrue') return `${c.field} = TRUE`;
  if (c.op === 'isFalse') return `${c.field} = FALSE`;
  if (c.op === 'contains') return `${c.field} LIKE '%${c.value.replace(/'/g, "''")}%'`;
  if (c.op === 'startsWith') return `${c.field} LIKE '${c.value.replace(/'/g, "''")}%'`;
  if (c.op === 'in') {
    const list = c.value
      .split(',')
      .map((s) => `'${s.trim().replace(/'/g, "''")}'`)
      .join(', ');
    return `${c.field} IN (${list})`;
  }
  return `${c.field} ${OP_LABELS[c.op]} ${quote(col, c.value)}`;
}

function aggSql(a: AggregateSpec): string {
  const arg = a.fn === 'count' && a.field === '*' ? '*' : a.field;
  return `${a.fn.toUpperCase()}(${arg}) AS ${aggKey(a)}`;
}

// Build a read-only SQL-like string for display. This text is informational
// and is never sent to a parser or executor.
export function toSql(table: Table, q: Query): string {
  const grouped = q.groupBy.length > 0 || q.aggregates.length > 0;
  const selectParts: string[] = grouped
    ? [...q.groupBy, ...q.aggregates.map(aggSql)]
    : q.columns.length > 0
      ? q.columns
      : ['*'];

  const lines: string[] = [];
  lines.push(`SELECT ${selectParts.join(', ')}`);
  lines.push(`FROM ${q.table}`);
  if (q.conditions.length > 0) {
    const joined = q.conditions.map((c) => condSql(table, c)).join(`\n  ${q.combine} `);
    lines.push(`WHERE ${joined}`);
  }
  if (q.groupBy.length > 0) lines.push(`GROUP BY ${q.groupBy.join(', ')}`);
  if (q.orderBy) lines.push(`ORDER BY ${q.orderBy.field} ${q.orderBy.dir.toUpperCase()}`);
  if (q.limit !== null) lines.push(`LIMIT ${q.limit}`);
  return lines.join('\n') + ';';
}
