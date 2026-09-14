// Port of tradegraph's in-browser query layer (web/src/graph/store.ts and
// web/src/graph/queries.ts), cut down to the two questions this demo asks:
// lineage and exposure. The hops, the depth caps from application.yml, the
// period an answer covers, the leg split and the explanation sentence follow
// the source line for line. The triple materialisation, the ontology and the
// query cache are left out because nothing here reads them.

export type Kind = 'Issuer' | 'Fund' | 'Subsidiary';

/** tradegraph.lineage.max-depth and tradegraph.exposure.max-depth from application.yml. */
export const MAX_DEPTH = 5;
export const EXPOSURE_MAX_DEPTH = 4;

export interface EntityNode {
  id: string;
  name: string;
  kinds: Kind[];
  ticker: string | null;
  parent: string | null;
  /** Fraction of this entity its parent discloses owning; 1 when nothing was disclosed. */
  ownership: number;
}

export interface PositionNode {
  holder: string;
  issuer: string;
  cusip: string;
  quantity: number;
  value: number;
  asOf: string;
}

export interface EntityRef {
  id: string;
  name: string;
  kinds: Kind[];
}

export interface Instrument {
  cusip: string;
  ticker: string | null;
  instrumentClass: string;
}

export type Hop = 'start' | 'parent' | 'subsidiary' | 'holds';

export interface PathStep {
  id: string;
  name: string;
  hop: Hop;
}

export interface ExposureLine {
  instrument: Instrument;
  holder: EntityRef;
  issuerEntity: EntityRef;
  value: number;
  quantity: number;
  positions: number;
  asOf: string;
  direct: boolean;
  viaAffiliate: boolean;
  viaSubsidiary: boolean;
  pathLength: number;
  lineagePath: PathStep[];
  explanation: string;
  weight: number | null;
  weightedValue: number | null;
}

export interface HolderTotal {
  holder: EntityRef;
  value: number;
  positions: number;
}

export interface ExposureResponse {
  fund: EntityRef;
  issuer: EntityRef;
  asOf: string | null;
  totalValue: number;
  directValue: number;
  viaSubsidiariesValue: number;
  viaAffiliatesValue: number;
  positions: number;
  includeAffiliates: boolean;
  includeSubsidiaries: boolean;
  weighted: boolean;
  maxDepth: number;
  longestPath: number;
  byInstrument: ExposureLine[];
  byHolder: HolderTotal[];
  queryMillis: number;
}

export interface ExposureOptions {
  includeAffiliates?: boolean;
  includeSubsidiaries?: boolean;
  weighted?: boolean;
  depth?: number;
  asOf?: string | null;
}

export interface LineageNode {
  id: string;
  name: string;
  kinds: Kind[];
  depth: number;
  children: LineageNode[];
}

export interface LineageResponse {
  entity: EntityRef;
  ancestors: EntityRef[];
  ultimateParent: EntityRef;
  descendants: LineageNode;
  maxDepth: number;
  descendantCount: number;
  deepestLevel: number;
}

/* ------------------------------------------------------------------- slice */

type EntityRow = [string, string, number, string | null, number, number | null];
type InstrumentRow = [string, string, string | null];
type PositionRow = [number, number, number, number, number, number];

export interface SliceData {
  source: Record<string, unknown>;
  periods: string[];
  entities: EntityRow[];
  instruments: InstrumentRow[];
  positions: PositionRow[];
}

const KIND_BITS: ReadonlyArray<[number, Kind]> = [[1, 'Issuer'], [2, 'Fund'], [4, 'Subsidiary']];

function push<K, V>(index: Map<K, V[]>, key: K, value: V): void {
  const bucket = index.get(key);
  if (bucket) bucket.push(value);
  else index.set(key, [value]);
}

/** The slice expanded into the typed edges the query hops walk. */
export class Store {
  readonly entities = new Map<string, EntityNode>();
  readonly instruments = new Map<string, Instrument>();
  readonly positions: PositionNode[] = [];
  readonly childrenOf = new Map<string, string[]>();
  readonly heldBy = new Map<string, PositionNode[]>();
  readonly issuedBy = new Map<string, PositionNode[]>();

  constructor(slice: SliceData) {
    const rows = slice.entities;
    for (const [id, name, bits, ticker, parentIndex, ownership] of rows) {
      this.entities.set(id, {
        id,
        name,
        kinds: KIND_BITS.filter(([bit]) => (bits & bit) !== 0).map(([, kind]) => kind),
        ticker,
        parent: parentIndex >= 0 ? rows[parentIndex][0] : null,
        ownership: ownership ?? 1,
      });
    }
    for (const entity of this.entities.values()) {
      if (entity.parent) push(this.childrenOf, entity.parent, entity.id);
    }
    for (const [cusip, instrumentClass, ticker] of slice.instruments) {
      this.instruments.set(cusip, { cusip, instrumentClass, ticker });
    }
    for (const [holderIndex, issuerIndex, instrumentIndex, periodIndex, quantity, value] of slice.positions) {
      const position: PositionNode = {
        holder: rows[holderIndex][0],
        issuer: rows[issuerIndex][0],
        cusip: slice.instruments[instrumentIndex][0],
        quantity,
        value,
        asOf: slice.periods[periodIndex],
      };
      this.positions.push(position);
      push(this.heldBy, position.holder, position);
      push(this.issuedBy, position.issuer, position);
    }
  }

  entity(id: string): EntityNode | undefined {
    return this.entities.get(id);
  }

  children(id: string): string[] {
    return this.childrenOf.get(id) ?? [];
  }
}

export function clampDepth(requested: number | undefined, max = MAX_DEPTH): number {
  if (requested === undefined) return max;
  return Math.min(Math.max(Math.trunc(requested), 1), max);
}

/* ----------------------------------------------------------------- periods */

/** Reporting periods in the store, newest first. */
export function periods(store: Store): string[] {
  return [...new Set(store.positions.map((position) => position.asOf))].sort().reverse();
}

/** The latest period on or before `asOf`, or the latest of all when no date was given. */
export function resolvePeriod(store: Store, asOf?: string | null): string | null {
  const all = periods(store);
  if (!asOf) return all[0] ?? null;
  return all.find((period) => period <= asOf) ?? null;
}

/* --------------------------------------------------------------- ownership */

/** A parent step is reached by owning the step before it, a subsidiary step by owning that step. */
export function ownedOn(path: PathStep[]): string[] {
  const owned: string[] = [];
  for (let i = 1; i < path.length; i += 1) {
    if (path[i].hop === 'parent') owned.push(path[i - 1].id);
    else if (path[i].hop === 'subsidiary') owned.push(path[i].id);
  }
  return owned;
}

/** Product of the fractions on the lineage hops of a path; an entity with no parent counts whole. */
export function ownershipWeight(store: Store, path: PathStep[]): number {
  let weight = 1;
  for (const id of ownedOn(path)) {
    const entity = store.entity(id);
    weight *= entity && entity.parent ? entity.ownership : 1;
  }
  return weight;
}

export function ref(store: Store, id: string): EntityRef {
  const entity = store.entity(id);
  if (!entity) throw new Error(`entity not found: ${id}`);
  return { id: entity.id, name: entity.name, kinds: entity.kinds };
}

/* ----------------------------------------------------------------- lineage */

/** Ancestors nearest first, at most `depth` of them. */
export function ancestors(store: Store, id: string, depth: number): EntityRef[] {
  const chain: EntityRef[] = [];
  let cursor = store.entity(id);
  while (chain.length < depth && cursor?.parent) {
    const parent = store.entity(cursor.parent);
    if (!parent) break;
    chain.push({ id: parent.id, name: parent.name, kinds: parent.kinds });
    cursor = parent;
  }
  return chain;
}

/** Every entity reachable by `subsidiaryOf` within `depth` hops, child first. */
export function descendantIds(store: Store, id: string, depth: number): string[] {
  const seen = new Set<string>();
  let frontier = [id];
  for (let level = 0; level < depth && frontier.length > 0; level += 1) {
    const next: string[] = [];
    for (const parent of frontier) {
      for (const child of store.children(parent)) {
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

function descendantTree(store: Store, id: string, depth: number): LineageNode {
  const entity = store.entity(id);
  if (!entity) throw new Error(`entity not found: ${id}`);
  const node: LineageNode = { id: entity.id, name: entity.name, kinds: entity.kinds, depth: 0, children: [] };
  const attach = (parent: LineageNode): void => {
    if (parent.depth >= depth) return;
    const children = store.children(parent.id)
      .map((childId) => store.entity(childId))
      .filter((child): child is EntityNode => child !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const childNode: LineageNode = {
        id: child.id, name: child.name, kinds: child.kinds, depth: parent.depth + 1, children: [],
      };
      parent.children.push(childNode);
      attach(childNode);
    }
  };
  attach(node);
  return node;
}

function treeSize(node: LineageNode): number {
  return node.children.reduce((total, child) => total + treeSize(child), 1);
}

function treeDepth(node: LineageNode): number {
  return node.children.reduce((deepest, child) => Math.max(deepest, treeDepth(child)), node.depth);
}

export function lineage(store: Store, id: string, depth = MAX_DEPTH): LineageResponse {
  const capped = clampDepth(depth);
  const self = ref(store, id);
  const chain = ancestors(store, id, capped);
  const tree = descendantTree(store, id, capped);
  return {
    entity: self,
    ancestors: chain,
    ultimateParent: chain.length === 0 ? self : chain[chain.length - 1],
    descendants: tree,
    maxDepth: capped,
    descendantCount: treeSize(tree) - 1,
    deepestLevel: treeDepth(tree),
  };
}

/* ---------------------------------------------------------------- exposure */

/**
 * The root of the fund's family: the first entity on `fund` then its ancestors that has
 * no parent of its own. exposure.rq finds it with a bounded path followed by
 * FILTER NOT EXISTS { ?root tg:subsidiaryOf ?above }, so a chain longer than the depth
 * budget leaves no root and the answer is empty.
 */
function familyRoot(store: Store, fundId: string, depth: number): string | null {
  const candidates = [fundId, ...ancestors(store, fundId, depth).map((a) => a.id)];
  for (const id of candidates) {
    if (store.entity(id)?.parent === null) return id;
  }
  return null;
}

function explain(path: PathStep[], instrument: Instrument): string {
  let sentence = path[0].name;
  for (let i = 1; i < path.length; i += 1) {
    const step = path[i];
    switch (step.hop) {
      case 'parent':
        sentence += ` is a subsidiary of ${step.name}`;
        break;
      case 'subsidiary':
        sentence += `, whose subsidiary ${step.name}`;
        break;
      case 'holds':
        sentence += ` holds ${instrument.instrumentClass}`
          + `${instrument.ticker !== null ? ` ${instrument.ticker}` : ''}`
          + ` issued by ${step.name}`;
        break;
      default:
        sentence += ` ${step.name}`;
    }
  }
  return sentence;
}

/** fund -(parent)*-> root -(subsidiary)*-> holder -(holds)-> issuerEntity -(parent)*-> issuer. */
export function buildPath(
  store: Store,
  fund: EntityRef,
  holder: EntityRef,
  issuerEntity: EntityRef,
  issuer: EntityRef,
  depth: number,
): PathStep[] {
  const path: PathStep[] = [{ id: fund.id, name: fund.name, hop: 'start' }];
  if (holder.id !== fund.id) {
    const up = ancestors(store, fund.id, depth);
    const holderUp = ancestors(store, holder.id, depth);
    const root = up.length === 0 ? fund.id : up[up.length - 1].id;
    for (const step of up) {
      path.push({ id: step.id, name: step.name, hop: 'parent' });
      if (step.id === root) break;
    }
    if (holder.id !== root) {
      let rootIndex = holderUp.findIndex((a) => a.id === root);
      if (rootIndex < 0) rootIndex = holderUp.length;
      for (let i = rootIndex - 1; i >= 0; i -= 1) {
        path.push({ id: holderUp[i].id, name: holderUp[i].name, hop: 'subsidiary' });
      }
      path.push({ id: holder.id, name: holder.name, hop: 'subsidiary' });
    }
  }
  path.push({ id: issuerEntity.id, name: issuerEntity.name, hop: 'holds' });
  if (issuerEntity.id !== issuer.id) {
    for (const step of ancestors(store, issuerEntity.id, depth)) {
      path.push({ id: step.id, name: step.name, hop: 'parent' });
      if (step.id === issuer.id) break;
    }
  }
  return path;
}

export function exposure(
  store: Store,
  fundId: string,
  issuerId: string,
  options: ExposureOptions = {},
): ExposureResponse {
  const started = performance.now();
  const includeAffiliates = options.includeAffiliates ?? true;
  const includeSubsidiaries = options.includeSubsidiaries ?? true;
  const weighted = options.weighted ?? false;
  const depth = clampDepth(options.depth, EXPOSURE_MAX_DEPTH);
  const period = resolvePeriod(store, options.asOf);
  const fund = ref(store, fundId);
  const issuer = ref(store, issuerId);

  // holderClause: the fund alone, or every Fund in the family of its ultimate parent.
  let holders: Set<string>;
  if (!includeAffiliates) {
    holders = new Set([fundId]);
  } else {
    const root = familyRoot(store, fundId, depth);
    holders = new Set<string>();
    if (root !== null) {
      for (const id of [root, ...descendantIds(store, root, depth)]) {
        if (store.entity(id)?.kinds.includes('Fund')) holders.add(id);
      }
    }
  }

  // issuerClause: the issuer alone, or the issuer plus its subsidiaries within depth.
  const issuerEntities = includeSubsidiaries
    ? new Set([issuerId, ...descendantIds(store, issuerId, depth)])
    : new Set([issuerId]);

  // GROUP BY ?holder ?issuerEntity ?instrument, SUM(?v), SUM(?q), COUNT(?pos), MAX(?d).
  interface Group {
    holder: string;
    issuerEntity: string;
    cusip: string;
    value: number;
    quantity: number;
    positions: number;
    asOf: string;
  }
  const groups = new Map<string, Group>();
  for (const holderId of holders) {
    for (const position of store.heldBy.get(holderId) ?? []) {
      if (!issuerEntities.has(position.issuer)) continue;
      if (position.asOf !== period) continue;
      const key = `${position.holder} ${position.issuer} ${position.cusip}`;
      const group = groups.get(key);
      if (group) {
        group.value += position.value;
        group.quantity += position.quantity;
        group.positions += 1;
        if (position.asOf > group.asOf) group.asOf = position.asOf;
      } else {
        groups.set(key, {
          holder: position.holder,
          issuerEntity: position.issuer,
          cusip: position.cusip,
          value: position.value,
          quantity: position.quantity,
          positions: 1,
          asOf: position.asOf,
        });
      }
    }
  }

  // ORDER BY DESC(?value); ties broken by holder then CUSIP so the order is stable.
  const ordered = [...groups.values()].sort((a, b) => (b.value - a.value)
    || a.holder.localeCompare(b.holder)
    || a.cusip.localeCompare(b.cusip));

  const byInstrument: ExposureLine[] = [];
  const byHolder = new Map<string, HolderTotal>();
  let totalValue = 0;
  let directValue = 0;
  let viaSubsidiariesValue = 0;
  let viaAffiliatesValue = 0;
  let positions = 0;
  let longestPath = 0;

  for (const group of ordered) {
    const instrument: Instrument = store.instruments.get(group.cusip)
      ?? { cusip: group.cusip, ticker: null, instrumentClass: '' };
    const holder = ref(store, group.holder);
    const issuerEntity = ref(store, group.issuerEntity);
    const viaAffiliate = holder.id !== fund.id;
    const viaSubsidiary = issuerEntity.id !== issuer.id;
    const path = buildPath(store, fund, holder, issuerEntity, issuer, depth);
    const weight = weighted ? ownershipWeight(store, path) : null;
    byInstrument.push({
      instrument,
      holder,
      issuerEntity,
      value: group.value,
      quantity: group.quantity,
      positions: group.positions,
      asOf: group.asOf,
      direct: !viaAffiliate && !viaSubsidiary,
      viaAffiliate,
      viaSubsidiary,
      pathLength: path.length - 1,
      lineagePath: path,
      explanation: explain(path, instrument),
      weight,
      weightedValue: weight === null ? null : Math.round(group.value * weight * 100) / 100,
    });
  }

  if (weighted) {
    byInstrument.sort((a, b) => (b.weightedValue ?? 0) - (a.weightedValue ?? 0)
      || a.holder.id.localeCompare(b.holder.id)
      || a.instrument.cusip.localeCompare(b.instrument.cusip));
  }

  // A line reached through an affiliate and an issuer subsidiary counts once, on the
  // affiliate leg, so the three legs always add up to the total.
  for (const line of byInstrument) {
    const value = weighted ? line.weightedValue ?? 0 : line.value;
    totalValue += value;
    positions += line.positions;
    longestPath = Math.max(longestPath, line.pathLength);
    if (line.direct) directValue += value;
    else if (line.viaSubsidiary && !line.viaAffiliate) viaSubsidiariesValue += value;
    else viaAffiliatesValue += value;

    const running = byHolder.get(line.holder.id);
    if (running) {
      running.value += value;
      running.positions += line.positions;
    } else {
      byHolder.set(line.holder.id, { holder: line.holder, value, positions: line.positions });
    }
  }

  return {
    fund,
    issuer,
    asOf: period,
    totalValue,
    directValue,
    viaSubsidiariesValue,
    viaAffiliatesValue,
    positions,
    includeAffiliates,
    includeSubsidiaries,
    weighted,
    maxDepth: depth,
    longestPath,
    byInstrument,
    byHolder: [...byHolder.values()].sort((a, b) => b.value - a.value),
    queryMillis: performance.now() - started,
  };
}

/** The line the README prints as "longest path": the first line with the most hops. */
export function longestLine(answer: ExposureResponse): ExposureLine | null {
  if (answer.byInstrument.length === 0) return null;
  return answer.byInstrument.reduce(
    (best, line) => (line.pathLength > best.pathLength ? line : best),
    answer.byInstrument[0],
  );
}
