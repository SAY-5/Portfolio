// Typed model for the no-code rules engine. The input schema declares a few
// fields with concrete types; conditions reference those fields by name and
// compare them with an operator that the field's type allows; actions describe
// what a rule does when its condition holds. Everything here is plain data, so
// a rule set can be serialised to localStorage and walked by the interpreter
// without ever running a user string as code.

export type FieldType = 'number' | 'string' | 'boolean';

export type FieldDef = {
  name: string;
  type: FieldType;
  label: string;
  // For string fields, an optional closed list the value must come from. This
  // lets the builder offer a select instead of a free text box.
  options?: string[];
};

// The input schema the whole engine evaluates against.
export const schema: FieldDef[] = [
  { name: 'amount', type: 'number', label: 'Order amount' },
  {
    name: 'country',
    type: 'string',
    label: 'Country',
    options: ['US', 'CA', 'GB', 'DE', 'IN'],
  },
  { name: 'tier', type: 'string', label: 'Plan tier', options: ['free', 'pro', 'enterprise'] },
  { name: 'verified', type: 'boolean', label: 'Verified' },
];

export type FieldValue = number | string | boolean;

// A concrete input the engine runs over. Keys are field names from the schema.
export type Input = Record<string, FieldValue>;

// Operators, grouped by the field type they apply to. The interpreter rejects
// any condition that pairs an operator with a field of the wrong type.
export const NUMBER_OPS = ['==', '!=', '>', '>=', '<', '<='] as const;
export const STRING_OPS = ['==', '!=', 'contains', 'startsWith'] as const;
export const BOOLEAN_OPS = ['==', '!='] as const;

export type NumberOp = (typeof NUMBER_OPS)[number];
export type StringOp = (typeof STRING_OPS)[number];
export type BooleanOp = (typeof BOOLEAN_OPS)[number];
export type Operator = NumberOp | StringOp | BooleanOp;

// A single comparison: field <op> value.
export type Condition = {
  kind: 'cmp';
  field: string;
  op: Operator;
  value: FieldValue;
};

// An AND/OR group of nested conditions. Depth is bounded by the builder so a
// rule set stays a finite tree, but the interpreter also guards against it.
export type Group = {
  kind: 'group';
  op: 'AND' | 'OR';
  children: ConditionNode[];
};

export type ConditionNode = Condition | Group;

// What a rule does when it fires. Actions never mutate the engine; the
// interpreter collects them into a decision the caller can inspect.
//   set:   write a derived output field, e.g. discount = 0.1
//   flag:  raise a named flag, e.g. flag "manual-review"
//   route: send the input down a named branch, e.g. route to "priority"
export type Action =
  | { kind: 'set'; key: string; value: FieldValue }
  | { kind: 'flag'; name: string }
  | { kind: 'route'; to: string };

export type Rule = {
  id: string;
  name: string;
  when: ConditionNode;
  then: Action;
  enabled: boolean;
};

// A retained, immutable snapshot of the rule set.
export type Version = {
  id: number;
  createdAt: number;
  rules: Rule[];
  note: string;
};

// Outcome of running an input against a set of rules.
export type Decision = {
  fired: string[]; // rule ids that fired, in order
  outputs: Record<string, FieldValue>;
  flags: string[];
  routes: string[];
};

export function fieldByName(name: string): FieldDef | undefined {
  return schema.find((f) => f.name === name);
}

export function opsForType(type: FieldType): readonly Operator[] {
  if (type === 'number') return NUMBER_OPS;
  if (type === 'string') return STRING_OPS;
  return BOOLEAN_OPS;
}
