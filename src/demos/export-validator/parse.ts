// Safe parsers for pasted records. Both paths read text only: the CSV reader is
// a small hand-rolled state machine that honours quotes and escaped quotes, and
// the JSON path goes through JSON.parse. Neither uses eval or the Function
// constructor, so pasted text can never execute.

import type { DataRecord } from './types';

export type ParsedRecords = {
  fields: string[];
  records: DataRecord[];
};

// Split one CSV line into cells, respecting double-quoted fields and the ""
// escape for a literal quote. Commas inside quotes are kept verbatim.
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

// Parse CSV text whose first non-empty line is the header row. Extra cells past
// the header are dropped; missing cells become empty strings.
export function parseCsv(text: string): ParsedRecords {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l)
    .filter((l) => l.trim() !== '');

  if (lines.length === 0) return { fields: [], records: [] };

  const header = splitCsvLine(lines[0]).filter((h) => h !== '');
  const records: DataRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const record: DataRecord = {};
    header.forEach((field, idx) => {
      record[field] = cells[idx] ?? '';
    });
    records.push(record);
  }

  return { fields: header, records };
}

// Parse a JSON array of flat objects. Values are coerced to strings so they
// share the cell shape the engine expects. Anything that is not an array of
// objects yields an empty result rather than throwing past the caller.
export function parseJson(text: string): ParsedRecords {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { fields: [], records: [] };
  }
  if (!Array.isArray(data)) return { fields: [], records: [] };

  const fieldOrder: string[] = [];
  const seen = new Set<string>();
  const records: DataRecord[] = [];

  for (const row of data) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    const record: DataRecord = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      if (!seen.has(key)) {
        seen.add(key);
        fieldOrder.push(key);
      }
      record[key] = value === null || value === undefined ? '' : String(value);
    }
    records.push(record);
  }

  return { fields: fieldOrder, records };
}

// Pick a parser by sniffing the first non-space character. A leading [ or {
// reads as JSON; everything else is treated as CSV.
export function parseRecords(text: string): ParsedRecords {
  const trimmed = text.trim();
  if (trimmed === '') return { fields: [], records: [] };
  const first = trimmed[0];
  if (first === '[' || first === '{') return parseJson(trimmed);
  return parseCsv(trimmed);
}
