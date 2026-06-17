import { useMemo, useState } from 'react';
import '../styles/demo.css';
import './doc-index-service.css';
import { useStore } from './doc-index-service/state';
import {
  addDocument,
  recordQuery,
  removeDocument,
  resetAll,
  setQuery,
} from './doc-index-service/store';
import { search } from './doc-index-service/engine';
import type { IndexEntry, SearchHit, SnippetPart } from './doc-index-service/types';

// In-browser full-text search engine. The corpus is tokenized into an inverted
// index (term -> postings with term frequency), and queries are ranked by summed
// TF-IDF. Everything runs client-side over the corpus seed and is deterministic:
// the same corpus and query always produce the same ranked results. There is no
// eval and no network. Corpus edits re-index immediately and persist in
// localStorage along with the search history.

type Tab = 'search' | 'index' | 'corpus';

function Snippet({ parts }: { parts: SnippetPart[] }) {
  return (
    <span className="di__snippet">
      {parts.map((p, i) =>
        p.hit ? (
          <mark className="di__mark" key={i}>
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

export default function DocIndexServiceDemo() {
  const state = useStore();
  const [tab, setTab] = useState<Tab>('search');
  const [selectedTerm, setSelectedTerm] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');

  const hits: SearchHit[] = useMemo(
    () => search(state.index, state.corpus, state.query),
    [state.index, state.corpus, state.query],
  );

  const queryActive = state.query.trim().length > 0;

  // Terms sorted by document frequency for the term explorer, descending so the
  // most widespread terms surface first.
  const sortedTerms: IndexEntry[] = useMemo(() => {
    return Array.from(state.index.terms.values()).sort(
      (a, b) => b.df - a.df || a.term.localeCompare(b.term),
    );
  }, [state.index]);

  const activeEntry =
    selectedTerm !== null ? state.index.terms.get(selectedTerm) || null : null;

  function runSearch(q: string) {
    setQuery(q);
    recordQuery(q);
  }

  function submitDoc(e: React.FormEvent) {
    e.preventDefault();
    const id = addDocument(draftTitle, draftBody);
    if (id) {
      setDraftTitle('');
      setDraftBody('');
    }
  }

  const titleById = useMemo(
    () => new Map(state.corpus.map((d) => [d.id, d.title])),
    [state.corpus],
  );

  return (
    <div className="demo" aria-label="doc-index-service full-text search engine">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Full-text search over an inverted index</h3>
      <p className="demo__lede">
        A small document corpus is tokenized into an inverted index that maps
        each term to its postings. Queries are ranked by summed TF-IDF, with
        matched terms marked in each snippet. Inspect the index, then add or
        remove documents to watch it update. Everything runs in the browser.
      </p>

      <div className="di__tabs" role="tablist" aria-label="search engine views">
        <button
          role="tab"
          id="di-tab-search"
          aria-selected={tab === 'search'}
          aria-controls="di-panel-search"
          className={tab === 'search' ? 'di__tab di__tab--on' : 'di__tab'}
          onClick={() => setTab('search')}
        >
          Search
        </button>
        <button
          role="tab"
          id="di-tab-index"
          aria-selected={tab === 'index'}
          aria-controls="di-panel-index"
          className={tab === 'index' ? 'di__tab di__tab--on' : 'di__tab'}
          onClick={() => setTab('index')}
        >
          Index inspector
        </button>
        <button
          role="tab"
          id="di-tab-corpus"
          aria-selected={tab === 'corpus'}
          aria-controls="di-panel-corpus"
          className={tab === 'corpus' ? 'di__tab di__tab--on' : 'di__tab'}
          onClick={() => setTab('corpus')}
        >
          Corpus
        </button>
      </div>

      {tab === 'search' && (
        <section
          className="di__panel"
          role="tabpanel"
          id="di-panel-search"
          aria-labelledby="di-tab-search"
        >
          <div className="di__searchbar glass">
            <label className="di__sr-only" htmlFor="di-query">
              Search the corpus
            </label>
            <span className="di__search-icon" aria-hidden="true">
              /
            </span>
            <input
              id="di-query"
              className="di__input"
              type="search"
              placeholder="Search, for example: rank tf-idf snippet"
              value={state.query}
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
              onBlur={(e) => recordQuery(e.target.value)}
            />
            {queryActive && (
              <button
                className="di__clear"
                onClick={() => setQuery('')}
                aria-label="Clear query"
              >
                Clear
              </button>
            )}
          </div>

          <p className="di__count" aria-live="polite">
            {queryActive
              ? `${hits.length} ${hits.length === 1 ? 'result' : 'results'} ranked by TF-IDF`
              : `Type a query to search ${state.corpus.length} documents`}
          </p>

          <ol className="di__results">
            {hits.map((hit) => (
              <li className="di__result glass" key={hit.docId}>
                <div className="di__result-head">
                  <span className="di__result-title">{hit.title}</span>
                  <span className="di__score" title="summed TF-IDF score">
                    {hit.score.toFixed(4)}
                  </span>
                </div>
                <Snippet parts={hit.snippet} />
                <div className="di__matched">
                  <span className="di__matched-label">matched</span>
                  {hit.matched.map((m) => (
                    <span className="di__chip" key={m}>
                      {m}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ol>

          {queryActive && hits.length === 0 && (
            <p className="di__empty">
              No documents contain those terms. Try another query.
            </p>
          )}

          {state.history.length > 0 && (
            <div className="di__history">
              <span className="di__history-label">Recent queries</span>
              <div className="di__history-list">
                {state.history.map((h) => (
                  <button
                    className="di__history-chip"
                    key={h}
                    onClick={() => runSearch(h)}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {tab === 'index' && (
        <section
          className="di__panel"
          role="tabpanel"
          id="di-panel-index"
          aria-labelledby="di-tab-index"
        >
          <dl className="di__stats">
            <div className="di__stat glass">
              <dt>Documents</dt>
              <dd>{state.stats.docCount}</dd>
            </div>
            <div className="di__stat glass">
              <dt>Unique terms</dt>
              <dd>{state.stats.uniqueTerms}</dd>
            </div>
            <div className="di__stat glass">
              <dt>Total postings</dt>
              <dd>{state.stats.totalPostings}</dd>
            </div>
            <div className="di__stat glass">
              <dt>Avg doc length</dt>
              <dd>{state.stats.avgDocLength.toFixed(1)}</dd>
            </div>
          </dl>

          <div className="di__explorer">
            <div className="di__terms glass">
              <span className="di__terms-head">
                Terms by document frequency
              </span>
              <ul className="di__termlist">
                {sortedTerms.map((entry) => (
                  <li key={entry.term}>
                    <button
                      className={
                        selectedTerm === entry.term
                          ? 'di__term di__term--on'
                          : 'di__term'
                      }
                      aria-pressed={selectedTerm === entry.term}
                      onClick={() => setSelectedTerm(entry.term)}
                    >
                      <span className="di__term-name">{entry.term}</span>
                      <span className="di__term-df">df {entry.df}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="di__postings glass" aria-live="polite">
              {activeEntry ? (
                <>
                  <span className="di__postings-head">
                    Postings for{' '}
                    <span className="di__postings-term">
                      {activeEntry.term}
                    </span>
                  </span>
                  <p className="di__postings-meta">
                    document frequency {activeEntry.df}, appears in{' '}
                    {activeEntry.postings.length}{' '}
                    {activeEntry.postings.length === 1 ? 'document' : 'documents'}
                  </p>
                  <ul className="di__posting-rows">
                    {activeEntry.postings.map((p) => (
                      <li className="di__posting" key={p.docId}>
                        <span className="di__posting-doc">
                          {titleById.get(p.docId) || p.docId}
                        </span>
                        <span className="di__posting-tf">tf {p.tf}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="di__postings-empty">
                  Pick a term to see its document frequency and postings.
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {tab === 'corpus' && (
        <section
          className="di__panel"
          role="tabpanel"
          id="di-panel-corpus"
          aria-labelledby="di-tab-corpus"
        >
          <form className="di__add glass" onSubmit={submitDoc}>
            <span className="di__add-head">Add a document</span>
            <label className="di__sr-only" htmlFor="di-doc-title">
              Document title
            </label>
            <input
              id="di-doc-title"
              className="di__input di__input--field"
              type="text"
              placeholder="Title"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
            />
            <label className="di__sr-only" htmlFor="di-doc-body">
              Document body
            </label>
            <textarea
              id="di-doc-body"
              className="di__textarea"
              placeholder="Body text. It is tokenized and merged into the inverted index."
              rows={3}
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
            />
            <button
              className="demo__btn"
              type="submit"
              disabled={
                draftTitle.trim().length === 0 || draftBody.trim().length === 0
              }
            >
              Add and re-index
            </button>
          </form>

          <ul className="di__doclist">
            {state.corpus.map((doc) => (
              <li className="di__doc glass" key={doc.id}>
                <div className="di__doc-main">
                  <span className="di__doc-title">{doc.title}</span>
                  <span className="di__doc-body">{doc.body}</span>
                </div>
                <button
                  className="di__remove"
                  onClick={() => removeDocument(doc.id)}
                  aria-label={`Remove document: ${doc.title}`}
                  disabled={state.corpus.length <= 1}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <div className="demo__controls">
            <button className="demo__btn demo__btn--ghost" onClick={resetAll}>
              Reset corpus and history
            </button>
            <span className="demo__hint">
              clears localStorage and restores the seed corpus
            </span>
          </div>
        </section>
      )}
    </div>
  );
}
