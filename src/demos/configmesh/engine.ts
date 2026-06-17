// Pure resolution, validation, and diff engine for the config manager. No eval,
// no I/O, no clock: every function is a deterministic transform of its inputs,
// so the same document always yields the same resolved values, the same issues,
// and the same diff. The UI layers persistence and rendering on top.

import type {
  ConfigDoc,
  ConfigKey,
  ConfigType,
  ConfigValue,
  DiffEntry,
  Environment,
  Resolved,
  ValidationIssue,
} from './types';

// The effective value for one key in one environment: the override if the
// environment declares one, otherwise the base default, otherwise undefined.
export function effectiveValue(
  doc: ConfigDoc,
  env: Environment,
  keyName: string,
): { value: ConfigValue | undefined; overridden: boolean } {
  if (Object.prototype.hasOwnProperty.call(env.overrides, keyName)) {
    return { value: env.overrides[keyName], overridden: true };
  }
  if (Object.prototype.hasOwnProperty.call(doc.base, keyName)) {
    return { value: doc.base[keyName], overridden: false };
  }
  return { value: undefined, overridden: false };
}

// Resolve every declared key for one environment, in key-declaration order so
// the output is stable.
export function resolveEnvironment(
  doc: ConfigDoc,
  env: Environment,
): Resolved[] {
  return doc.keys.map((key) => {
    const { value, overridden } = effectiveValue(doc, env, key.name);
    return {
      name: key.name,
      type: key.type,
      required: key.required,
      value,
      overridden,
    };
  });
}

// Whether a stored value matches the declared type. undefined is treated as
// "no value" rather than a type error; missing-required covers that case.
export function matchesType(value: ConfigValue | undefined, type: ConfigType): boolean {
  if (value === undefined) return true;
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'bool':
      return typeof value === 'boolean';
  }
}

function typeOfValue(value: ConfigValue): string {
  return typeof value;
}

// Validate one environment: every required key must resolve to a defined value,
// and every defined value must match its key's declared type.
export function validateEnvironment(
  doc: ConfigDoc,
  env: Environment,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const key of doc.keys) {
    const { value } = effectiveValue(doc, env, key.name);
    if (key.required && value === undefined) {
      issues.push({ kind: 'missing-required', key: key.name });
      continue;
    }
    if (value !== undefined && !matchesType(value, key.type)) {
      issues.push({
        kind: 'type-error',
        key: key.name,
        expected: key.type,
        got: typeOfValue(value),
      });
    }
  }
  return issues;
}

function findEnv(doc: ConfigDoc, id: string): Environment | undefined {
  return doc.environments.find((e) => e.id === id);
}

// Diff the effective values of two environments. A key present (defined) in one
// but not the other is added/removed; a key defined in both with differing
// values is changed. Keys undefined in both are skipped. Output is in
// key-declaration order.
export function diffEnvironments(
  doc: ConfigDoc,
  fromId: string,
  toId: string,
): DiffEntry[] {
  const from = findEnv(doc, fromId);
  const to = findEnv(doc, toId);
  if (!from || !to) return [];

  const entries: DiffEntry[] = [];
  for (const key of doc.keys) {
    const a = effectiveValue(doc, from, key.name).value;
    const b = effectiveValue(doc, to, key.name).value;
    if (a === undefined && b === undefined) continue;
    if (a === undefined && b !== undefined) {
      entries.push({ kind: 'added', key: key.name, value: b });
      continue;
    }
    if (a !== undefined && b === undefined) {
      entries.push({ kind: 'removed', key: key.name, value: a });
      continue;
    }
    if (a !== b) {
      entries.push({ kind: 'changed', key: key.name, from: a, to: b });
    }
  }
  return entries;
}

// Coerce a raw text input into the declared type for storage. Returns null when
// the text cannot be parsed as that type, so callers can reject the edit rather
// than store a malformed value.
export function coerceValue(raw: string, type: ConfigType): ConfigValue | null {
  switch (type) {
    case 'string':
      return raw;
    case 'number': {
      const trimmed = raw.trim();
      if (trimmed === '') return null;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : null;
    }
    case 'bool': {
      const t = raw.trim().toLowerCase();
      if (t === 'true') return true;
      if (t === 'false') return false;
      return null;
    }
  }
}

// Render a stored value for display. undefined shows as an em-free placeholder.
export function formatValue(value: ConfigValue | undefined): string {
  if (value === undefined) return '(unset)';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

// True when a key name is a valid, unique identifier within the document.
export function isValidKeyName(name: string, existing: ConfigKey[]): boolean {
  if (!/^[a-zA-Z][\w.-]*$/.test(name)) return false;
  return !existing.some((k) => k.name === name);
}
