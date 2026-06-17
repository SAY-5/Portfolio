// Pure template engine: placeholder detection, safe substitution, validation,
// and a line-based diff. There is no eval and no dynamic code; rendering is a
// plain string replace over a fixed {{name}} grammar, so untrusted bodies can
// never execute. All functions are deterministic and side-effect free.

import type { DiffLine, RenderResult, VarDef, Version } from './types';

// A placeholder is {{ name }} where name is letters, digits, underscore, dot or
// dash. Surrounding whitespace inside the braces is ignored.
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

// Return the distinct placeholder names referenced by a body, in first-seen
// order. Used by the editor to live-detect which variables a body needs.
export function detectVars(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(PLACEHOLDER)) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

// Build an empty variable definition for a freshly detected placeholder.
export function emptyVar(name: string): VarDef {
  return { name, type: 'text', default: '', options: [] };
}

// Resolve the value to substitute for a variable: the supplied value if present
// and non-empty, otherwise its declared default.
function resolve(def: VarDef | undefined, supplied: string | undefined): string {
  if (supplied !== undefined && supplied !== '') return supplied;
  if (def && def.default !== '') return def.default;
  return supplied ?? '';
}

// Render a body by substituting variable values. Reports undeclared
// placeholders (used in body but not declared), missing values (declared and
// referenced but with no value and no default), and invalid enum selections.
// Unresolved placeholders are left verbatim so the gap is visible in output.
export function render(
  body: string,
  defs: VarDef[],
  values: Record<string, string>,
): RenderResult {
  const defByName = new Map(defs.map((d) => [d.name, d]));
  const referenced = detectVars(body);

  const undeclared: string[] = [];
  const missing: string[] = [];
  const invalidEnum: string[] = [];

  for (const name of referenced) {
    const def = defByName.get(name);
    if (!def) {
      undeclared.push(name);
      continue;
    }
    const value = resolve(def, values[name]);
    if (value === '') {
      missing.push(name);
      continue;
    }
    if (
      def.type === 'enum' &&
      def.options.length > 0 &&
      !def.options.includes(value)
    ) {
      invalidEnum.push(name);
    }
  }

  const output = body.replace(PLACEHOLDER, (whole, rawName: string) => {
    const def = defByName.get(rawName);
    if (!def) return whole;
    const value = resolve(def, values[rawName]);
    return value === '' ? whole : value;
  });

  return { output, undeclared, missing, invalidEnum };
}

// True when a body renders cleanly: every placeholder is declared, valued, and
// any enum selection is within its options.
export function isClean(result: RenderResult): boolean {
  return (
    result.undeclared.length === 0 &&
    result.missing.length === 0 &&
    result.invalidEnum.length === 0
  );
}

// Longest-common-subsequence line diff between two bodies. Produces a flat list
// of same/added/removed lines suitable for a side-by-side or stacked view.
export function diffLines(prev: string, next: string): DiffLine[] {
  const a = prev.split('\n');
  const b = next.split('\n');
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'removed', text: a[i] });
      i++;
    } else {
      out.push({ kind: 'added', text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: 'removed', text: a[i++] });
  while (j < m) out.push({ kind: 'added', text: b[j++] });
  return out;
}

// Count of changed (added or removed) lines between two versions, for a compact
// summary next to a diff.
export function diffStat(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === 'added') added++;
    else if (line.kind === 'removed') removed++;
  }
  return { added, removed };
}

// Format a saved-at timestamp as a short local date-time for version labels.
export function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Compare a working draft against a saved version to tell whether the draft has
// unsaved changes, which drives the save button state.
export function isDirty(
  body: string,
  vars: VarDef[],
  version: Version | undefined,
): boolean {
  if (!version) return true;
  if (body !== version.body) return true;
  if (vars.length !== version.vars.length) return true;
  for (let i = 0; i < vars.length; i++) {
    const a = vars[i];
    const b = version.vars[i];
    if (
      a.name !== b.name ||
      a.type !== b.type ||
      a.default !== b.default ||
      a.options.join('') !== b.options.join('')
    ) {
      return true;
    }
  }
  return false;
}
