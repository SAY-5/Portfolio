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
  type ExposureLine,
  type Hop,
  type LineageNode,
  type SliceData,
} from './tradegraph/graph';

// Real mechanism from tradegraph: SEC holdings, subsidiary lists and fund family
// links are loaded as RDF, and exposure is one aggregate query. It finds the
// fund's ultimate parent with a bounded subsidiaryOf path and a FILTER NOT EXISTS
// on the root, takes every fund in that family as a holder, takes the issuer and
// its subsidiaries within the depth budget as issuing entities, and groups the
// positions of the latest reporting period by holder, issuing entity and
// instrument. Each line lands on one leg (a line that is both affiliate and
// subsidiary counts once, on the affiliate leg), keeps its lineage path and
// explanation sentence, and can be weighted by the ownership along that path.
// The query code is a port of the repository's in-browser layer; it runs over a
// small cut of the committed sample that loads as its own chunk.

const PRESETS = [
  { label: 'T. Rowe Price to Apple', fund: '0001113169', issuer: '0000320193', readme: 2_475_300_433 },
  { label: 'BlackRock to Meta', fund: '0002012383', issuer: '0001326801', readme: 1_980_265_856 },
  { label: 'Invesco to Apple', fund: '0000914208', issuer: '0000320193', readme: 1_523_775_489 },
  { label: 'TPG to Nu Holdings', fund: '0001880661', issuer: '0001691493', readme: 4_792_566 },
];

const HOP_LABEL: Record<Exclude<Hop, 'start'>, string> = {
  parent: 'is a subsidiary of',
  subsidiary: 'whose subsidiary',
  holds: 'holds',
};

const ease = [0.22, 1, 0.36, 1] as const;
const USD = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function money(value: number): string {
  return `$${USD.format(Math.round(value))}`;
}

function instrumentLabel(line: ExposureLine): string {
  const { instrumentClass, ticker } = line.instrument;
  return ticker ? `${instrumentClass} ${ticker}` : instrumentClass;
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
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
  const [lineIndex, setLineIndex] = useState<number | null>(null);

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

  const options = { includeAffiliates, includeSubsidiaries, depth };
  const answer = useMemo(
    () => (store ? exposure(store, fund, issuer, { includeAffiliates, includeSubsidiaries, depth }) : null),
    [store, fund, issuer, includeAffiliates, includeSubsidiaries, depth],
  );
  const weighted = useMemo(
    () => (store ? exposure(store, fund, issuer, { includeAffiliates, includeSubsidiaries, depth, weighted: true }) : null),
    [store, fund, issuer, includeAffiliates, includeSubsidiaries, depth],
  );
  const tree = useMemo(() => (store ? lineage(store, issuer, lineageDepth) : null), [store, issuer, lineageDepth]);

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
  }

  const preset = PRESETS.find((p) => p.fund === fund && p.issuer === issuer);
  const defaults = includeAffiliates && includeSubsidiaries && depth === EXPOSURE_MAX_DEPTH;

  return (
    <div className="demo" aria-label="tradegraph exposure demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Fund family exposure through subsidiaries and affiliates</h3>
      <p className="demo__lede">
        An exposure answer starts at the fund&apos;s ultimate parent, takes every fund in that family as a
        holder, takes the issuer and its subsidiaries as issuing entities, and groups the positions of the
        latest reporting period. The total splits into direct, through issuer subsidiaries and through
        affiliates, every line keeps the lineage path that produced it, and the four README pairs reproduce
        to the dollar: $2,475,300,433, $1,980,265,856, $1,523,775,489 and $4,792,566.
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

      {!store || !answer || !weighted || !tree ? (
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
              <Stepper
                label="exposure depth"
                cap={EXPOSURE_MAX_DEPTH}
                value={depth}
                onChange={(d) => {
                  setDepth(d);
                  setLineIndex(null);
                }}
              />
              <Stepper label="lineage depth" cap={MAX_DEPTH} value={lineageDepth} onChange={setLineageDepth} />
            </div>
          </div>

          <div className="tg__panel">
            <div className="tg__panel-head">
              <span className="tg__panel-title">exposure</span>
              <span className="tg__panel-meta">as of {answer.asOf ?? 'no period'}</span>
            </div>
            <div className="tg__total" aria-live="polite" data-testid="tg-total">{money(answer.totalValue)}</div>
            <div className="tg__ref" data-match={preset ? defaults && Math.round(answer.totalValue) === preset.readme : false}>
              {preset
                ? defaults
                  ? `README ${money(preset.readme)}, ${Math.round(answer.totalValue) === preset.readme ? 'matches' : 'differs'}`
                  : `README ${money(preset.readme)} with both toggles on at depth ${EXPOSURE_MAX_DEPTH}`
                : 'pair outside the README block'}
            </div>
            <div className="tg__legs">
              <Leg label="direct" leg="direct" value={answer.directValue} total={answer.totalValue} />
              <Leg label="through subsidiaries" leg="subsidiaries" value={answer.viaSubsidiariesValue} total={answer.totalValue} />
              <Leg label="through affiliates" leg="affiliates" value={answer.viaAffiliatesValue} total={answer.totalValue} />
            </div>
            <div className="tg__weighted">
              <span>ownership weighted</span>
              <span className="tg__weighted-val" data-testid="tg-weighted">{money(weighted.totalValue)}</span>
            </div>
            <div className="tg__facts mono">
              <span className="tg__fact">{answer.positions} positions</span>
              <span className="tg__fact">{answer.byInstrument.length} instrument lines</span>
              <span className="tg__fact">{answer.byHolder.length} holders</span>
              <span className="tg__fact">longest path {answer.longestPath} hops</span>
            </div>
          </div>

          <PathPanel
            lines={answer.byInstrument}
            focused={lineIndex !== null && answer.byInstrument[lineIndex] ? answer.byInstrument[lineIndex] : longestLine(answer)}
            focusedIndex={lineIndex}
            onFocus={setLineIndex}
            reduce={reduce === true}
            pathKey={`${fund} ${issuer} ${JSON.stringify(options)} ${lineIndex}`}
          />

          <div className="tg__panel tg__panel--wide">
            <div className="tg__panel-head">
              <span className="tg__panel-title">issuer lineage</span>
              <span className="tg__panel-meta">
                {tree.descendantCount} subsidiaries within {tree.maxDepth} levels, deepest {tree.deepestLevel}
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
          {store
            ? `${store.entities.size} entities, ${store.positions.length} positions, periods ${[...new Set(store.positions.map((p) => p.asOf))].sort().reverse().join(' and ')}`
            : 'exposure depth at most 4, lineage depth at most 5'}
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
}: {
  label: string;
  cap: number;
  value: number;
  onChange: (value: number) => void;
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
  lines,
  focused,
  focusedIndex,
  onFocus,
  reduce,
  pathKey,
}: {
  lines: ExposureLine[];
  focused: ExposureLine | null;
  focusedIndex: number | null;
  onFocus: (index: number) => void;
  reduce: boolean;
  pathKey: string;
}) {
  const shown = focused ? lines.indexOf(focused) : -1;
  return (
    <div className="tg__panel">
      <div className="tg__panel-head">
        <span className="tg__panel-title">{focusedIndex === null ? 'longest path' : 'selected path'}</span>
        <span className="tg__panel-meta">{focused ? `${focused.pathLength} hops` : 'no path'}</span>
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
                  {instrumentLabel(line)} issued by {line.issuerEntity.name}, {line.pathLength} hops,{' '}
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
