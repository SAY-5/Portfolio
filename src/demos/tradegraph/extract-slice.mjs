/*
 * Cuts the exposure demo slice out of the committed tradegraph sample.
 *
 *   node src/demos/tradegraph/extract-slice.mjs <path to a SAY-5/tradegraph checkout>
 *
 * Run `make etl-validate` in the checkout first: it writes etl/build/quality.json, the report
 * the README's data quality line is checked against.
 *
 * Input is web/src/data/slice.json of the tradegraph repository, which
 * web/scripts/extract-slice.ts cuts from etl/sample. Its sha256 is checked against
 * web/src/data/slice-manifest.json first, so the cut always starts from the committed
 * bytes. Output is slice.json next to this script. Nothing depends on the clock or a
 * random source, so a rerun on the same checkout writes the same bytes.
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
 * Carried over under `source`, so the page can label every figure it shows with where
 * it came from:
 *   - the commit of the checkout and the manifest's slice counts, full sample counts
 *     and reporting periods;
 *   - prefixes.rq and exposure.rq, byte for byte from api/src/main/resources/queries,
 *     which the page renders the way the API does for the answer on screen;
 *   - the run behind the README's `make demo` block: provenance, store and top pairs
 *     from web/src/data/demo-summary.json, and the exposure totals, lineage counts,
 *     data quality line and cost guard line parsed out of that block in README.md,
 *     each with the line it was read from. The parse fails if the block moves. Before
 *     anything is written, the README totals and store are checked against
 *     demo-summary.json, and the data quality and cost guard lines against the quality
 *     report and the API source as described where they are checked.
 *
 * Dropped: the ontology triples, the other SPARQL templates, filings (a position keeps
 * the period of its filing), CIKs, jurisdictions, instrument names, and every other
 * holder and issuer.
 *
 * Why the cut changes no answer: exposure(fund, issuer) reads only positions whose holder
 * is a fund in the family of the fund's ultimate parent and whose issuer is the issuer
 * or one of its subsidiaries within the depth budget. Whole families, whole subsidiary
 * trees to five levels and every position between them are all kept, in their original
 * order, so the grouping, the ordering and the sums run over the same rows.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { STATUS_CODES } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.argv[2] ?? '.');
const SOURCE = join(REPO, 'web', 'src', 'data', 'slice.json');
const MANIFEST = join(REPO, 'web', 'src', 'data', 'slice-manifest.json');
const SUMMARY = join(REPO, 'web', 'src', 'data', 'demo-summary.json');
const README = join(REPO, 'README.md');
const QUERIES = join(REPO, 'api', 'src', 'main', 'resources', 'queries');
/** Written by `make etl-validate` (tradegraph-etl validate --sample --out build); gitignored. */
const QUALITY_REPORT = join(REPO, 'etl', 'build', 'quality.json');
const DEMO_QUERIES = join(REPO, 'scripts', 'demo_queries.py');
const API_RESOURCES = join(REPO, 'api', 'src', 'main', 'resources');
const EXCEPTION_HANDLER = join(REPO, 'api', 'src', 'main', 'java', 'dev', 'tradegraph', 'api', 'web', 'ApiExceptionHandler.java');
const OUT = join(HERE, 'slice.json');

/** tradegraph.lineage.max-depth; the exposure cap (4) sits under it. Compared with the API's value below. */
const LINEAGE_DEPTH = 5;
const EXTRA_ISSUERS = 12;
const FAMILY_TICKERS = ['BLK', 'IVZ', 'TROW', 'BEN', 'STT', 'AMP', 'TPG'];
const ISSUER_TICKERS = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'JPM', 'XOM', 'JNJ', 'WMT', 'PG', 'UNH', 'NU',
];
/** The templates the page shows: the prefixes every query gets and the exposure question. */
const QUERY_NAMES = ['prefixes', 'exposure'];

const ISSUER = 1;
const FUND = 2;

const sha256Of = (bytes) => createHash('sha256').update(bytes).digest('hex');

const raw = readFileSync(SOURCE);
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const sha256 = sha256Of(raw);
if (sha256 !== manifest.sha256) {
  throw new Error(`slice.json sha256 ${sha256} does not match the manifest ${manifest.sha256}`);
}
const slice = JSON.parse(raw.toString('utf8'));
const commit = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

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

function idByName(name) {
  const row = entities.find((r) => r[1] === name && r[5] < 0);
  if (!row) throw new Error(`README.md names ${name}, which is not a top-level entity in the slice`);
  return row[0];
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

/* ------------------------------------------------------------ provenance */

const queries = Object.fromEntries(QUERY_NAMES.map((name) => {
  const bytes = readFileSync(join(QUERIES, `${name}.rq`));
  return [name, { file: `${name}.rq`, text: bytes.toString('utf8'), sha256: sha256Of(bytes) }];
}));

const summary = JSON.parse(readFileSync(SUMMARY, 'utf8'));

const readmeText = readFileSync(README, 'utf8');
function must(pattern, text, what) {
  const match = pattern.exec(text);
  if (!match) throw new Error(`README.md: ${what} not found`);
  return match;
}
const dollars = (text) => Number(text.replace(/,/g, ''));
const capturedAt = must(/captured at commit ([0-9a-f]{7,40})/, readmeText, 'the commit the demo block was captured at')[1];
const block = must(/`make demo` output, unedited[\s\S]*?\n```\n([\s\S]*?)\n```/, readmeText, 'the make demo block')[1];
const blockLines = block.split('\n');

const pairs = [];
for (let i = 0; i + 1 < blockLines.length; i += 1) {
  const head = /^  (\S.*?) -> (.+)$/.exec(blockLines[i]);
  const total = /^    total \$([\d,]+) /.exec(blockLines[i + 1]);
  if (!head || !total) continue;
  pairs.push({
    fund: idByName(head[1]),
    fundName: head[1],
    issuer: idByName(head[2]),
    issuerName: head[2],
    total: dollars(total[1]),
    line: blockLines[i + 1].trim(),
  });
}
const viaSubsidiary = must(
  /^  exposure through an issuer subsidiary: (.+?) -> (.+)\n(    \$([\d,]+) of total \$([\d,]+) is issued by (.+?), (\d+) hops.*)$/m,
  block,
  'the pair answered through an issuer subsidiary',
);
pairs.push({
  fund: idByName(viaSubsidiary[1]),
  fundName: viaSubsidiary[1],
  issuer: idByName(viaSubsidiary[2]),
  issuerName: viaSubsidiary[2],
  total: dollars(viaSubsidiary[5]),
  via: { entity: viaSubsidiary[6], value: dollars(viaSubsidiary[4]), hops: Number(viaSubsidiary[7]) },
  line: viaSubsidiary[3].trim(),
});

const lineageRows = [];
for (const match of block.matchAll(/^  (.+?): (\d+) descendants, deepest level (\d+), /gm)) {
  lineageRows.push({
    entity: idByName(match[1]),
    name: match[1],
    descendants: Number(match[2]),
    deepestLevel: Number(match[3]),
    line: match[0].trim().replace(/,$/, ''),
  });
}

const readme = {
  file: 'README.md',
  capturedAt,
  store: must(/^store\s+: (\S+)/m, block, 'the store line')[1],
  pairs,
  lineage: lineageRows,
  quality: must(/^  data quality\s+: (.+)$/m, block, 'the data quality line')[1],
  costGuard: must(/^  cost guard\s+: (.+)$/m, block, 'the cost guard line')[1],
};

// The README block is written from demo-summary.json (README.md, "make demo output"),
// so the two have to agree before either is carried over.
if (capturedAt !== summary.provenance.commit) {
  throw new Error(`README block captured at ${capturedAt}, demo-summary.json at ${summary.provenance.commit}`);
}
for (const top of summary.topPairs) {
  const pair = pairs.find((p) => p.fundName === top.fund && p.issuerName === top.issuer);
  if (!pair || pair.total !== Math.round(top.totalValue)) {
    throw new Error(`demo-summary.json pair ${top.fund} -> ${top.issuer} (${top.totalValue}) is not the README block's`);
  }
}
if (readme.store !== summary.store) {
  throw new Error(`README block store ${readme.store}, demo-summary.json store ${summary.store}`);
}

/*
 * The data quality and cost guard lines. demo-summary.json records neither: scripts/demo_queries.py
 * prints the first from /ops/overview, which serves the report `tradegraph-etl validate` wrote
 * to etl/build/quality.json earlier in scripts/demo.sh, and the second from the status the API
 * answers to one request. That report and the run's console output are gitignored (etl/build/,
 * demo-output/), so no committed file holds the values of the run the block records. What
 * is checked instead:
 *   - each line has exactly the shape scripts/demo_queries.py prints;
 *   - conforms agrees with the four counts, as QualityReport.conforms defines it in
 *     etl/src/tradegraph_etl/quality.py (true only when all four are zero);
 *   - the counts equal etl/build/quality.json in the checkout, which `make etl-validate`
 *     writes from the committed sample, and that report covers the entity and position
 *     counts demo-summary.json records;
 *   - the check time falls before demo-summary.json's measuredAt and within the hour before
 *     it: scripts/demo.sh runs the validation, then starts the API, then the queries, in one
 *     run;
 *   - the depth is the one cost_guard() in scripts/demo_queries.py sends to the lineage
 *     endpoint, it is above tradegraph.lineage.max-depth for the fuseki profile demo.sh starts
 *     the API with, and the status is the one ApiExceptionHandler answers QueryCostException
 *     with.
 * Not checked, because nothing committed records it: the check time itself (a fresh report
 * stamps its own), and that the recorded run received that status, as opposed to the code at
 * the checkout answering it; the path from the lineage request to QueryGuard.depth is not
 * re-read either.
 */
const quality = /^conforms=(true|false), dangling (\d+), cycles (\d+), missing identifiers (\d+), shape violations (\d+) \(checked (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\)$/.exec(readme.quality);
if (!quality) throw new Error(`README block data quality line is not in the shape demo_queries.py prints: ${readme.quality}`);
const qualityCounts = {
  danglingReferences: Number(quality[2]),
  subsidiaryCycles: Number(quality[3]),
  missingIdentifiers: Number(quality[4]),
  shaclViolations: Number(quality[5]),
};
const conforms = quality[1] === 'true';
if (conforms !== Object.values(qualityCounts).every((count) => count === 0)) {
  throw new Error(`README block data quality line says conforms=${quality[1]} with counts ${Object.values(qualityCounts).join(', ')}`);
}
if (!existsSync(QUALITY_REPORT)) {
  throw new Error(`${QUALITY_REPORT} not found: run \`make etl-validate\` in the checkout first`);
}
const report = JSON.parse(readFileSync(QUALITY_REPORT, 'utf8'));
for (const [key, count] of Object.entries({ conforms, ...qualityCounts })) {
  if (report[key] !== count) {
    throw new Error(`README block data quality ${key} ${count}, etl/build/quality.json ${report[key]}`);
  }
}
if (report.entities !== summary.dataset.entities || report.positions !== summary.dataset.positions) {
  throw new Error(`etl/build/quality.json covers ${report.entities} entities and ${report.positions} positions, `
    + `demo-summary.json ${summary.dataset.entities} and ${summary.dataset.positions}`);
}
const checkedMs = Date.parse(quality[6]);
const measuredMs = Date.parse(summary.provenance.measuredAt);
if (!(checkedMs < measuredMs && measuredMs - checkedMs <= 3600 * 1000)) {
  throw new Error(`README block quality check at ${quality[6]} is not within the hour before demo-summary.json's measuredAt ${summary.provenance.measuredAt}`);
}

const costGuard = /^depth=(\d+) answered (\d{3})$/.exec(readme.costGuard);
if (!costGuard) throw new Error(`README block cost guard line is not in the shape demo_queries.py prints: ${readme.costGuard}`);
const guardFunction = /^def cost_guard\(\)[\s\S]*?\n(?=\S)/m.exec(readFileSync(DEMO_QUERIES, 'utf8'))?.[0] ?? '';
const guardDepth = Number(/^ {4}depth = (\d+)$/m.exec(guardFunction)?.[1]);
if (!Number.isInteger(guardDepth) || !/\/lineage\?depth=\{depth\}/.test(guardFunction)) {
  throw new Error('scripts/demo_queries.py: cost_guard() no longer sends one fixed depth to the lineage endpoint');
}
const lineageMaxDepth = (file) => /^ {2}lineage:\n {4}max-depth: (\d+)$/m.exec(readFileSync(join(API_RESOURCES, file), 'utf8'))?.[1];
const maxDepth = Number(lineageMaxDepth('application-fuseki.yml') ?? lineageMaxDepth('application.yml'));
if (!Number.isInteger(maxDepth)) throw new Error('api/src/main/resources: tradegraph.lineage.max-depth not found');
if (maxDepth !== LINEAGE_DEPTH) {
  throw new Error(`the slice keeps subsidiary trees to LINEAGE_DEPTH ${LINEAGE_DEPTH}, but tradegraph.lineage.max-depth is ${maxDepth}`);
}
// An HttpStatus constant is its reason phrase in upper snake case, so its code is looked up by
// phrase in node:http rather than in a list of the statuses the handler uses today.
const statusName = /@ExceptionHandler\(QueryCostException\.class\)[\s\S]*?HttpStatus\.([A-Z_]+)/.exec(readFileSync(EXCEPTION_HANDLER, 'utf8'))?.[1];
const status = Number(Object.keys(STATUS_CODES).find((code) => STATUS_CODES[code].toUpperCase().replace(/[^A-Z0-9]+/g, '_') === statusName));
if (!Number.isInteger(status)) {
  throw new Error(`ApiExceptionHandler.java: HttpStatus.${statusName} of the QueryCostException handler has no status code in node:http`);
}
if (Number(costGuard[1]) !== guardDepth) {
  throw new Error(`README block cost guard depth ${costGuard[1]}, scripts/demo_queries.py asks for ${guardDepth}`);
}
if (!(guardDepth > maxDepth)) {
  throw new Error(`cost guard depth ${guardDepth} is not above tradegraph.lineage.max-depth ${maxDepth}`);
}
if (Number(costGuard[2]) !== status) {
  throw new Error(`README block cost guard status ${costGuard[2]}, ApiExceptionHandler answers ${status} (HttpStatus.${statusName})`);
}

const out = {
  source: {
    repository: 'SAY-5/tradegraph',
    commit,
    file: 'web/src/data/slice.json',
    sha256,
    bytes: raw.length,
    families: FAMILY_TICKERS,
    issuers: ISSUER_TICKERS,
    extraIssuers: EXTRA_ISSUERS,
    lineageDepth: LINEAGE_DEPTH,
    manifest: {
      file: 'web/src/data/slice-manifest.json',
      counts: {
        entities: manifest.counts.entities,
        positions: manifest.counts.positions,
        filings: manifest.counts.filings,
        lineageEdges: manifest.counts.lineageEdges,
        triples: manifest.counts.triples,
      },
      full: {
        entities: manifest.full.entities,
        positions: manifest.full.positions,
        filings: manifest.full.filings,
        lineageEdges: manifest.full.lineageEdges,
        triples: manifest.full.triples,
        periods: manifest.full.periods,
      },
      periods: manifest.periods,
    },
    queries: { directory: 'api/src/main/resources/queries', files: queries },
    demoSummary: {
      file: 'web/src/data/demo-summary.json',
      generator: summary.generator,
      provenance: {
        measuredAt: summary.provenance.measuredAt,
        commit: summary.provenance.commit,
        host: summary.provenance.host,
      },
      store: summary.store,
      dataset: summary.dataset,
      exposure: summary.exposure,
      topPairs: summary.topPairs.map((p) => ({ fund: p.fund, issuer: p.issuer, totalValue: p.totalValue })),
    },
    readme,
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
  `slice.json ${json.length} bytes at ${commit.slice(0, 7)}: ${out.entities.length} entities, ${funds.size} funds in `
  + `${families.length} families, ${issuers.length + extras.length} issuers with `
  + `${issuingEntities.size - issuers.length - extras.length} subsidiaries, `
  + `${out.instruments.length} instruments, ${out.positions.length} positions over ${periods.join(' and ')}; `
  + `README block at ${capturedAt}: ${pairs.length} pairs, ${lineageRows.length} lineage rows; `
  + `data quality counts equal etl/build/quality.json, cost guard depth ${guardDepth} is above `
  + `lineage max-depth ${maxDepth} and answers ${status}\n`,
);
