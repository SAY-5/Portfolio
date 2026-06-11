import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './reviewdeck.css';

// Real mechanism: a virtualized list that stays smooth at 100k rows, with
// faceted search and cursor pagination. This builds a real 100k-row dataset and
// renders only the rows in the scroll window, so the DOM holds a few dozen
// nodes no matter the total. Facets narrow the set; the cursor reports where
// the next page would load from.

const TOTAL = 100000;
const ROW_H = 40;
const OVERSCAN = 6;

type Status = 'open' | 'cleared' | 'flagged';
type Kind = 'pdf' | 'docx' | 'email' | 'html';

const STATUSES: Status[] = ['open', 'cleared', 'flagged'];
const KINDS: Kind[] = ['pdf', 'docx', 'email', 'html'];

type Doc = { id: number; title: string; status: Status; kind: Kind };

// Deterministic synthetic corpus so the demo is stable across renders.
function buildCorpus(): Doc[] {
  const subjects = [
    'invoice', 'contract', 'statement', 'memo', 'receipt',
    'agreement', 'filing', 'transcript', 'ledger', 'notice',
  ];
  const out: Doc[] = new Array(TOTAL);
  for (let i = 0; i < TOTAL; i++) {
    const subject = subjects[i % subjects.length];
    out[i] = {
      id: i + 1,
      title: `${subject} batch ${String((i % 9000) + 1).padStart(4, '0')}`,
      status: STATUSES[i % 3],
      kind: KINDS[i % 4],
    };
  }
  return out;
}

export default function ReviewdeckDemo() {
  const reduce = useReducedMotion();
  const corpus = useMemo(() => buildCorpus(), []);

  const [status, setStatus] = useState<Status | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(320);
  const [maxDom, setMaxDom] = useState(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // facet counts over the full corpus (cheap modular arithmetic)
  const statusCounts = useMemo(() => {
    const base = Math.floor(TOTAL / 3);
    return { open: base + 1, cleared: base, flagged: base } as Record<Status, number>;
  }, []);
  const kindCounts = useMemo(() => {
    const base = TOTAL / 4;
    return { pdf: base, docx: base, email: base, html: base } as Record<Kind, number>;
  }, []);

  const filtered = useMemo(() => {
    if (!status && !kind) return corpus;
    return corpus.filter(
      (d) => (!status || d.status === status) && (!kind || d.kind === kind),
    );
  }, [corpus, status, kind]);

  // Reset scroll when the filter changes the set. The scrollTop state is reset
  // during render against the last seen filter (React's adjust-on-input
  // pattern); the matching DOM scroll reset stays in the effect below.
  const filterKey = `${status ?? ''}|${kind ?? ''}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setScrollTop(0);
  }
  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
  }, [status, kind]);

  // measure the viewport once mounted (browser-only, kept out of render)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    setViewportH(el.clientHeight || 320);
  }, []);

  const total = filtered.length;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const visibleCount = Math.ceil(viewportH / ROW_H) + OVERSCAN * 2;
  const endIdx = Math.min(total, startIdx + visibleCount);
  const visibleRows = filtered.slice(startIdx, endIdx);
  const domCount = visibleRows.length;

  // Track the high-water mark of rows actually in the DOM. It only grows, so
  // raise it during render rather than in a cascading effect.
  if (domCount > maxDom) {
    setMaxDom(domCount);
  }

  // cursor pagination: the next page would start after the last windowed row
  const pageSize = 50;
  const cursorIdx = Math.min(total, startIdx + domCount);
  const nextCursor =
    cursorIdx < total
      ? filtered[Math.min(total - 1, cursorIdx)].id
      : null;
  const pageNumber = Math.floor(startIdx / pageSize) + 1;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    setScrollTop(e.currentTarget.scrollTop);
  }

  function toggleStatus(s: Status) {
    setStatus((cur) => (cur === s ? null : s));
  }
  function toggleKind(k: Kind) {
    setKind((cur) => (cur === k ? null : k));
  }
  function clearFacets() {
    setStatus(null);
    setKind(null);
    setMaxDom(0);
  }

  return (
    <div className="demo" aria-label="reviewdeck virtualized list demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">100k rows, a few dozen in the DOM</h3>
      <p className="demo__lede">
        Scroll the list of {TOTAL.toLocaleString()} documents and watch the DOM
        node count stay tiny while the scrollbar spans the full set. Toggle the
        faceted filters to narrow the corpus, and read the cursor that marks
        where the next page would load.
      </p>

      <div className="rd__stage">
        <div className="rd__facets">
          <div className="rd__facet">
            <div className="rd__facet-head">Status facet</div>
            <div className="rd__chips" role="group" aria-label="filter by status">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="rd__chip"
                  aria-pressed={status === s}
                  onClick={() => toggleStatus(s)}
                >
                  {s}
                  <span className="rd__chip-n">
                    {statusCounts[s].toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="rd__facet">
            <div className="rd__facet-head">Type facet</div>
            <div className="rd__chips" role="group" aria-label="filter by type">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="rd__chip"
                  aria-pressed={kind === k}
                  onClick={() => toggleKind(k)}
                >
                  {k}
                  <span className="rd__chip-n">
                    {kindCounts[k].toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rd__listwrap">
          <div className="rd__listbar">
            <span className="rd__listbar-label">Matches</span>
            <span className="rd__listbar-count">
              {total.toLocaleString()} rows
            </span>
            <span className="rd__listbar-dom">
              in DOM now <b>{domCount}</b> rows
            </span>
          </div>

          <div
            className="rd__viewport"
            ref={viewportRef}
            onScroll={onScroll}
            role="list"
            aria-label={`${total} document rows, virtualized`}
            tabIndex={0}
          >
            {total === 0 ? (
              <div className="rd__empty">No documents match these facets.</div>
            ) : (
              <div
                className="rd__spacer"
                style={{ height: total * ROW_H }}
                aria-hidden={false}
              >
                {visibleRows.map((d, i) => {
                  const rowIndex = startIdx + i;
                  return (
                    <div
                      className="rd__row"
                      role="listitem"
                      key={d.id}
                      style={{
                        top: rowIndex * ROW_H,
                        transition: reduce ? 'none' : undefined,
                      }}
                    >
                      <span className="rd__row-id">
                        #{d.id.toString().padStart(6, '0')}
                      </span>
                      <span className="rd__row-title">{d.title}</span>
                      <span className="rd__row-status" data-s={d.status}>
                        {d.status}
                      </span>
                      <span className="rd__row-kind">{d.kind}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rd__pager">
            <span className="rd__pager-cursor">
              page {pageNumber.toLocaleString()} / {totalPages.toLocaleString()},
              cursor{' '}
              <b>{nextCursor ? `after #${nextCursor.toString().padStart(6, '0')}` : 'end of set'}</b>
            </span>
            <span className="rd__pager-spin">
              {nextCursor ? 'next page loads on scroll' : 'all pages loaded'}
            </span>
          </div>
        </div>

        <div className="rd__stats">
          <div className="rd__stat">
            <span className="rd__stat-val">{TOTAL.toLocaleString()}</span>
            <span className="rd__stat-label">rows in the set</span>
          </div>
          <div className="rd__stat rd__stat--win">
            <span className="rd__stat-val">{Math.max(domCount, maxDom)}</span>
            <span className="rd__stat-label">peak rows mounted</span>
          </div>
          <div className="rd__stat">
            <span className="rd__stat-val">
              {((Math.max(domCount, maxDom, 1) / TOTAL) * 100).toFixed(3)}%
            </span>
            <span className="rd__stat-label">of nodes rendered</span>
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={clearFacets}
          disabled={!status && !kind}
        >
          Clear facets
        </button>
        <span className="demo__hint">
          windowed render at {ROW_H}px rows, only the visible slice is mounted
        </span>
      </div>
    </div>
  );
}
