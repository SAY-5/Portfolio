// Routing rules and payload transforms, ported from launchbridge/routing.py and
// launchbridge/transform.py. A destination matches when its `sources` accept
// the source, the payload's event type (the `type` field) matches one of its
// `event_types` globs and every `when` predicate holds; each decision carries
// the reason the service would record. The transform then shapes the payload
// inside the outbound envelope: pick, drop, rename, then templated set.
import { canonicalJson, type Json } from './signing';

export type Operator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'exists' | 'matches';

export interface Predicate {
  field: string;
  op: Operator;
  value: Json;
}

export interface Transform {
  pick?: string[];
  drop?: string[];
  rename?: Record<string, string>;
  set?: Record<string, Json>;
}

export interface RouteDecision {
  destination: string;
  routed: boolean;
  reason: string;
}

export interface RoutingRules {
  name: string;
  sources: string[];
  eventTypes: string[];
  when: Predicate[];
}

export const EVENT_TYPE_FIELD = 'type';

const MISSING = Symbol('missing');
type Lookup = Json | typeof MISSING;

function isObject(value: Lookup): value is { [key: string]: Json } {
  return value !== MISSING && value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Resolve a dotted path (`customer.address.city`, `items.0.sku`) against nested data.
export function lookup(data: Json | undefined, path: string): Lookup {
  let current: Lookup = data === undefined ? MISSING : data;
  for (const part of path.split('.')) {
    if (isObject(current)) {
      current = Object.prototype.hasOwnProperty.call(current, part) ? current[part] : MISSING;
    } else if (current !== MISSING && Array.isArray(current) && /^\d+$/.test(part) && Number(part) < current.length) {
      current = current[Number(part)];
    } else {
      return MISSING;
    }
    if (current === MISSING) return MISSING;
  }
  return current;
}

// Python repr for the reason strings the service records.
export function pyRepr(value: Json): string {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(', ')}]`;
  return `{${Object.entries(value)
    .map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`)
    .join(', ')}}`;
}

// fnmatchcase: `*`, `?` and `[seq]`, case sensitive.
export function globMatch(pattern: string, text: string): boolean {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') out += '.*';
    else if (c === '?') out += '.';
    else if (c === '[') {
      const j = pattern.indexOf(']', i + 1);
      if (j === -1) out += '\\[';
      else {
        let cls = pattern.slice(i + 1, j);
        if (cls.startsWith('!')) cls = '^' + cls.slice(1);
        out += `[${cls.replace(/\\/g, '\\\\')}]`;
        i = j;
      }
    } else out += c.replace(/[.+^${}()|\\/]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 's').test(text);
}

function equal(a: Json, b: Json): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

// Python raises TypeError for an ordering between unlike types; the service maps that to false.
function compare(a: Json, b: Json): number | null {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return null;
}

export function holds(p: Predicate, payload: Json | undefined): boolean {
  const actual = lookup(payload, p.field);
  const present = actual !== MISSING;
  if (p.op === 'exists') return present === p.value;
  if (!present) return p.op === 'ne' || p.op === 'not_in';
  const value = actual as Json;
  switch (p.op) {
    case 'eq':
      return equal(value, p.value);
    case 'ne':
      return !equal(value, p.value);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const c = compare(value, p.value);
      if (c === null) return false;
      return p.op === 'gt' ? c > 0 : p.op === 'gte' ? c >= 0 : p.op === 'lt' ? c < 0 : c <= 0;
    }
    case 'in':
      return Array.isArray(p.value) && p.value.some((v) => equal(v, value));
    case 'not_in':
      return Array.isArray(p.value) && !p.value.some((v) => equal(v, value));
    case 'matches':
      return typeof value === 'string' && typeof p.value === 'string' && new RegExp(p.value).test(value);
  }
  return false;
}

export function describe(p: Predicate): string {
  return `${p.field} ${p.op} ${pyRepr(p.value)}`;
}

// routing.decide(): the first rule that fails names the reason.
export function decide(rules: RoutingRules, source: string, payload: Json | undefined, eventTypeField: string = EVENT_TYPE_FIELD): RouteDecision {
  const reject = (reason: string): RouteDecision => ({ destination: rules.name, routed: false, reason });
  if (!rules.sources.includes('*') && !rules.sources.includes(source)) return reject(`source ${pyRepr(source)} not in ${pyRepr(rules.sources)}`);
  if (rules.eventTypes.length > 0) {
    const found = lookup(payload, eventTypeField);
    const eventType = typeof found === 'string' ? found : null;
    if (eventType === null) return reject(`payload has no ${pyRepr(eventTypeField)} field`);
    if (!rules.eventTypes.some((pattern) => globMatch(pattern, eventType))) return reject(`event type ${pyRepr(eventType)} not in ${pyRepr(rules.eventTypes)}`);
  }
  for (const predicate of rules.when) {
    if (!holds(predicate, payload)) return reject(`predicate failed: ${describe(predicate)}`);
  }
  return { destination: rules.name, routed: true, reason: 'matched' };
}

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)\}/g;
const WHOLE_PLACEHOLDER = /^\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)\}$/;

// Render placeholders inside strings; a value that is exactly one placeholder
// keeps the referenced JSON type, placeholders inside longer text render as
// strings and missing paths render empty.
export function render(value: Json, context: Json): Json {
  if (Array.isArray(value)) return value.map((v) => render(v, context));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value)) out[k] = render(v, context);
    return out;
  }
  if (typeof value !== 'string') return value;
  const whole = WHOLE_PLACEHOLDER.exec(value);
  if (whole) {
    const resolved = lookup(context, whole[1]);
    return resolved === MISSING ? null : resolved;
  }
  return value.replace(PLACEHOLDER, (_match, path: string) => {
    const resolved = lookup(context, path);
    if (resolved === MISSING || resolved === null) return '';
    return typeof resolved === 'string' ? resolved : typeof resolved === 'object' ? canonicalJson(resolved) : String(resolved);
  });
}

export function isIdentity(t: Transform): boolean {
  return !(t.pick?.length || t.drop?.length || (t.rename && Object.keys(t.rename).length) || (t.set && Object.keys(t.set).length));
}

// Transform.apply(): pick, drop, rename, then set. Non-object payloads pass through.
export function applyTransform(t: Transform, payload: Json, context: Record<string, Json>): Json {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  let result: Record<string, Json> = { ...payload };
  if (t.pick?.length) {
    const keep = new Set(t.pick);
    result = Object.fromEntries(Object.entries(result).filter(([k]) => keep.has(k)));
  }
  for (const key of t.drop ?? []) delete result[key];
  for (const [from, to] of Object.entries(t.rename ?? {})) {
    if (from in result) {
      const moved = result[from];
      delete result[from];
      result[to] = moved;
    }
  }
  const full: Record<string, Json> = { ...context, payload };
  for (const [key, template] of Object.entries(t.set ?? {})) result[key] = render(template, full);
  return result;
}

// One line naming what a transform does, for the page.
export function describeTransform(t: Transform): string {
  const parts: string[] = [];
  if (t.pick?.length) parts.push(`pick ${t.pick.join(', ')}`);
  if (t.drop?.length) parts.push(`drop ${t.drop.join(', ')}`);
  for (const [from, to] of Object.entries(t.rename ?? {})) parts.push(`rename ${from} to ${to}`);
  const set = Object.keys(t.set ?? {});
  if (set.length) parts.push(`set ${set.join(', ')}`);
  return parts.join('; ');
}
