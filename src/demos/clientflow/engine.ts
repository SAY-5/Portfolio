// The rules engine: validation and a safe interpreter. No part of this file
// calls eval, Function, or any other dynamic-code path. A condition is walked
// as plain data and compared with fixed operator functions, so a malformed or
// hostile rule can only ever produce a validation error or a false result, not
// arbitrary execution.

import {
  fieldByName,
  opsForType,
  type Action,
  type Condition,
  type ConditionNode,
  type Decision,
  type FieldValue,
  type Group,
  type Input,
  type Operator,
  type Rule,
} from './types';

export const MAX_DEPTH = 6;

// ---------- validation ----------

export type ValidationError = { path: string; message: string };

function typeOfValue(v: FieldValue): 'number' | 'string' | 'boolean' {
  return typeof v as 'number' | 'string' | 'boolean';
}

function validateCondition(
  c: Condition,
  path: string,
  errors: ValidationError[],
): void {
  const def = fieldByName(c.field);
  if (!def) {
    errors.push({ path, message: `unknown field "${c.field}"` });
    return;
  }
  const allowed = opsForType(def.type);
  if (!allowed.includes(c.op)) {
    errors.push({
      path,
      message: `operator "${c.op}" is not valid for ${def.type} field "${c.field}"`,
    });
  }
  // contains and startsWith compare strings; every other operator needs the
  // value to match the field's declared type.
  const valueType = typeOfValue(c.value);
  if (def.type !== valueType) {
    errors.push({
      path,
      message: `field "${c.field}" is ${def.type} but value is ${valueType}`,
    });
  }
  if (def.options && def.type === 'string' && typeof c.value === 'string') {
    if (c.op === '==' || c.op === '!=') {
      if (!def.options.includes(c.value)) {
        errors.push({
          path,
          message: `value "${c.value}" is not one of ${def.options.join(', ')}`,
        });
      }
    }
  }
}

function validateNode(
  node: ConditionNode,
  path: string,
  depth: number,
  errors: ValidationError[],
): void {
  if (depth > MAX_DEPTH) {
    errors.push({ path, message: `nesting deeper than ${MAX_DEPTH} levels` });
    return;
  }
  if (node.kind === 'cmp') {
    validateCondition(node, path, errors);
    return;
  }
  if (node.children.length === 0) {
    errors.push({ path, message: `empty ${node.op} group` });
  }
  node.children.forEach((child, i) =>
    validateNode(child, `${path}/${node.op}[${i}]`, depth + 1, errors),
  );
}

function validateAction(a: Action, path: string, errors: ValidationError[]): void {
  if (a.kind === 'set' && a.key.trim() === '') {
    errors.push({ path, message: 'set action needs an output key' });
  }
  if (a.kind === 'flag' && a.name.trim() === '') {
    errors.push({ path, message: 'flag action needs a name' });
  }
  if (a.kind === 'route' && a.to.trim() === '') {
    errors.push({ path, message: 'route action needs a target' });
  }
}

export function validateRule(rule: Rule): ValidationError[] {
  const errors: ValidationError[] = [];
  if (rule.name.trim() === '') {
    errors.push({ path: rule.id, message: 'rule needs a name' });
  }
  validateNode(rule.when, rule.id, 1, errors);
  validateAction(rule.then, rule.id, errors);
  return errors;
}

// A rule set is valid when every rule validates and the set has no cycle. A
// cycle can only arise when one rule's set action feeds a field another rule
// reads and that chain loops back, so we detect it on the read/write graph.
export function validateRuleSet(rules: Rule[]): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const rule of rules) errors.push(...validateRule(rule));
  const cycle = findCycle(rules);
  if (cycle.length > 0) {
    errors.push({
      path: cycle.join(' -> '),
      message: 'rules form a write/read cycle',
    });
  }
  return errors;
}

// ---------- cycle detection over chained rules ----------

// Fields a condition reads.
function readsOf(node: ConditionNode, acc: Set<string>): void {
  if (node.kind === 'cmp') {
    acc.add(node.field);
    return;
  }
  for (const child of node.children) readsOf(child, acc);
}

// Build edges rule -> rule: an edge A -> B means A writes a field that B reads,
// so B may depend on A having run. A cycle in that graph means the rules chain
// back on themselves and cannot be ordered.
export function findCycle(rules: Rule[]): string[] {
  const writes = new Map<string, string>(); // ruleId -> output key
  for (const r of rules) {
    if (r.enabled && r.then.kind === 'set') writes.set(r.id, r.then.key);
  }
  const edges = new Map<string, string[]>();
  for (const a of rules) {
    if (!a.enabled || a.then.kind !== 'set') continue;
    const writtenKey = a.then.key;
    for (const b of rules) {
      if (!b.enabled || b.id === a.id) continue;
      const reads = new Set<string>();
      readsOf(b.when, reads);
      if (reads.has(writtenKey)) {
        const list = edges.get(a.id) ?? [];
        list.push(b.id);
        edges.set(a.id, list);
      }
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const r of rules) color.set(r.id, WHITE);
  const stack: string[] = [];

  function visit(id: string): string[] | null {
    color.set(id, GRAY);
    stack.push(id);
    for (const next of edges.get(id) ?? []) {
      const c = color.get(next);
      if (c === GRAY) {
        const start = stack.indexOf(next);
        return stack.slice(start).concat(next);
      }
      if (c === WHITE) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(id, BLACK);
    return null;
  }

  for (const r of rules) {
    if (color.get(r.id) === WHITE) {
      const found = visit(r.id);
      if (found) return found;
    }
  }
  return [];
}

// ---------- safe interpreter ----------

function compare(op: Operator, left: FieldValue, right: FieldValue): boolean {
  switch (op) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
      return typeof left === 'number' && typeof right === 'number' && left > right;
    case '>=':
      return typeof left === 'number' && typeof right === 'number' && left >= right;
    case '<':
      return typeof left === 'number' && typeof right === 'number' && left < right;
    case '<=':
      return typeof left === 'number' && typeof right === 'number' && left <= right;
    case 'contains':
      return (
        typeof left === 'string' && typeof right === 'string' && left.includes(right)
      );
    case 'startsWith':
      return (
        typeof left === 'string' && typeof right === 'string' && left.startsWith(right)
      );
    default:
      return false;
  }
}

// Evaluate one condition node against an input. Any node that references a
// missing field, or that exceeds the depth bound, evaluates to false rather
// than throwing, so a partial input can never crash an evaluation.
export function evalNode(node: ConditionNode, input: Input, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  if (node.kind === 'cmp') {
    if (!(node.field in input)) return false;
    return compare(node.op, input[node.field], node.value);
  }
  if (node.children.length === 0) return false;
  if (node.op === 'AND') {
    return node.children.every((c) => evalNode(c, input, depth + 1));
  }
  return node.children.some((c) => evalNode(c, input, depth + 1));
}

// Run every enabled rule in order and collect a decision. set actions also
// write their output back into a working copy of the input, so a later rule can
// read what an earlier rule produced; this is the chaining the cycle check
// guards. The original input is never mutated.
export function evaluate(rules: Rule[], input: Input): Decision {
  const working: Input = { ...input };
  const decision: Decision = { fired: [], outputs: {}, flags: [], routes: [] };
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!evalNode(rule.when, working)) continue;
    decision.fired.push(rule.id);
    const a = rule.then;
    if (a.kind === 'set') {
      decision.outputs[a.key] = a.value;
      working[a.key] = a.value;
    } else if (a.kind === 'flag') {
      if (!decision.flags.includes(a.name)) decision.flags.push(a.name);
    } else {
      if (!decision.routes.includes(a.to)) decision.routes.push(a.to);
    }
  }
  return decision;
}

export function describeAction(a: Action): string {
  if (a.kind === 'set') return `set ${a.key} = ${formatValue(a.value)}`;
  if (a.kind === 'flag') return `flag "${a.name}"`;
  return `route to "${a.to}"`;
}

export function formatValue(v: FieldValue): string {
  if (typeof v === 'string') return `"${v}"`;
  return String(v);
}

export function describeCondition(node: ConditionNode): string {
  if (node.kind === 'cmp') {
    return `${node.field} ${node.op} ${formatValue(node.value)}`;
  }
  const inner = (node as Group).children.map(describeCondition).join(` ${node.op} `);
  return `(${inner})`;
}
