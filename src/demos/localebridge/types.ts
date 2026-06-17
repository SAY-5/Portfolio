// Core types for the localebridge translation management catalog.

export type TranslationStatus =
  | 'untranslated'
  | 'translated'
  | 'stale'
  | 'placeholder_mismatch';

export type LocaleEntry = {
  value: string;
  status: TranslationStatus;
  // The base revision at the time this translation was last set.
  baseRevision: number;
};

// A single translatable key in the catalog.
export type CatalogKey = {
  id: string;
  key: string;
  // The canonical base (en) value.
  baseValue: string;
  // Monotonically increasing counter; bumped each time baseValue changes.
  baseRevision: number;
  // Translations keyed by locale code (excludes the base locale).
  translations: Record<string, LocaleEntry>;
};

export type Catalog = {
  keys: CatalogKey[];
  // Target locale codes (not including the base locale "en").
  locales: string[];
};

// Per-locale completeness summary derived by the engine.
export type LocaleStats = {
  locale: string;
  total: number;
  translated: number;
  missing: number;
  stale: number;
  mismatch: number;
  percent: number;
};

export type ValidationIssue = {
  keyId: string;
  key: string;
  locale: string;
  kind: 'missing' | 'stale' | 'placeholder_mismatch';
  detail: string;
};
