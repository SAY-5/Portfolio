// Browser-side store for the config manager. It persists the whole config
// document (keys, base defaults, environments and their overrides) to
// localStorage and exposes a tiny external store so React components can
// subscribe through useSyncExternalStore. All mutations are explicit actions
// that write through to storage and notify subscribers. No clock, no network.

import { isValidKeyName } from './engine';
import type {
  ConfigDoc,
  ConfigKey,
  ConfigType,
  ConfigValue,
} from './types';

const DOC_KEY = 'configmesh.doc.v1';

// A realistic seed: a handful of typed keys, sensible base defaults, and three
// environments that progressively override values the way a real promotion
// pipeline would. dev has the broadest overrides; prod is the locked-down one.
function seedDoc(): ConfigDoc {
  const keys: ConfigKey[] = [
    { name: 'service.replicas', type: 'number', required: true },
    { name: 'feature.checkout_v2', type: 'bool', required: true },
    { name: 'log.level', type: 'string', required: true },
    { name: 'cache.ttl_seconds', type: 'number', required: false },
    { name: 'payments.provider', type: 'string', required: true },
    { name: 'rollout.percent', type: 'number', required: false },
  ];
  const base: Record<string, ConfigValue> = {
    'service.replicas': 2,
    'feature.checkout_v2': false,
    'log.level': 'info',
    'cache.ttl_seconds': 300,
    'payments.provider': 'stripe',
  };
  return {
    keys,
    base,
    environments: [
      {
        id: 'dev',
        name: 'dev',
        overrides: {
          'service.replicas': 1,
          'feature.checkout_v2': true,
          'log.level': 'debug',
          'rollout.percent': 100,
        },
      },
      {
        id: 'staging',
        name: 'staging',
        overrides: {
          'feature.checkout_v2': true,
          'cache.ttl_seconds': 120,
          'rollout.percent': 50,
        },
      },
      {
        id: 'prod',
        name: 'prod',
        overrides: {
          'service.replicas': 6,
          'log.level': 'warn',
        },
      },
    ],
  };
}

function readDoc(): ConfigDoc {
  try {
    const raw = localStorage.getItem(DOC_KEY);
    if (!raw) return seedDoc();
    const parsed = JSON.parse(raw) as ConfigDoc;
    if (!parsed.keys || !parsed.base || !parsed.environments) return seedDoc();
    return parsed;
  } catch {
    return seedDoc();
  }
}

function writeDoc(doc: ConfigDoc): void {
  try {
    localStorage.setItem(DOC_KEY, JSON.stringify(doc));
  } catch {
    // storage may be unavailable (private mode); state stays in memory.
  }
}

// ---------- minimal external store ----------

let doc: ConfigDoc = readDoc();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function commit(next: ConfigDoc): void {
  doc = next;
  writeDoc(doc);
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getDoc(): ConfigDoc {
  return doc;
}

// ---------- key actions ----------

export function addKey(name: string, type: ConfigType, required: boolean): boolean {
  const trimmed = name.trim();
  if (!isValidKeyName(trimmed, doc.keys)) return false;
  const keys = [...doc.keys, { name: trimmed, type, required }];
  commit({ ...doc, keys });
  return true;
}

export function updateKey(
  name: string,
  patch: { type?: ConfigType; required?: boolean },
): void {
  const keys = doc.keys.map((k) =>
    k.name === name ? { ...k, ...patch } : k,
  );
  commit({ ...doc, keys });
}

// Delete a key declaration and any base default or per-environment override for
// it, so no orphan values linger.
export function deleteKey(name: string): void {
  const keys = doc.keys.filter((k) => k.name !== name);
  const base = { ...doc.base };
  delete base[name];
  const environments = doc.environments.map((env) => {
    if (!Object.prototype.hasOwnProperty.call(env.overrides, name)) return env;
    const overrides = { ...env.overrides };
    delete overrides[name];
    return { ...env, overrides };
  });
  commit({ keys, base, environments });
}

// ---------- base default actions ----------

export function setBase(name: string, value: ConfigValue): void {
  const base = { ...doc.base, [name]: value };
  commit({ ...doc, base });
}

export function clearBase(name: string): void {
  if (!Object.prototype.hasOwnProperty.call(doc.base, name)) return;
  const base = { ...doc.base };
  delete base[name];
  commit({ ...doc, base });
}

// ---------- per-environment override actions ----------

export function setOverride(
  envId: string,
  name: string,
  value: ConfigValue,
): void {
  const environments = doc.environments.map((env) =>
    env.id === envId
      ? { ...env, overrides: { ...env.overrides, [name]: value } }
      : env,
  );
  commit({ ...doc, environments });
}

// Clear an override so the key falls back to inheriting the base default.
export function clearOverride(envId: string, name: string): void {
  const environments = doc.environments.map((env) => {
    if (env.id !== envId) return env;
    if (!Object.prototype.hasOwnProperty.call(env.overrides, name)) return env;
    const overrides = { ...env.overrides };
    delete overrides[name];
    return { ...env, overrides };
  });
  commit({ ...doc, environments });
}

// ---------- reset ----------

export function resetAll(): void {
  try {
    localStorage.removeItem(DOC_KEY);
  } catch {
    // ignore storage errors
  }
  commit(seedDoc());
}
