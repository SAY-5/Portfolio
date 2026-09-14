// Port of conduit/core/schema.py and conduit/core/mapping.py. The worker checks
// the source schema first and the mapping rules second; the first violation
// becomes a quarantine note. A payload that fails either is moved to the
// connector's quarantine queue, never retried and never dead-lettered.
import { pyRepr, taskField, type QuarantineNote, type Task } from './models';
import type { ConnectorSpec, FieldRule, FieldType } from './specs';

interface SchemaField {
  type: FieldType;
  required?: boolean;
  enum?: unknown[];
  maxLength?: number;
}

// The newest version of each connector's schemas/<connector>/v<N>.yaml.
export const SCHEMAS: Record<string, { version: number; fields: Record<string, SchemaField> }> = {
  'jira-support': {
    version: 2,
    fields: {
      id: { type: 'string', required: true, maxLength: 256 },
      title: { type: 'string', required: true },
      priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
      'fields.region': { type: 'string' },
      'fields.reporter': { type: 'string' },
    },
  },
  'slack-ops': {
    version: 1,
    fields: {
      id: { type: 'string', required: true, maxLength: 256 },
      title: { type: 'string', required: true },
      body: { type: 'string' },
      labels: { type: 'list' },
    },
  },
  'webhook-crm': {
    version: 1,
    fields: {
      id: { type: 'string', required: true, maxLength: 256 },
      title: { type: 'string', required: true },
      version: { type: 'integer', required: true },
      status: { type: 'string', enum: ['open', 'in_progress', 'blocked', 'done', 'closed'] },
    },
  },
};

function matches(value: unknown, type: FieldType): boolean {
  if (type === 'any') return true;
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'string') return typeof value === 'string';
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number';
  return Array.isArray(value);
}

const typeName = (v: unknown) => (Array.isArray(v) ? 'list' : typeof v === 'string' ? 'str' : typeof v === 'boolean' ? 'bool' : Number.isInteger(v) ? 'int' : typeof v);

function checkSchema(connector: string, task: Task): QuarantineNote | null {
  const schema = SCHEMAS[connector];
  if (!schema) return null;
  for (const [path, rule] of Object.entries(schema.fields)) {
    const value = taskField(task, path);
    const note = (reason: string, detail: string): QuarantineNote => ({ stage: 'schema', field: path, reason, detail: `${path}: ${detail}` });
    if (value === null) {
      if (rule.required) return note('missing', 'required source field is absent');
      continue;
    }
    if (!matches(value, rule.type)) return note('type', `expected ${rule.type}, got ${typeName(value)}`);
    if (rule.enum && !rule.enum.includes(value)) return note('enum', `${pyRepr(value)} is not one of ${pyRepr(rule.enum)}`);
    if (rule.maxLength && (typeof value === 'string' || Array.isArray(value)) && value.length > rule.maxLength) {
      return note('too_long', `length ${value.length} exceeds ${rule.maxLength}`);
    }
  }
  return null;
}

// A bare field path keeps its type; a $-template renders to a string.
export function render(source: string, task: Task): unknown {
  if (!source.includes('$')) return taskField(task, source);
  const values: Record<string, string> = {
    id: task.id, version: String(task.version), title: task.title, body: task.body, status: task.status,
    priority: task.priority, assignee: task.assignee ?? '', labels: task.labels.join(','),
  };
  return source.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, name: string) => values[name] ?? m);
}

function coerce(value: unknown, type: FieldType): unknown {
  if (type === 'any') return value;
  if (type === 'string') return String(value);
  if (type === 'integer') {
    const n = Number(value);
    if (typeof value === 'boolean' || !Number.isInteger(n)) throw new Error('not a whole number');
    return n;
  }
  if (type === 'number') {
    const n = Number(value);
    if (typeof value === 'boolean' || Number.isNaN(n)) throw new Error('not a number');
    return n;
  }
  if (type === 'boolean') {
    const word = String(value).trim().toLowerCase();
    if (typeof value === 'boolean') return value;
    if (['true', '1', 'yes', 'on'].includes(word)) return true;
    if (['false', '0', 'no', 'off'].includes(word)) return false;
    throw new Error('not a boolean word');
  }
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',').map((p) => p.trim()).filter(Boolean);
  throw new Error('not a list');
}

// apply_rule: render, default, coerce, enum, max_length and truncate.
export function applyRule(remote: string, rule: FieldRule, task: Task): unknown {
  const fail = (reason: string, detail: string): never => {
    throw Object.assign(new Error(`${remote}: ${detail}`), { note: { stage: 'mapping', field: remote, reason, detail: `${remote}: ${detail}` } as QuarantineNote });
  };
  let value = rule.source !== null ? render(rule.source, task) : null;
  if (value === null || value === undefined) value = rule.default;
  if (value === null || value === undefined) return rule.required ? fail('required', 'required field is missing') : null;
  try {
    value = coerce(value, rule.type);
  } catch (exc) {
    fail('type', `expected ${rule.type}, got ${pyRepr(value)} (${(exc as Error).message})`);
  }
  if (rule.enum && !rule.enum.includes(value)) fail('enum', `${pyRepr(value)} is not one of ${pyRepr(rule.enum)}`);
  if (rule.maxLength !== null && (typeof value === 'string' || Array.isArray(value)) && value.length > rule.maxLength) {
    if (!rule.truncate) fail('max_length', `length ${value.length} exceeds ${rule.maxLength}`);
    value = value.slice(0, rule.maxLength);
  }
  return value;
}

export function applyMapping(spec: ConnectorSpec, task: Task): Record<string, unknown> {
  return Object.fromEntries(Object.entries(spec.mapping).map(([remote, rule]) => [remote, applyRule(remote, rule, task)]));
}

// Worker.inspect: schema first, then mapping; null when the task can be delivered.
export function inspect(spec: ConnectorSpec, task: Task): QuarantineNote | null {
  const schemaNote = checkSchema(spec.name, task);
  if (schemaNote) return schemaNote;
  try {
    applyMapping(spec, task);
    return null;
  } catch (exc) {
    return (exc as { note?: QuarantineNote }).note ?? { stage: 'mapping', field: '', reason: 'error', detail: String(exc) };
  }
}
