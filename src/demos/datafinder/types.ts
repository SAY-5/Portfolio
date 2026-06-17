// Domain model for the in-browser faceted catalog explorer. Everything runs
// client-side over a static seed: there is no server, so these types describe
// the whole world the app reasons about. The catalog is a hardware/asset set
// the user searches, filters by facet, sorts, paginates, opens, and saves
// views over.

export type Record = {
  id: string;
  name: string;
  category: string;
  tags: string[];
  price: number; // whole currency units
  rating: number; // 0..5, one decimal
  year: number;
  blurb: string;
};

// Sort axes the result list offers. Relevance only means anything when a text
// query is present; with no query it falls back to a stable name order.
export type SortMode = 'relevance' | 'price' | 'rating' | 'year';

// The full query the engine reasons over. Empty or default fields mean no
// constraint on that axis, so the bare query returns the whole catalog.
export type Query = {
  text: string;
  categories: string[]; // OR within categories
  tags: string[]; // AND across selected tags
  minPrice: number;
  maxPrice: number;
  minRating: number;
  sort: SortMode;
  page: number; // zero-based
};

// A search hit pairs a record with its relevance score so the list can sort on
// the same number and the UI can show why a result ranked where it did.
export type Hit = {
  record: Record;
  score: number;
};

// One facet value plus the count of records that would match if that value
// were toggled on, given the OTHER active filters. The count is what makes the
// sidebar a live preview rather than a static list.
export type FacetCount = {
  value: string;
  count: number;
  selected: boolean;
};

// The full result of running a query: the page of hits, the total before
// paging, the facet counts for each axis, and the price bounds of the catalog
// so the range control can clamp itself without hard-coding numbers.
export type Result = {
  hits: Hit[];
  total: number;
  page: number;
  pageCount: number;
  categoryFacets: FacetCount[];
  tagFacets: FacetCount[];
  priceBounds: { min: number; max: number };
};

// A named filter set the user saved, so a useful query can be recalled later.
// The clock is snapshotted at save time so render stays pure.
export type SavedView = {
  id: string;
  name: string;
  query: Query;
  savedAt: number;
};

export const PAGE_SIZE = 6;

export const SORT_MODES: SortMode[] = ['relevance', 'price', 'rating', 'year'];

export const SORT_LABELS: { [K in SortMode]: string } = {
  relevance: 'Relevance',
  price: 'Price (low to high)',
  rating: 'Rating (high to low)',
  year: 'Year (newest)',
};
