// Pure, deterministic schema-compatibility engine. Given a current schema and a
// proposed next schema, it classifies every field-level difference and folds
// them into a single verdict. There is no eval and no I/O: the result is a
// function of the two field lists only.
//
// Compatibility model (mirrors a record schema-registry):
//  - Backward: a reader using the NEW schema can read data written with the OLD
//    schema. Removing a field is fine for such a reader; adding a REQUIRED field
//    is not, because old data lacks it.
//  - Forward: a reader using the OLD schema can read data written with the NEW
//    schema. Adding a field is fine; removing a REQUIRED field is not, because
//    the old reader still expects it.
//  - A type change is safe in a direction only when the reader's declared type
//    can hold the writer's value, i.e. a widening promotion (int -> long ->
//    double). Any other retype breaks both directions.

import type {
  CompatibilityReport,
  Field,
  FieldType,
  SchemaChange,
  Verdict,
} from './types';

// Numeric promotion lattice: a value of the key type can be read as any type in
// its list without loss. Used to decide whether a retype is a safe widening.
const WIDENS_TO: Record<FieldType, FieldType[]> = {
  int: ['int', 'long', 'double'],
  long: ['long', 'double'],
  double: ['double'],
  string: ['string'],
  boolean: ['boolean'],
  bytes: ['bytes'],
};

// True when a value written as `from` can be read as `to`.
function widens(from: FieldType, to: FieldType): boolean {
  return WIDENS_TO[from].includes(to);
}

function byName(fields: Field[]): Map<string, Field> {
  const m = new Map<string, Field>();
  for (const f of fields) m.set(f.name, f);
  return m;
}

// Classify the difference for one field name across the two schemas. Returns a
// change, or null when the field is unchanged.
function classifyField(
  name: string,
  oldF: Field | undefined,
  newF: Field | undefined,
): SchemaChange | null {
  // Added in the new schema.
  if (!oldF && newF) {
    if (newF.required) {
      return {
        kind: 'add-required',
        field: name,
        // New reader on old data: old records lack this required field.
        backward: false,
        // Old reader on new data: extra field is ignored.
        forward: true,
        reason: `added required field "${name}": old data has no value for it, so a new-schema reader cannot read old records`,
      };
    }
    return {
      kind: 'add-optional',
      field: name,
      backward: true,
      forward: true,
      reason: `added optional field "${name}": old records fall back to its default and old readers ignore it`,
    };
  }

  // Removed in the new schema.
  if (oldF && !newF) {
    if (oldF.required) {
      return {
        kind: 'remove-required',
        field: name,
        // New reader on old data: extra field is ignored.
        backward: true,
        // Old reader on new data: old reader still requires this field.
        forward: false,
        reason: `removed required field "${name}": old-schema readers still require it, so they cannot read new records`,
      };
    }
    return {
      kind: 'remove-optional',
      field: name,
      backward: true,
      forward: true,
      reason: `removed optional field "${name}": old readers already tolerate its absence via a default`,
    };
  }

  if (!oldF || !newF) return null;

  // Type change takes precedence over a required-flag change for the reason text.
  if (oldF.type !== newF.type) {
    // Backward: new reader reads old data, so old type must widen to new type.
    const backward = widens(oldF.type, newF.type);
    // Forward: old reader reads new data, so new type must widen to old type.
    const forward = widens(newF.type, oldF.type);
    return {
      kind: 'retype',
      field: name,
      backward,
      forward,
      reason: backward
        ? `widened field "${name}" from ${oldF.type} to ${newF.type}: old values still fit`
        : `changed field "${name}" type from ${oldF.type} to ${newF.type}: values do not convert safely`,
    };
  }

  // Required flag flipped.
  if (oldF.required !== newF.required) {
    if (!oldF.required && newF.required) {
      return {
        kind: 'make-required',
        field: name,
        // New reader on old data: old records may omit the now-required field.
        backward: false,
        forward: true,
        reason: `made field "${name}" required: old records may omit it, so a new-schema reader cannot read old data`,
      };
    }
    return {
      kind: 'make-optional',
      field: name,
      backward: true,
      forward: true,
      reason: `made field "${name}" optional: readers in both directions still find a value or a default`,
    };
  }

  return null;
}

// Compare two schemas field by field and fold the per-field results into a
// single verdict. Order of fields does not affect compatibility, so comparison
// is keyed by field name.
export function checkCompatibility(
  current: Field[],
  proposed: Field[],
): CompatibilityReport {
  const oldMap = byName(current);
  const newMap = byName(proposed);
  const names = new Set<string>([...oldMap.keys(), ...newMap.keys()]);

  const changes: SchemaChange[] = [];
  for (const name of names) {
    const change = classifyField(name, oldMap.get(name), newMap.get(name));
    if (change) changes.push(change);
  }
  // Stable, deterministic ordering for display.
  changes.sort((a, b) => a.field.localeCompare(b.field));

  const allBackward = changes.every((c) => c.backward);
  const allForward = changes.every((c) => c.forward);

  let verdict: Verdict;
  if (allBackward && allForward) verdict = 'full';
  else if (allBackward) verdict = 'backward';
  else if (allForward) verdict = 'forward';
  else verdict = 'breaking';

  return {
    verdict,
    changes,
    identical: changes.length === 0,
  };
}

// A change is registerable without an override when it preserves at least one
// direction. A fully breaking change requires an explicit allow-with-warning.
export function isCompatible(verdict: Verdict): boolean {
  return verdict !== 'breaking';
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  full: 'fully compatible',
  backward: 'backward compatible',
  forward: 'forward compatible',
  breaking: 'breaking',
};
