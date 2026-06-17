// Shared shapes for the export validator. A ruleset is an ordered list of
// per-field rules; records are plain string-keyed rows pulled from a pasted CSV
// or JSON dump. Everything here is data only, with no DOM or storage concerns,
// so the engine and the store can both lean on the same contracts.

export type FieldType = 'string' | 'number' | 'bool' | 'date';

// A single field's constraints. Every optional constraint is checked only when
// present, so a rule can be as loose as "this column must exist" or as strict
// as "an ISO date inside an allowed set, unique across the export".
export type FieldRule = {
  id: string;
  field: string;
  type: FieldType;
  required: boolean;
  // Regex source compiled safely at validation time; never eval'd.
  pattern?: string;
  // Numeric bounds, inclusive, applied only to number fields.
  min?: number;
  max?: number;
  // Allowed values; a non-empty list turns the field into an enum.
  enum?: string[];
  // When true the field's values must not repeat across the record set.
  unique: boolean;
};

export type Ruleset = {
  fields: FieldRule[];
};

// A record is a flat map of column to raw cell text. Keeping cells as strings
// keeps parsing trivial and lets each rule decide how to coerce the value.
export type DataRecord = Record<string, string>;

// One reason a field failed, tagged by which rule produced it so the report can
// group failures by rule kind.
export type RuleKind =
  | 'required'
  | 'type'
  | 'pattern'
  | 'min'
  | 'max'
  | 'enum'
  | 'unique';

export type FieldIssue = {
  field: string;
  rule: RuleKind;
  message: string;
};

// The outcome for a single record: pass/fail plus the fields that failed and
// the issues behind them.
export type RecordResult = {
  index: number;
  ok: boolean;
  issues: FieldIssue[];
  failingFields: string[];
};

// One row in the by-rule breakdown: how many issues a given rule kind produced
// across the whole export.
export type RuleBreakdown = {
  rule: RuleKind;
  count: number;
};

// The aggregate over a record set.
export type ValidationResult = {
  total: number;
  validCount: number;
  invalidCount: number;
  records: RecordResult[];
  breakdown: RuleBreakdown[];
  // Indices of records that failed, for the export-invalid-rows control.
  invalidIndices: number[];
  // The clock at the moment validation ran, snapshotted by the caller so the
  // report can show when it was produced without reading Date.now() in render.
  ranAt: number;
};
