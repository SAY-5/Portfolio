// Shared types for the in-browser full-text search engine. The engine builds an
// inverted index over a small document corpus and ranks matches with TF-IDF.

export type Doc = {
  id: string;
  title: string;
  body: string;
};

// A single posting: which document a term appears in and how often. Positions
// power snippet generation by locating the first matched token in the body.
export type Posting = {
  docId: string;
  tf: number;
  positions: number[];
};

// term -> postings, plus the per-term document frequency used by IDF.
export type IndexEntry = {
  term: string;
  df: number;
  postings: Posting[];
};

export type InvertedIndex = {
  // term -> entry
  terms: Map<string, IndexEntry>;
  // docId -> token count, used to normalise term frequency
  docLengths: Map<string, number>;
  // docId -> the tokenized body, kept for snippet generation
  docTokens: Map<string, string[]>;
  docCount: number;
};

export type IndexStats = {
  docCount: number;
  uniqueTerms: number;
  totalPostings: number;
  avgDocLength: number;
};

// One ranked search hit with the score and the snippet to render.
export type SearchHit = {
  docId: string;
  title: string;
  score: number;
  // Terms from the query that actually matched this document.
  matched: string[];
  snippet: SnippetPart[];
};

// A snippet is a list of parts so the UI can mark matched terms without
// dangerously setting inner HTML.
export type SnippetPart = {
  text: string;
  hit: boolean;
};
