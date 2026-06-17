// Pure engine: no side effects, no eval, no external I/O.
// All functions are deterministic given their inputs.

import type {
  Catalog,
  CatalogKey,
  LocaleEntry,
  LocaleStats,
  TranslationStatus,
  ValidationIssue,
} from './types';

// Extract {placeholder} tokens from a string. Returns a sorted array of
// unique token names so order does not matter in comparison.
export function extractPlaceholders(value: string): string[] {
  const found: string[] = [];
  const re = /\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const token = m[1].trim();
    if (token && !found.includes(token)) {
      found.push(token);
    }
  }
  return found.sort();
}

// Determine whether a translation value has the same placeholder set as the
// base value. Returns true when both sets match exactly.
export function placeholdersMatch(base: string, translation: string): boolean {
  const baseTokens = extractPlaceholders(base);
  const txTokens = extractPlaceholders(translation);
  if (baseTokens.length !== txTokens.length) return false;
  for (let i = 0; i < baseTokens.length; i++) {
    if (baseTokens[i] !== txTokens[i]) return false;
  }
  return true;
}

// Compute the effective status for a locale entry given the current base
// revision. Called whenever a translation is read.
export function effectiveStatus(
  entry: LocaleEntry,
  currentBaseRevision: number,
): TranslationStatus {
  if (!entry.value) return 'untranslated';
  if (entry.status === 'placeholder_mismatch') return 'placeholder_mismatch';
  if (entry.baseRevision < currentBaseRevision) return 'stale';
  return 'translated';
}

// Derive per-locale stats across the whole catalog.
export function computeStats(catalog: Catalog): LocaleStats[] {
  return catalog.locales.map((locale) => {
    const total = catalog.keys.length;
    let translated = 0;
    let missing = 0;
    let stale = 0;
    let mismatch = 0;

    for (const k of catalog.keys) {
      const entry = k.translations[locale];
      if (!entry || !entry.value) {
        missing++;
        continue;
      }
      const status = effectiveStatus(entry, k.baseRevision);
      if (status === 'translated') {
        translated++;
      } else if (status === 'stale') {
        stale++;
      } else if (status === 'placeholder_mismatch') {
        mismatch++;
      }
    }

    const percent = total === 0 ? 100 : Math.round((translated / total) * 100);
    return { locale, total, translated, missing, stale, mismatch, percent };
  });
}

// Collect all validation issues across every key and locale.
export function collectIssues(catalog: Catalog): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const k of catalog.keys) {
    for (const locale of catalog.locales) {
      const entry = k.translations[locale];
      if (!entry || !entry.value) {
        issues.push({
          keyId: k.id,
          key: k.key,
          locale,
          kind: 'missing',
          detail: 'No translation set',
        });
        continue;
      }

      const status = effectiveStatus(entry, k.baseRevision);

      if (status === 'stale') {
        issues.push({
          keyId: k.id,
          key: k.key,
          locale,
          kind: 'stale',
          detail: `Base value changed (rev ${entry.baseRevision} -> ${k.baseRevision})`,
        });
      } else if (status === 'placeholder_mismatch') {
        const base = extractPlaceholders(k.baseValue);
        const tx = extractPlaceholders(entry.value);
        issues.push({
          keyId: k.id,
          key: k.key,
          locale,
          kind: 'placeholder_mismatch',
          detail: `Base has {${base.join(', ')}} but translation has {${tx.join(', ')}}`,
        });
      }
    }
  }

  return issues;
}

// Build the merged JSON output for a given locale. Produces an object where
// each key maps to its translated value (or the base value as fallback when
// untranslated so the output is always complete).
export function exportLocale(
  catalog: Catalog,
  locale: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const k of catalog.keys) {
    const entry = k.translations[locale];
    result[k.key] = entry?.value || k.baseValue;
  }
  return result;
}

// Produce a dry validation summary for export: list of keys and their status.
export type ExportSummaryRow = {
  key: string;
  status: TranslationStatus;
  value: string;
};

export function exportSummary(
  catalog: Catalog,
  locale: string,
): ExportSummaryRow[] {
  return catalog.keys.map((k) => {
    const entry = k.translations[locale];
    if (!entry || !entry.value) {
      return { key: k.key, status: 'untranslated' as TranslationStatus, value: k.baseValue };
    }
    const status = effectiveStatus(entry, k.baseRevision);
    return { key: k.key, status, value: entry.value };
  });
}

// Create a blank LocaleEntry.
export function blankEntry(): LocaleEntry {
  return { value: '', status: 'untranslated', baseRevision: 0 };
}

// Create a new CatalogKey with a given key string and base value.
export function makeKey(
  id: string,
  key: string,
  baseValue: string,
): CatalogKey {
  return {
    id,
    key,
    baseValue,
    baseRevision: 1,
    translations: {},
  };
}
