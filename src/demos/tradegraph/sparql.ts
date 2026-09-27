// Port of tradegraph's web/src/graph/sparql.ts, which mirrors QueryTemplates.render,
// SparqlValues and the clause builders of ExposureService (holderClause, issuerClause)
// with SparqlPaths.bounded for the depth limited paths, cut to the exposure question.
// The template text comes from the slice, byte for byte from
// api/src/main/resources/queries at the commit the slice names, and the rendered query
// is the text the API sends to the store for the same fund, issuer, options and
// period. Nothing here evaluates it: graph.ts walks the same hops over the cut.

import { EXPOSURE_MAX_DEPTH } from './graph';

export const ENTITY_NS = 'https://tradegraph.dev/entity/';
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const PLACEHOLDER = /\$\{([a-zA-Z]+)\}/g;
const SUBSIDIARY_OF = 'tg:subsidiaryOf';

export interface QueryTemplates {
  prefixes: string;
  exposure: string;
}

export function entityIri(id: string): string {
  if (!ID.test(id)) throw new Error(`invalid entity id: ${id}`);
  return `<${ENTITY_NS}${id}>`;
}

/** `(p|p/p|p/p/p)` for min=1, max=3, exactly as SparqlPaths.bounded builds it. */
export function boundedPath(property: string, min: number, max: number): string {
  if (min < 1) throw new Error('min must be at least 1');
  if (max < min) return '';
  const alternatives: string[] = [];
  for (let length = min; length <= max; length += 1) {
    alternatives.push(new Array<string>(length).fill(property).join('/'));
  }
  return `(${alternatives.join('|')})`;
}

/** `UNION { subject (p|p/p) object }`, or nothing when the depth allows no extra hop. */
export function unionHops(subject: string, object: string, minHops: number, maxHops: number): string {
  const path = boundedPath(SUBSIDIARY_OF, minHops, maxHops);
  return path === '' ? '' : `UNION { ${subject} ${path} ${object} }`;
}

export function holderClause(fundIri: string, includeAffiliates: boolean, depth: number): string {
  if (!includeAffiliates) return `BIND(${fundIri} AS ?holder)`;
  return `{ BIND(${fundIri} AS ?root) } ${unionHops(fundIri, '?root', 1, depth)}\n`
    + '  FILTER NOT EXISTS { ?root tg:subsidiaryOf ?above }\n'
    + '  ?holder a tg:Fund .\n'
    + `  FILTER(?holder = ?root || EXISTS { ?holder ${boundedPath(SUBSIDIARY_OF, 1, depth)} ?root })`;
}

export function issuerClause(issuerIri: string, includeSubsidiaries: boolean, depth: number): string {
  if (!includeSubsidiaries) return `BIND(${issuerIri} AS ?issuerEntity)`;
  return `{ BIND(${issuerIri} AS ?issuerEntity) } ${unionHops('?issuerEntity', issuerIri, 1, depth)}`;
}

/** `VALUES ?d { "2024-06-30"^^xsd:date }`, pinning a query to one reporting period. */
export function valuesBlock(variable: string, period: string | null): string {
  return period === null
    ? `VALUES ?${variable} { }`
    : `VALUES ?${variable} { "${period}"^^xsd:date }`;
}

/** Renders a template with the prefixes prepended, refusing unresolved placeholders. */
export function render(templates: QueryTemplates, name: keyof QueryTemplates, params: Record<string, string>): string {
  const template = templates[name];
  const body = template.replace(PLACEHOLDER, (_match, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`unresolved placeholder \${${key}} in ${name}`);
    return value;
  });
  return `${templates.prefixes}\n${body}`;
}

export function renderExposure(
  templates: QueryTemplates,
  fundId: string,
  issuerId: string,
  includeAffiliates: boolean,
  includeSubsidiaries: boolean,
  depth: number,
  period: string | null,
): string {
  const fundIri = entityIri(fundId);
  const issuerIri = entityIri(issuerId);
  const capped = Math.min(depth, EXPOSURE_MAX_DEPTH);
  return render(templates, 'exposure', {
    fund: fundIri,
    issuer: issuerIri,
    depth: String(capped),
    periodValues: valuesBlock('d', period),
    holderClause: holderClause(fundIri, includeAffiliates, capped),
    issuerClause: issuerClause(issuerIri, includeSubsidiaries, capped),
  });
}
