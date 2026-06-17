// Shared types for the QueryFlow visual query builder. A query is a plain data
// structure: selected columns, WHERE conditions, GROUP BY plus aggregates,
// ORDER BY, and a row limit. The engine interprets this structure over an
// in-memory dataset with ordinary JavaScript. Nothing is ever compiled or
// evaluated as code, so there is no eval and no SQL string is executed.

export type ColumnType = 'string' | 'number' | 'date' | 'boolean';

export type Column = {
  name: string;
  type: ColumnType;
  label: string;
};

// A single row of the dataset. Values are kept as primitives the engine can
// compare directly; dates are stored as ISO strings and parsed on demand.
export type Row = Record<string, string | number | boolean>;

export type Table = {
  name: string;
  columns: Column[];
  rows: Row[];
};

// Operators are grouped by the column type they apply to. The builder only
// offers operators valid for the chosen field's type, and the engine rejects a
// condition whose operator does not match the field type.
export type StringOp = 'eq' | 'neq' | 'contains' | 'startsWith' | 'in';
export type NumberOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
export type DateOp = 'eq' | 'before' | 'after' | 'onOrBefore' | 'onOrAfter';
export type BooleanOp = 'isTrue' | 'isFalse';
export type Operator = StringOp | NumberOp | DateOp | BooleanOp;

export type Combine = 'AND' | 'OR';

// One WHERE clause: a field, an operator, and the comparison value as the raw
// text the user typed. The engine coerces the text against the field type when
// it runs, and surfaces a typed error if the coercion fails.
export type Condition = {
  id: string;
  field: string;
  op: Operator;
  value: string;
};

export type Aggregate = 'count' | 'sum' | 'avg' | 'min' | 'max';

// An aggregate column in a grouped query: the function plus the field it runs
// over. count may target any field (or a synthetic "*"); the numeric
// aggregates require a numeric field.
export type AggregateSpec = {
  id: string;
  fn: Aggregate;
  field: string;
};

export type SortDir = 'asc' | 'desc';

export type OrderBy = {
  field: string;
  dir: SortDir;
};

// The full structured query the builder edits and the engine runs.
export type Query = {
  table: string;
  columns: string[];
  combine: Combine;
  conditions: Condition[];
  groupBy: string[];
  aggregates: AggregateSpec[];
  orderBy: OrderBy | null;
  limit: number | null;
};

// A saved, named query kept in localStorage.
export type SavedQuery = {
  id: string;
  name: string;
  query: Query;
  savedAt: number;
};

// The result of running a query: the output column order plus the result rows.
// Errors are validation failures the engine refuses to run, never thrown.
export type QueryResult = {
  columns: string[];
  rows: Row[];
  rowCount: number;
  error: string | null;
};
