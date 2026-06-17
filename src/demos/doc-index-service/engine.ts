// The search engine. Everything here is pure and deterministic: no eval, no
// clock, no randomness. It tokenizes text, builds an inverted index, and ranks
// queries with TF-IDF. The same input corpus always yields the same index and
// the same ranked results.
import type {
  Doc,
  InvertedIndex,
  IndexEntry,
  IndexStats,
  SearchHit,
  SnippetPart,
} from './types';

// A small, fixed stopword list. Kept short on purpose so the demo corpus still
// has interesting vocabulary to rank on.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'for', 'from', 'how',
  'i', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'so', 'that', 'the',
  'their', 'them', 'they', 'this', 'to', 'up', 'was', 'with',
]);

export function isStopword(term: string): boolean {
  return STOPWORDS.has(term);
}

// Lowercase, split on any non-alphanumeric run, drop empties and stopwords.
// Returns the surviving terms in order so positions stay meaningful.
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

// Build the inverted index over a corpus. Title and body are indexed together
// so a term in either is searchable; the body alone drives snippets.
export function buildIndex(docs: Doc[]): InvertedIndex {
  const terms = new Map<string, IndexEntry>();
  const docLengths = new Map<string, number>();
  const docTokens = new Map<string, string[]>();

  for (const doc of docs) {
    const bodyTokens = tokenize(doc.body);
    docTokens.set(doc.id, bodyTokens);

    const tokens = tokenize(`${doc.title} ${doc.body}`);
    docLengths.set(doc.id, tokens.length);

    // term -> { tf, positions } within this document
    const local = new Map<string, { tf: number; positions: number[] }>();
    tokens.forEach((term, pos) => {
      const cur = local.get(term);
      if (cur) {
        cur.tf += 1;
        cur.positions.push(pos);
      } else {
        local.set(term, { tf: 1, positions: [pos] });
      }
    });

    for (const [term, info] of local) {
      const entry = terms.get(term);
      const posting = { docId: doc.id, tf: info.tf, positions: info.positions };
      if (entry) {
        entry.postings.push(posting);
        entry.df += 1;
      } else {
        terms.set(term, { term, df: 1, postings: [posting] });
      }
    }
  }

  return { terms, docLengths, docTokens, docCount: docs.length };
}

export function indexStats(index: InvertedIndex): IndexStats {
  let totalPostings = 0;
  let totalLength = 0;
  for (const entry of index.terms.values()) totalPostings += entry.postings.length;
  for (const len of index.docLengths.values()) totalLength += len;
  return {
    docCount: index.docCount,
    uniqueTerms: index.terms.size,
    totalPostings,
    avgDocLength: index.docCount === 0 ? 0 : totalLength / index.docCount,
  };
}

// Inverse document frequency with a smoothed denominator so a term present in
// every document still scores slightly above zero.
function idf(index: InvertedIndex, df: number): number {
  return Math.log((index.docCount + 1) / (df + 1)) + 1;
}

// Rank documents for a query by summing the TF-IDF weight of every query term
// the document contains. Term frequency is normalised by document length.
export function search(
  index: InvertedIndex,
  docs: Doc[],
  rawQuery: string,
): SearchHit[] {
  const queryTerms = Array.from(new Set(tokenize(rawQuery)));
  if (queryTerms.length === 0) return [];

  const titleById = new Map(docs.map((d) => [d.id, d.title]));

  // docId -> accumulated score and the set of matched terms
  const scores = new Map<string, { score: number; matched: Set<string> }>();

  for (const term of queryTerms) {
    const entry = index.terms.get(term);
    if (!entry) continue;
    const termIdf = idf(index, entry.df);
    for (const posting of entry.postings) {
      const len = index.docLengths.get(posting.docId) || 1;
      const tf = posting.tf / len;
      const weight = tf * termIdf;
      const cur = scores.get(posting.docId);
      if (cur) {
        cur.score += weight;
        cur.matched.add(term);
      } else {
        scores.set(posting.docId, { score: weight, matched: new Set([term]) });
      }
    }
  }

  const hits: SearchHit[] = [];
  for (const [docId, agg] of scores) {
    hits.push({
      docId,
      title: titleById.get(docId) || docId,
      score: agg.score,
      matched: Array.from(agg.matched),
      snippet: buildSnippet(index, docId, agg.matched),
    });
  }

  // Highest score first; ties broken by docId so ordering is deterministic.
  hits.sort((a, b) => b.score - a.score || a.docId.localeCompare(b.docId));
  return hits;
}

// Build a snippet window around the first matched term in the body, marking the
// matched tokens. Returns structured parts so the UI never injects raw HTML.
const SNIPPET_RADIUS = 7;

export function buildSnippet(
  index: InvertedIndex,
  docId: string,
  matched: Set<string>,
): SnippetPart[] {
  const tokens = index.docTokens.get(docId) || [];
  if (tokens.length === 0) return [];

  let first = tokens.findIndex((t) => matched.has(t));
  if (first === -1) first = 0;

  const start = Math.max(0, first - SNIPPET_RADIUS);
  const end = Math.min(tokens.length, first + SNIPPET_RADIUS + 1);

  const parts: SnippetPart[] = [];
  if (start > 0) parts.push({ text: '... ', hit: false });
  for (let i = start; i < end; i++) {
    const token = tokens[i];
    parts.push({ text: token, hit: matched.has(token) });
    if (i < end - 1) parts.push({ text: ' ', hit: false });
  }
  if (end < tokens.length) parts.push({ text: ' ...', hit: false });
  return parts;
}
