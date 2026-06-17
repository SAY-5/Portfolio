// Safe, pure faceted search engine. No eval, no Function, no regex built from
// user text: queries are tokenized into plain words and matched against a
// per-record term set, so a hostile query can only ever miss, never execute.
// Every function is a pure transform over its inputs, which keeps the store and
// the React layer trivial to reason about and makes results deterministic.

import { CATALOG } from './data';
import {
  PAGE_SIZE,
  type FacetCount,
  type Hit,
  type Query,
  type Record,
  type Result,
  type SortMode,
} from './types';

// Split arbitrary text into lowercased word tokens. Anything that is not a
// letter or digit is a separator, so punctuation never leaks into a token and
// the query text can never be interpreted as code or a pattern.
export function tokenize(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of text.toLowerCase()) {
    const isWord = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
    if (isWord) {
      cur += ch;
    } else if (cur) {
      out.push(cur);
      cur = '';
    }
  }
  if (cur) out.push(cur);
  return out;
}

// Relevance score for a record against the query tokens. A name match counts
// more than a tag match, and a prefix match (the query word starts a record
// word) still scores so partial typing surfaces results. Zero means no match.
function scoreRecord(r: Record, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 1; // no text query: everything is equal
  const nameTokens = tokenize(r.name);
  const tagTokens = r.tags.flatMap((t) => tokenize(t));
  let score = 0;
  for (const q of queryTokens) {
    let best = 0;
    for (const n of nameTokens) {
      if (n === q) best = Math.max(best, 3);
      else if (n.startsWith(q)) best = Math.max(best, 2);
    }
    for (const t of tagTokens) {
      if (t === q) best = Math.max(best, 2);
      else if (t.startsWith(q)) best = Math.max(best, 1);
    }
    if (best === 0) return 0; // every query word must match somewhere (AND)
    score += best;
  }
  return score;
}

// Does a record satisfy a single facet axis? Categories are an OR set (a record
// passes if its category is among those selected); tags are an AND set (a
// record must carry every selected tag). Empty selections mean no constraint.
function matchesCategories(r: Record, categories: string[]): boolean {
  return categories.length === 0 || categories.includes(r.category);
}

function matchesTags(r: Record, tags: string[]): boolean {
  return tags.every((t) => r.tags.includes(t));
}

function matchesPrice(r: Record, min: number, max: number): boolean {
  return r.price >= min && r.price <= max;
}

function matchesRating(r: Record, minRating: number): boolean {
  return r.rating >= minRating;
}

// A record passes the full query (ignoring text) when it clears every facet
// axis. Text matching is handled separately via the score so relevance sorting
// has a number to work with.
function passesFacets(r: Record, q: Query): boolean {
  return (
    matchesCategories(r, q.categories) &&
    matchesTags(r, q.tags) &&
    matchesPrice(r, q.minPrice, q.maxPrice) &&
    matchesRating(r, q.minRating)
  );
}

// All records that match the query on every axis including text, returned as
// scored hits. Unpaged and unsorted; callers sort and page afterwards.
function matchingHits(q: Query): Hit[] {
  const queryTokens = tokenize(q.text);
  const hits: Hit[] = [];
  for (const r of CATALOG) {
    if (!passesFacets(r, q)) continue;
    const score = scoreRecord(r, queryTokens);
    if (score === 0) continue;
    hits.push({ record: r, score });
  }
  return hits;
}

// Order hits by the chosen axis. Relevance uses the score then name as a
// stable tiebreak; the other axes ignore the score. Every comparison falls back
// to id so the order is fully deterministic.
function sortHits(hits: Hit[], mode: SortMode): Hit[] {
  const out = [...hits];
  out.sort((a, b) => {
    let primary = 0;
    if (mode === 'relevance') primary = b.score - a.score;
    else if (mode === 'price') primary = a.record.price - b.record.price;
    else if (mode === 'rating') primary = b.record.rating - a.record.rating;
    else if (mode === 'year') primary = b.record.year - a.record.year;
    if (primary !== 0) return primary;
    const byName = a.record.name.localeCompare(b.record.name);
    if (byName !== 0) return byName;
    return a.record.id.localeCompare(b.record.id);
  });
  return out;
}

// Facet counts for one axis. For each candidate value, count the records that
// would match if that value were active, holding the OTHER axes fixed. This is
// the standard "drill-down preview" count: it answers "if I click this, how
// many results do I get", which is why the axis under count is excluded from
// the base filter.
function countCategoryFacets(q: Query): FacetCount[] {
  const values = new Set<string>();
  for (const r of CATALOG) values.add(r.category);
  // Base query with categories removed so each value is counted independently.
  const base: Query = { ...q, categories: [] };
  const counts: FacetCount[] = [];
  for (const value of values) {
    let count = 0;
    const queryTokens = tokenize(base.text);
    for (const r of CATALOG) {
      if (r.category !== value) continue;
      if (!passesFacets(r, base)) continue;
      if (scoreRecord(r, queryTokens) === 0) continue;
      count += 1;
    }
    counts.push({ value, count, selected: q.categories.includes(value) });
  }
  counts.sort((a, b) => a.value.localeCompare(b.value));
  return counts;
}

function countTagFacets(q: Query): FacetCount[] {
  const values = new Set<string>();
  for (const r of CATALOG) for (const t of r.tags) values.add(t);
  const counts: FacetCount[] = [];
  for (const value of values) {
    // Hold the other selected tags fixed and add this one, so the count is what
    // the user would get after also selecting it (tags are AND).
    const withTag = q.tags.includes(value) ? q.tags : [...q.tags, value];
    const base: Query = { ...q, tags: withTag };
    const queryTokens = tokenize(base.text);
    let count = 0;
    for (const r of CATALOG) {
      if (!passesFacets(r, base)) continue;
      if (scoreRecord(r, queryTokens) === 0) continue;
      count += 1;
    }
    counts.push({ value, count, selected: q.tags.includes(value) });
  }
  counts.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.value.localeCompare(b.value);
  });
  return counts;
}

// Price bounds across the whole catalog, used to clamp the range control.
export function priceBounds(): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const r of CATALOG) {
    if (r.price < min) min = r.price;
    if (r.price > max) max = r.price;
  }
  return { min, max };
}

// The set of categories and tags present in the catalog, for building empty
// facet lists and the default query bounds without hard-coding.
export function allCategories(): string[] {
  const set = new Set<string>();
  for (const r of CATALOG) set.add(r.category);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function allTags(): string[] {
  const set = new Set<string>();
  for (const r of CATALOG) for (const t of r.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

// Run the full query: filter, score, sort, count facets, and page. This is the
// single entry point the store calls; it returns everything the UI renders.
export function runQuery(q: Query): Result {
  const filtered = sortHits(matchingHits(q), q.sort);
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(0, q.page), pageCount - 1);
  const start = page * PAGE_SIZE;
  const hits = filtered.slice(start, start + PAGE_SIZE);
  return {
    hits,
    total,
    page,
    pageCount,
    categoryFacets: countCategoryFacets(q),
    tagFacets: countTagFacets(q),
    priceBounds: priceBounds(),
  };
}
