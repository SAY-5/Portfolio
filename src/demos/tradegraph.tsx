import { useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './tradegraph.css';
import {
  EXPOSURE_MAX_DEPTH,
  MAX_DEPTH,
  Store,
  descendantIds,
  exposure,
  lineage,
  longestLine,
  ownershipSteps,
  periods,
  type ExposureLine,
  type Hop,
  type LineageNode,
  type SliceData,
  type SliceSource,
} from './tradegraph/graph';
import { renderExposure } from './tradegraph/sparql';

// Real mechanism from tradegraph: SEC identities, the sample's subsidiary lists,
// holdings and fund family links are loaded as RDF, and exposure is one aggregate
// query (exposure.rq). It finds the fund's ultimate parent with a bounded
// subsidiaryOf path and a FILTER NOT EXISTS on the root, takes every fund in that
// family as a holder, takes the issuer and its subsidiaries within the depth budget
// as issuing entities, and groups the positions of one reporting period (the latest
// on or before as_of) by holder, issuing entity and instrument. Each line lands on
// one leg (a line that is both affiliate and subsidiary counts once, on the
// affiliate leg), keeps its lineage path and explanation sentence, and can be
// weighted by the ownership along that path. The query code is a port of the
// repository's in-browser layer; it runs over a small cut of the committed sample
// that loads as its own chunk.
//
// What the page shows and where it comes from: every count and total is computed
// here over the cut. The reference totals, lineage counts, data quality line and
// cost guard line are the README's make demo block, parsed by extract-slice.mjs
// and labelled with the commit and store of that run. The SPARQL is the API's own
// template, byte for byte, filled with the API's clause builders. No latency is
// quoted: the README times an API against a store and this page times function
// calls.

const PRESETS = [
  { label: 'T. Rowe Price to Apple', fund: '0001113169', issuer: '0000320193' },
  { label: 'BlackRock to Meta', fund: '0002012383', issuer: '0001326801' },
  { label: 'Invesco to Apple', fund: '0000914208', issuer: '0000320193' },
  { label: 'TPG to Nu Holdings', fund: '0001880661', issuer: '0001691493' },
];

const HOP_LABEL: Record<Exclude<Hop, 'start'>, string> = {
  parent: 'is a subsidiary of',
  subsidiary: 'whose subsidiary',
  holds: 'holds',
};

const ease = [0.22, 1, 0.36, 1] as const;
const USD = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat('en-US');
const DATE = /(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?)/g;

function money(value: number): string {
  return `$${USD.format(Math.round(value))}`;
}

function signed(value: number): string {
  return `${value < 0 ? '-' : '+'}${money(Math.abs(value))}`;
}

function count(value: number): string {
  return NUM.format(value);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${count(n)} ${n === 1 ? one : many}`;
}

function short(commit: string): string {
  return commit.slice(0, 7);
}

function instrumentLabel(line: ExposureLine): string {
  const { instrumentClass, ticker } = line.instrument;
  return ticker ? `${instrumentClass} ${ticker}` : instrumentClass;
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}

/** QueryGuard.depth's message; ApiExceptionHandler returns it as the detail of a 422 problem detail. */
function refusalDetail(what: string, requested: number, max: number): string {
  return `${what} depth ${requested} is above the configured maximum of ${max}`;
}

/** Dates and timestamps kept on one line, so a narrow column never splits 2024-06-30. */
function Dates({ text }: { text: string }) {
  return (
    <>
      {text.split(DATE).map((part, i) => (i % 2 === 1 ? <span key={i} className="tg__nowrap">{part}</span> : part))}
    </>
  );
}

interface Refusal {
  what: 'exposure' | 'lineage';
  requested: number;
  max: number;
}

export default function TradegraphDemo() {
  const reduce = useReducedMotion();
  const [store, setStore] = useState<Store | null>(null);
  const [failed, setFailed] = useState(false);
  const [fund, setFund] = useState(PRESETS[0].fund);
  const [issuer, setIssuer] = useState(PRESETS[0].issuer);
  const [includeAffiliates, setIncludeAffiliates] = useState(true);
  const [includeSubsidiaries, setIncludeSubsidiaries] = useState(true);
  const [depth, setDepth] = useState(EXPOSURE_MAX_DEPTH);
  const [lineageDepth, setLineageDepth] = useState(MAX_DEPTH);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [refused, setRefused] = useState<Refusal | null>(null);
  const [lineIndex, setLineIndex] = useState<number | null>(null);
  const [sparqlView, setSparqlView] = useState<'rendered' | 'template'>('rendered');

  useEffect(() => {
    let live = true;
    import('./tradegraph/slice.json?raw')
      .then((mod) => {
        if (live) setStore(new Store(JSON.parse(mod.default) as SliceData));
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const pickers = useMemo(() => {
    if (!store) return { families: [], issuers: [] };
    const all = [...store.entities.values()].filter((e) => e.parent === null);
    const tree = (id: string) => [id, ...descendantIds(store, id, MAX_DEPTH)];
    const families = all
      .filter((e) => e.kinds.includes('Fund') && tree(e.id).some((id) => store.heldBy.has(id)))
      .sort((a, b) => a.name.localeCompare(b.name));
    const held = (id: string) => tree(id)
      .reduce((sum, member) => sum + (store.issuedBy.get(member) ?? []).reduce((s, p) => s + p.value, 0), 0);
    const issuers = all
      .filter((e) => e.kinds.includes('Issuer') && held(e.id) > 0)
      .map((e) => ({ entity: e, value: held(e.id) }))
      .sort((a, b) => (b.value - a.value) || a.entity.name.localeCompare(b.entity.name))
      .map(({ entity }) => entity);
    return { families, issuers };
  }, [store]);

  const options = { includeAffiliates, includeSubsidiaries, depth, asOf };
  const answer = useMemo(
    () => (store ? exposure(store, fund, issuer, { includeAffiliates, includeSubsidiaries, depth, asOf }) : null),
    [store, fund, issuer, includeAffiliates, includeSubsidiaries, depth, asOf],
  );
  const weighted = useMemo(
    () => (store
      ? exposure(store, fund, issuer, { includeAffiliates, includeSubsidiaries, depth, asOf, weighted: true })
      : null),
    [store, fund, issuer, includeAffiliates, includeSubsidiaries, depth, asOf],
  );
  const allPeriods = useMemo(() => (store ? periods(store) : []), [store]);
  const otherPeriod = answer ? allPeriods.find((p) => p !== answer.asOf) ?? null : null;
  const other = useMemo(
    () => (store && otherPeriod
      ? exposure(store, fund, issuer, { includeAffiliates, includeSubsidiaries, depth, asOf: otherPeriod })
      : null),
    [store, fund, issuer, includeAffiliates, includeSubsidiaries, depth, otherPeriod],
  );
  const tree = useMemo(() => (store ? lineage(store, issuer, lineageDepth) : null), [store, issuer, lineageDepth]);
  const sparql = useMemo(
    () => (store && answer
      ? renderExposure(
        { prefixes: store.source.queries.files.prefixes.text, exposure: store.source.queries.files.exposure.text },
        fund, issuer, includeAffiliates, includeSubsidiaries, depth, answer.asOf,
      )
      : ''),
    [store, answer, fund, issuer, includeAffiliates, includeSubsidiaries, depth],
  );

  function pick(nextFund: string, nextIssuer: string) {
    setFund(nextFund);
    setIssuer(nextIssuer);
    setLineIndex(null);
  }
  function reset() {
    pick(PRESETS[0].fund, PRESETS[0].issuer);
    setIncludeAffiliates(true);
    setIncludeSubsidiaries(true);
    setDepth(EXPOSURE_MAX_DEPTH);
    setLineageDepth(MAX_DEPTH);
    setAsOf(null);
    setRefused(null);
    setSparqlView('rendered');
  }

  const source: SliceSource | null = store ? store.source : null;
  const preset = PRESETS.find((p) => p.fund === fund && p.issuer === issuer);
  const reference = source ? source.readme.pairs.find((p) => p.fund === fund && p.issuer === issuer) ?? null : null;
  const latest = allPeriods[0] ?? null;
  const defaults = includeAffiliates && includeSubsidiaries && depth === EXPOSURE_MAX_DEPTH;
  const comparable = defaults && answer !== null && answer.asOf === latest;
  const matches = reference !== null && comparable && answer !== null && Math.round(answer.totalValue) === reference.total;
  const readmeLineage = source && tree && lineageDepth === MAX_DEPTH
    ? source.readme.lineage.find((l) => l.entity === issuer) ?? null
    : null;
  const readmeList = source
    ? source.readme.pairs.map((p) => money(p.total)).reduce((text, item, i, list) => (
      i === 0 ? item : `${text}${i === list.length - 1 ? ' and ' : ', '}${item}`
    ), '')
    : '';

  return (
    <div className="demo" aria-label="tradegraph exposure demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Fund family exposure through subsidiaries and affiliates</h3>
      <p className="demo__lede">
        An exposure answer starts at the fund&apos;s ultimate parent, takes every fund in that family as a
        holder, takes the issuer and its subsidiaries as issuing entities, and groups the positions of one
        reporting period. The total splits into direct, through issuer subsidiaries and through affiliates,
        every line keeps the lineage path that produced it, and the four pairs of the README&apos;s make demo
        block reproduce to the dollar{source ? `: ${readmeList}` : ''}. Issuer and fund manager identities in
        the sample are real (SEC company_tickers.json); holdings, subsidiaries and values are synthetic and
        deterministic, from etl/sample, and are not market data.
      </p>
      <p className="tg__source">
        {store && source ? (
          <>
            {`Counted in this page: ${count(store.entities.size)} entities and ${count(store.positions.length)} positions `}
            {`over both reporting periods, cut by extract-slice.mjs from the repository's browser slice, itself `}
            {`${count(source.manifest.counts.entities)} of ${count(source.manifest.full.entities)} entities and `}
            {`${count(source.manifest.counts.positions)} of ${count(source.manifest.full.positions)} positions in the full sample `}
            {`(${source.manifest.file} at commit ${short(source.commit)}). Reference totals are the README's make demo block, `}
            {`captured at commit ${source.readme.capturedAt} on ${source.readme.store} and written from ${source.demoSummary.file} `}
            {`(${source.demoSummary.provenance.host}, `}
            <Dates text={source.demoSummary.provenance.measuredAt} />
            ).
          </>
        ) : (
          'The cut of the committed sample loads as its own chunk; every count on this page is computed from it.'
        )}
      </p>

      <div className="tg__presets" role="group" aria-label="README exposure pairs">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="tg__preset"
            aria-pressed={p === preset}
            onClick={() => pick(p.fund, p.issuer)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {!store || !source || !answer || !weighted || !tree ? (
        <div className="tg__panel tg__loading mono" role="status" aria-live="polite">
          {failed ? 'The graph slice did not load.' : 'Loading the graph slice'}
        </div>
      ) : (
        <div className="tg__stage">
          <div className="tg__panel tg__panel--wide">
            <div className="tg__controls">
              <label className="tg__field">
                <span className="tg__label">fund family</span>
                <select className="tg__select" value={fund} onChange={(e) => pick(e.target.value, issuer)}>
                  {pickers.families.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </label>
              <label className="tg__field">
                <span className="tg__label">issuer</span>
                <select className="tg__select" value={issuer} onChange={(e) => pick(fund, e.target.value)}>
                  {pickers.issuers.map((e) => (
                    <option key={e.id} value={e.id}>{e.ticker ? `${e.name} (${e.ticker})` : e.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="tg__switches">
              <label className="tg__switch">
                <input
                  type="checkbox"
                  checked={includeAffiliates}
                  onChange={(e) => {
                    setIncludeAffiliates(e.target.checked);
                    setLineIndex(null);
                  }}
                />
                affiliates in the family
              </label>
              <label className="tg__switch">
                <input
                  type="checkbox"
                  checked={includeSubsidiaries}
                  onChange={(e) => {
                    setIncludeSubsidiaries(e.target.checked);
                    setLineIndex(null);
                  }}
                />
                issuer subsidiaries
              </label>
              <div className="tg__stepper">
                <span className="tg__label">as of, reporting period</span>
                <div className="tg__seg" role="group" aria-label="reporting period">
                  {allPeriods.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className="tg__seg-btn"
                      aria-pressed={answer.asOf === p}
                      onClick={() => {
                        setAsOf(p);
                        setLineIndex(null);
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <Stepper
                label="exposure depth"
                cap={EXPOSURE_MAX_DEPTH}
                value={depth}
                onChange={(d) => {
                  setDepth(d);
                  setRefused(null);
                  setLineIndex(null);
                }}
                onRefuse={(d) => setRefused({ what: 'exposure', requested: d, max: EXPOSURE_MAX_DEPTH })}
              />
              <Stepper
                label="lineage depth"
                cap={MAX_DEPTH}
                value={lineageDepth}
                onChange={(d) => {
                  setLineageDepth(d);
                  setRefused(null);
                }}
                onRefuse={(d) => setRefused({ what: 'lineage', requested: d, max: MAX_DEPTH })}
              />
            </div>
            {refused && (
              <p className="tg__refusal mono" role="status" data-testid="tg-refusal">
                {`The API answers 422 with the detail "${refusalDetail(refused.what, refused.requested, refused.max)}" `}
                {`(QueryGuard.depth, returned by ApiExceptionHandler as an RFC 9457 problem detail). `}
                {`This page keeps ${refused.what} depth at ${refused.max}.`}
              </p>
            )}
          </div>

          <div className="tg__panel">
            <div className="tg__panel-head">
              <span className="tg__panel-title">exposure</span>
              <span className="tg__panel-meta">
                as of <span className="tg__nowrap">{answer.asOf ?? 'no period'}</span>, computed in this page
              </span>
            </div>
            <div className="tg__total" aria-live="polite" data-testid="tg-total">{money(answer.totalValue)}</div>
            <div className="tg__ref" data-match={matches} data-testid="tg-ref">
              {reference
                ? comparable
                  ? `README block at ${source.readme.capturedAt} on ${source.readme.store}: ${money(reference.total)}, ${matches ? 'matches' : 'differs'}`
                  : `README block at ${source.readme.capturedAt}: ${money(reference.total)} as of ${latest} with both toggles on at depth ${EXPOSURE_MAX_DEPTH}`
                : 'pair outside the README block'}
            </div>
            {other && otherPeriod && (
              <div className="tg__quarters mono" data-testid="tg-quarters">
                {(() => {
                  const [early, late] = answer.asOf !== null && answer.asOf < otherPeriod
                    ? [answer, other]
                    : [other, answer];
                  return (
                    <>
                      <span className="tg__nowrap">{early.asOf}</span> {money(early.totalValue)}, <span className="tg__nowrap">{late.asOf}</span> {money(late.totalValue)},
                      {' '}change {signed(late.totalValue - early.totalValue)}, computed in this page
                    </>
                  );
                })()}
              </div>
            )}
            <div className="tg__legs">
              <Leg label="direct" leg="direct" value={answer.directValue} total={answer.totalValue} />
              <Leg label="through subsidiaries" leg="subsidiaries" value={answer.viaSubsidiariesValue} total={answer.totalValue} />
              <Leg label="through affiliates" leg="affiliates" value={answer.viaAffiliatesValue} total={answer.totalValue} />
            </div>
            <div className="tg__weighted">
              <span>ownership weighted</span>
              <span className="tg__weighted-val" data-testid="tg-weighted">{money(weighted.totalValue)}</span>
            </div>
            <div className="tg__facts mono" data-testid="tg-facts">
              <span className="tg__fact">{plural(answer.positions, 'position')}</span>
              <span className="tg__fact">{plural(answer.byInstrument.length, 'instrument line')}</span>
              <span className="tg__fact">{plural(answer.byHolder.length, 'holder')}</span>
              <span className="tg__fact">longest path {plural(answer.longestPath, 'hop')}</span>
            </div>
          </div>

          <PathPanel
            store={store}
            lines={answer.byInstrument}
            focused={lineIndex !== null && answer.byInstrument[lineIndex] ? answer.byInstrument[lineIndex] : longestLine(answer)}
            focusedIndex={lineIndex}
            onFocus={setLineIndex}
            reduce={reduce === true}
            pathKey={`${fund} ${issuer} ${JSON.stringify(options)} ${lineIndex}`}
          />

          <div className="tg__panel tg__panel--wide">
            <div className="tg__panel-head">
              <span className="tg__panel-title">sparql the api renders</span>
              <span className="tg__panel-meta">
                {source.queries.files.exposure.file} at commit {short(source.commit)}, sha256 {source.queries.files.exposure.sha256.slice(0, 12)}
              </span>
            </div>
            <div className="tg__seg" role="group" aria-label="query text">
              <button
                type="button"
                className="tg__seg-btn"
                aria-pressed={sparqlView === 'rendered'}
                onClick={() => setSparqlView('rendered')}
              >
                rendered for this answer
              </button>
              <button
                type="button"
                className="tg__seg-btn"
                aria-pressed={sparqlView === 'template'}
                onClick={() => setSparqlView('template')}
              >
                template, byte for byte
              </button>
            </div>
            <pre className="tg__sparql" data-testid="tg-sparql" data-view={sparqlView}>
              {sparqlView === 'rendered' ? sparql : source.queries.files.exposure.text}
            </pre>
            <p className="tg__fine">
              {`${source.queries.directory}/${source.queries.files.exposure.file} is the template QueryTemplates.render fills, `}
              {`with ${source.queries.files.prefixes.file} prepended; the rendered text substitutes the fund, the issuer, the depth and `}
              {`the reporting period the way ExposureService.holderClause, issuerClause and SparqlValues do `}
              {`(a port of the repository's web/src/graph/sparql.ts). In the repository, etl/ (Python) writes entities.nt, `}
              {`positions.nt and ontology.nt and loads them over the Graph Store Protocol into Apache Jena Fuseki or Stardog, `}
              {`and api/ (Spring Boot) sends this query over the SPARQL 1.1 Protocol. This page does not evaluate SPARQL: `}
              {`graph.ts walks the same hops in TypeScript over the cut.`}
            </p>
          </div>

          <div className="tg__panel tg__panel--wide">
            <div className="tg__panel-head">
              <span className="tg__panel-title">issuer lineage</span>
              <span className="tg__panel-meta" data-testid="tg-lineage-meta">
                {`${plural(tree.descendantCount, 'subsidiary', 'subsidiaries')} within ${tree.maxDepth} levels, deepest ${tree.deepestLevel}, computed in this page`}
                {readmeLineage
                  ? `; README block at ${source.readme.capturedAt}: ${readmeLineage.descendants} descendants, deepest level ${readmeLineage.deepestLevel}, ${
                    readmeLineage.descendants === tree.descendantCount && readmeLineage.deepestLevel === tree.deepestLevel ? 'matches' : 'differs'
                  }`
                  : ''}
              </span>
            </div>
            <ul className="tg__tree">
              <TreeNode
                node={tree.descendants}
                hot={new Set(answer.byInstrument.map((l) => l.issuerEntity.id))}
                reach={includeSubsidiaries ? answer.maxDepth : 0}
              />
            </ul>
          </div>
        </div>
      )}

      <div className="demo__controls">
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">
          {source ? (
            <Dates
              text={`README block at ${source.readme.capturedAt} on ${source.readme.store}: data quality ${source.readme.quality}; cost guard ${source.readme.costGuard}`}
            />
          ) : (
            'exposure depth at most 4, lineage depth at most 5'
          )}
        </span>
      </div>
    </div>
  );
}

function Stepper({
  label,
  cap,
  value,
  onChange,
  onRefuse,
}: {
  label: string;
  cap: number;
  value: number;
  onChange: (value: number) => void;
  onRefuse: (value: number) => void;
}) {
  return (
    <div className="tg__stepper">
      <span className="tg__label">
        {label}, at most {cap}
      </span>
      <div className="tg__seg" role="group" aria-label={label}>
        {range(cap).map((d) => (
          <button key={d} type="button" className="tg__seg-btn" aria-pressed={value === d} onClick={() => onChange(d)}>
            {d}
          </button>
        ))}
        <button
          type="button"
          className="tg__seg-btn"
          data-refused="true"
          aria-pressed={false}
          aria-label={`${label} ${cap + 1}, refused by the API`}
          onClick={() => onRefuse(cap + 1)}
        >
          {cap + 1}
        </button>
      </div>
    </div>
  );
}

function Leg({ label, leg, value, total }: { label: string; leg: string; value: number; total: number }) {
  return (
    <div>
      <div className="tg__leg-head">
        <span>{label}</span>
        <span className="tg__leg-val">{money(value)}</span>
      </div>
      <div className="tg__track">
        <div className="tg__fill" data-leg={leg} style={{ width: `${total > 0 ? (value / total) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

function PathPanel({
  store,
  lines,
  focused,
  focusedIndex,
  onFocus,
  reduce,
  pathKey,
}: {
  store: Store;
  lines: ExposureLine[];
  focused: ExposureLine | null;
  focusedIndex: number | null;
  onFocus: (index: number) => void;
  reduce: boolean;
  pathKey: string;
}) {
  const shown = focused ? lines.indexOf(focused) : -1;
  const steps = focused ? ownershipSteps(store, focused.lineagePath) : [];
  const weight = steps.reduce((product, step) => product * step.fraction, 1);
  return (
    <div className="tg__panel">
      <div className="tg__panel-head">
        <span className="tg__panel-title">{focusedIndex === null ? 'longest path' : 'selected path'}</span>
        <span className="tg__panel-meta">{focused ? plural(focused.pathLength, 'hop') : 'no path'}</span>
      </div>
      {focused ? (
        <>
          <div className="tg__path" key={pathKey}>
            {focused.lineagePath.map((step, i) => (
              <motion.span
                key={`${step.id}-${i}`}
                className="tg__step"
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: reduce ? 0 : i * 0.1, ease }}
              >
                {step.hop !== 'start' && (
                  <span className="tg__hop">
                    {step.hop === 'holds' ? `holds ${instrumentLabel(focused)}, issued by` : HOP_LABEL[step.hop]}
                  </span>
                )}
                <span className="tg__chip" data-hop={step.hop}>{step.name}</span>
              </motion.span>
            ))}
          </div>
          <p className="tg__sentence" data-testid="tg-sentence">{focused.explanation}</p>
          <p className="tg__own mono" data-testid="tg-ownership">
            {steps.length === 0
              ? 'ownership weight 1.00: no lineage hop on this path'
              : `ownership weight ${weight.toFixed(2)}: ${steps
                .map((s) => `${s.name} ${s.fraction.toFixed(2)}${s.disclosed ? ' disclosed' : ' assumed'}`)
                .join(', ')}`}
          </p>
        </>
      ) : (
        <p className="tg__empty">No position connects this family to this issuer under these options.</p>
      )}
      {lines.length > 0 && (
        <ul className="tg__lines">
          {lines.map((line, i) => (
            <li key={`${line.holder.id} ${line.issuerEntity.id} ${line.instrument.cusip}`}>
              <button type="button" className="tg__line" aria-pressed={i === shown} onClick={() => onFocus(i)}>
                <span className="tg__line-who">{line.holder.name}</span>
                <span className="tg__line-val">{money(line.value)}</span>
                <span className="tg__line-meta">
                  {instrumentLabel(line)} issued by {line.issuerEntity.name}, {plural(line.pathLength, 'hop')},{' '}
                  {line.direct ? 'direct' : line.viaAffiliate ? 'through an affiliate' : 'through a subsidiary'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TreeNode({ node, hot, reach }: { node: LineageNode; hot: Set<string>; reach: number }) {
  const holds = hot.has(node.id);
  const out = node.depth > reach;
  return (
    <li>
      <div className="tg__node" data-root={node.depth === 0} data-hot={holds} data-out={out && !holds}>
        <span className="tg__node-name">{node.name}</span>
        {node.depth > 0 && (
          <span className="tg__node-tag">
            level {node.depth}
            {holds ? ', issues held positions' : out ? ', past the exposure depth' : ''}
          </span>
        )}
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} hot={hot} reach={reach} />
          ))}
        </ul>
      )}
    </li>
  );
}
