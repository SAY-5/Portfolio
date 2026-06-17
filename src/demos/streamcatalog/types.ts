// Core types for the streamcatalog browser model. A topic carries a versioned
// schema; each schema is an ordered list of fields. Producers write to a topic,
// consumers read from it. Schema evolution is classified by a pure engine into
// backward, forward, full, or breaking changes, with a reason per change.

// The scalar types a field may hold. The set is deliberately small so the
// compatibility engine can reason about widening and narrowing precisely.
export type FieldType = 'string' | 'int' | 'long' | 'double' | 'boolean' | 'bytes';

export const FIELD_TYPES: readonly FieldType[] = [
  'string',
  'int',
  'long',
  'double',
  'boolean',
  'bytes',
];

// A single field in a schema. `required` mirrors the absence of a default in a
// record schema: a required field must be present in every record.
export type Field = {
  name: string;
  type: FieldType;
  required: boolean;
};

// One immutable version of a topic's schema. `version` increases by one on each
// registered change. `note` records why the change was accepted.
export type SchemaVersion = {
  version: number;
  fields: Field[];
  registeredAt: number;
  note: string;
};

// A producer writes records to a topic; a consumer reads them. Both are named
// services so the UI can show who is affected by a breaking change.
export type Endpoint = {
  id: string;
  name: string;
};

export type Topic = {
  id: string;
  name: string;
  description: string;
  versions: SchemaVersion[];
  producers: Endpoint[];
  consumers: Endpoint[];
};

// How a proposed schema relates to the current one.
//  - backward: new consumers can read data written with the old schema.
//  - forward: old consumers can read data written with the new schema.
//  - full: both backward and forward hold.
//  - breaking: at least one change breaks one of the directions.
export type Verdict = 'full' | 'backward' | 'forward' | 'breaking';

// One classified difference between the current and proposed schema.
export type ChangeKind =
  | 'add-optional'
  | 'add-required'
  | 'remove-optional'
  | 'remove-required'
  | 'retype'
  | 'make-required'
  | 'make-optional';

export type SchemaChange = {
  kind: ChangeKind;
  field: string;
  // Whether the change is safe for readers of old data (backward) and for
  // readers of new data (forward). A change that breaks both is breaking.
  backward: boolean;
  forward: boolean;
  reason: string;
};

export type CompatibilityReport = {
  verdict: Verdict;
  changes: SchemaChange[];
  // True when there is no difference between the two schemas at all.
  identical: boolean;
};
