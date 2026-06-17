// Catalog store: persists to localStorage, exposes a useSyncExternalStore
// compatible interface. All mutations return a new Catalog (no mutation in place).

import { useSyncExternalStore } from 'react';
import type { Catalog, CatalogKey, LocaleEntry } from './types';
import { blankEntry, makeKey, placeholdersMatch } from './engine';

const STORAGE_KEY = 'localebridge_catalog_v1';

const DEFAULT_CATALOG: Catalog = {
  keys: [
    {
      id: 'k1',
      key: 'app.title',
      baseValue: 'Welcome to the app',
      baseRevision: 1,
      translations: {},
    },
    {
      id: 'k2',
      key: 'nav.home',
      baseValue: 'Home',
      baseRevision: 1,
      translations: {},
    },
    {
      id: 'k3',
      key: 'nav.settings',
      baseValue: 'Settings',
      baseRevision: 1,
      translations: {},
    },
    {
      id: 'k4',
      key: 'user.greeting',
      baseValue: 'Hello, {name}!',
      baseRevision: 1,
      translations: {},
    },
    {
      id: 'k5',
      key: 'cart.items',
      baseValue: '{count} item(s) in your cart',
      baseRevision: 1,
      translations: {},
    },
  ],
  locales: ['es', 'fr', 'de'],
};

function load(): Catalog {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CATALOG;
    return JSON.parse(raw) as Catalog;
  } catch {
    return DEFAULT_CATALOG;
  }
}

function save(catalog: Catalog): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog));
  } catch {
    // storage may be unavailable in some contexts
  }
}

// Subscribers receive notification when the catalog changes.
type Listener = () => void;
let catalog: Catalog = load();
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l();
}

function dispatch(next: Catalog): void {
  catalog = next;
  save(next);
  notify();
}

// useSyncExternalStore integration.
function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Catalog {
  return catalog;
}

export function useCatalog(): Catalog {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ---- mutations ----

let nextId = Date.now();
function uid(): string {
  return `k${(nextId++).toString(36)}`;
}

export function addKey(key: string, baseValue: string): void {
  if (!key.trim() || !baseValue.trim()) return;
  const exists = catalog.keys.find((k) => k.key === key.trim());
  if (exists) return;
  const next: Catalog = {
    ...catalog,
    keys: [...catalog.keys, makeKey(uid(), key.trim(), baseValue.trim())],
  };
  dispatch(next);
}

export function deleteKey(id: string): void {
  dispatch({ ...catalog, keys: catalog.keys.filter((k) => k.id !== id) });
}

export function editBaseValue(id: string, baseValue: string): void {
  const keys = catalog.keys.map((k): CatalogKey => {
    if (k.id !== id) return k;
    const newRevision = k.baseRevision + 1;
    // Mark any existing translations as stale (their baseRevision is now behind).
    const translations: Record<string, LocaleEntry> = {};
    for (const locale of Object.keys(k.translations)) {
      const entry = k.translations[locale];
      if (entry.value) {
        translations[locale] = { ...entry, baseRevision: entry.baseRevision };
        // Leave baseRevision unchanged so effectiveStatus will detect stale.
      } else {
        translations[locale] = entry;
      }
    }
    return { ...k, baseValue: baseValue.trim(), baseRevision: newRevision, translations };
  });
  dispatch({ ...catalog, keys });
}

export function setTranslation(id: string, locale: string, value: string): void {
  const keys = catalog.keys.map((k): CatalogKey => {
    if (k.id !== id) return k;
    const trimmed = value.trim();
    let status: LocaleEntry['status'] = 'untranslated';
    if (trimmed) {
      status = placeholdersMatch(k.baseValue, trimmed)
        ? 'translated'
        : 'placeholder_mismatch';
    }
    const entry: LocaleEntry = {
      value: trimmed,
      status,
      baseRevision: k.baseRevision,
    };
    return { ...k, translations: { ...k.translations, [locale]: entry } };
  });
  dispatch({ ...catalog, keys });
}

export function addLocale(code: string): void {
  const trimmed = code.trim().toLowerCase();
  if (!trimmed || catalog.locales.includes(trimmed)) return;
  dispatch({ ...catalog, locales: [...catalog.locales, trimmed] });
}

export function removeLocale(code: string): void {
  if (catalog.locales.length <= 1) return;
  const locales = catalog.locales.filter((l) => l !== code);
  // Strip translations for the removed locale.
  const keys = catalog.keys.map((k): CatalogKey => {
    const translations = { ...k.translations };
    delete translations[code];
    return { ...k, translations };
  });
  dispatch({ ...catalog, keys, locales });
}

export function resetCatalog(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  catalog = { ...DEFAULT_CATALOG };
  // Deep-copy to avoid mutation of the default object.
  catalog = JSON.parse(JSON.stringify(DEFAULT_CATALOG)) as Catalog;
  notify();
}

// Initialise translations map for a key so every current locale has at least
// a blank entry. Called when new locales are added.
export function ensureEntries(k: CatalogKey): CatalogKey {
  const translations: Record<string, LocaleEntry> = { ...k.translations };
  for (const locale of catalog.locales) {
    if (!translations[locale]) {
      translations[locale] = blankEntry();
    }
  }
  return { ...k, translations };
}
