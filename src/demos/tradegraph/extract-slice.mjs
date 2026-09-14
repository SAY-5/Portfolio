/*
 * Cuts the exposure demo slice out of the committed tradegraph sample.
 *
 *   node src/demos/tradegraph/extract-slice.mjs <path to a SAY-5/tradegraph checkout>
 *
 * Input is web/src/data/slice.json of the tradegraph repository, which
 * web/scripts/extract-slice.ts cuts from etl/sample. Its sha256 is checked against
 * web/src/data/slice-manifest.json first, so the cut always starts from the committed
 * bytes. Output is slice.json next to this script. Nothing depends on the clock or a
 * random source, so a rerun on the same input writes the same bytes.
 *
 * Kept:
 *   - the seven fund families the README demo grid names, each with its whole
 *     subsidiary tree to LINEAGE_DEPTH levels; the funds in that tree are the holders;
 *   - the thirteen issuers the README demo names, plus the EXTRA_ISSUERS top-level
 *     issuers those families hold the most of in the latest reporting period;
 *   - every subsidiary of a kept issuer to LINEAGE_DEPTH levels, and every ancestor of a
 *     kept entity, so no parent link dangles and a root is still a root;
 *   - every position a kept fund holds in a kept issuer or in one of its subsidiaries,
 *     in both reporting periods, and the instruments those positions name.
 *
 * Dropped: the ontology triples, the SPARQL templates, filings (a position keeps the
 * period of its filing), CIKs, jurisdictions, instrument names, and every other holder
 * and issuer.
 *
 * Why the cut changes no answer: exposure(fund, issuer) reads only positions whose holder
 * is a fund in the family of the fund's ultimate parent and whose issuer is the issuer
 * or one of its subsidiaries within the depth budget. Whole families, whole subsidiary
 * trees to five levels and every position between them are all kept, in their original
 * order, so the grouping, the ordering and the sums run over the same rows.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.argv[2] ?? '.');
const SOURCE = join(REPO, 'web', 'src', 'data', 'slice.json');
const MANIFEST = join(REPO, 'web', 'src', 'data', 'slice-manifest.json');
const OUT = join(HERE, 'slice.json');

/** tradegraph.lineage.max-depth; the exposure cap (4) sits under it. */
const LINEAGE_DEPTH = 5;
const EXTRA_ISSUERS = 12;
const FAMILY_TICKERS = ['BLK', 'IVZ', 'TROW', 'BEN', 'STT', 'AMP', 'TPG'];
const ISSUER_TICKERS = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'JPM', 'XOM', 'JNJ', 'WMT', 'PG', 'UNH', 'NU',
];

const ISSUER = 1;
const FUND = 2;

const raw = readFileSync(SOURCE);
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const sha256 = createHash('sha256').update(raw).digest('hex');
if (sha256 !== manifest.sha256) {
  throw new Error(`slice.json sha256 ${sha256} does not match the manifest ${manifest.sha256}`);
}
const slice = JSON.parse(raw.toString('utf8'));

// Source rows, as web/scripts/extract-slice.ts writes them:
//   entities    [id, name, kindBits, ticker, cik, parentIndex, jurisdiction, filingIndex, ownership]
//   filings     [accession, formType, filerIndex, period]
//   instruments [cusip, instrumentClass, ticker, issuerIndex, name]
//   positions   [filingIndex, indexInFiling, holderIndex, issuerIndex, instrumentIndex, quantity, value]
const entities = slice.entities;
const periodOf = (position) => slice.filings[position[0]][3];

const childrenOf = new Map();
entities.forEach((row, index) => {
  if (row[5] < 0) return;
  const list = childrenOf.get(row[5]);
  if (list) list.push(index); else childrenOf.set(row[5], [index]);
});

function byTicker(ticker, kind) {
  const index = entities.findIndex((row) => row[3] === ticker && (row[2] & kind) !== 0 && row[5] < 0);
  if (index < 0) throw new Error(`no top-level entity with ticker ${ticker}`);
  return index;
}

function descendants(root, depth) {
  const seen = new Set();
  let frontier = [root];
  for (let level = 0; level < depth && frontier.length > 0; level += 1) {
    const next = [];
    for (const parent of frontier) {
      for (const child of childrenOf.get(parent) ?? []) {
        if (!seen.has(child)) {
          seen.add(child);
          next.push(child);
        }
      }
    }
    frontier = next;
  }
  return [...seen];
}

function rootOf(index) {
  let cursor = index;
  while (entities[cursor][5] >= 0) cursor = entities[cursor][5];
  return cursor;
}

const families = FAMILY_TICKERS.map((ticker) => byTicker(ticker, FUND));
const familyMembers = new Set();
for (const root of families) {
  for (const index of [root, ...descendants(root, LINEAGE_DEPTH)]) familyMembers.add(index);
}
const funds = new Set([...familyMembers].filter((index) => (entities[index][2] & FUND) !== 0));

const periods = [...new Set(slice.positions.map(periodOf))].sort().reverse();
const latest = periods[0];

const issuers = ISSUER_TICKERS.map((ticker) => byTicker(ticker, ISSUER));
const heldValue = new Map();
for (const position of slice.positions) {
  if (!funds.has(position[2]) || periodOf(position) !== latest) continue;
  const root = rootOf(position[3]);
  const kinds = entities[root][2];
  if ((kinds & ISSUER) === 0 || (kinds & FUND) !== 0) continue;
  heldValue.set(root, (heldValue.get(root) ?? 0) + position[6]);
}
const extras = [...heldValue.entries()]
  .filter(([index]) => !issuers.includes(index))
  .sort((a, b) => (b[1] - a[1]) || (entities[a[0]][0] < entities[b[0]][0] ? -1 : 1))
  .slice(0, EXTRA_ISSUERS)
  .map(([index]) => index);

const issuingEntities = new Set();
for (const issuer of [...issuers, ...extras]) {
  issuingEntities.add(issuer);
  for (const child of descendants(issuer, LINEAGE_DEPTH)) issuingEntities.add(child);
}

const kept = new Set([...familyMembers, ...issuingEntities]);
for (const index of [...kept]) {
  let cursor = entities[index][5];
  while (cursor >= 0) {
    kept.add(cursor);
    cursor = entities[cursor][5];
  }
}

const positions = slice.positions.filter((p) => funds.has(p[2]) && issuingEntities.has(p[3]));
const entityOrder = [...kept].sort((a, b) => a - b);
const entityIndex = new Map(entityOrder.map((original, index) => [original, index]));
const instrumentOrder = [...new Set(positions.map((p) => p[4]))].sort((a, b) => a - b);
const instrumentIndex = new Map(instrumentOrder.map((original, index) => [original, index]));

const out = {
  source: {
    repository: 'SAY-5/tradegraph',
    file: 'web/src/data/slice.json',
    sha256,
    families: FAMILY_TICKERS,
    issuers: ISSUER_TICKERS,
    extraIssuers: EXTRA_ISSUERS,
    lineageDepth: LINEAGE_DEPTH,
  },
  periods,
  // [id, name, kindBits, ticker, parentIndex, ownership]; ownership null means undisclosed.
  entities: entityOrder.map((original) => {
    const row = entities[original];
    return [row[0], row[1], row[2], row[3], row[5] >= 0 ? entityIndex.get(row[5]) : -1, row[8] ?? null];
  }),
  // [cusip, instrumentClass, ticker]
  instruments: instrumentOrder.map((original) => {
    const row = slice.instruments[original];
    return [row[0], row[1], row[2]];
  }),
  // [holderIndex, issuerIndex, instrumentIndex, periodIndex, quantity, value]
  positions: positions.map((p) => [
    entityIndex.get(p[2]),
    entityIndex.get(p[3]),
    instrumentIndex.get(p[4]),
    periods.indexOf(periodOf(p)),
    p[5],
    p[6],
  ]),
};

const json = `${JSON.stringify(out)}\n`;
writeFileSync(OUT, json);
process.stdout.write(
  `slice.json ${json.length} bytes: ${out.entities.length} entities, ${funds.size} funds in `
  + `${families.length} families, ${issuers.length + extras.length} issuers with `
  + `${issuingEntities.size - issuers.length - extras.length} subsidiaries, `
  + `${out.instruments.length} instruments, ${out.positions.length} positions over ${periods.join(' and ')}\n`,
);
