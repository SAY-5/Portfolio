import { useMemo } from 'react';
import '../styles/demo.css';
import './tracesift.css';
import { analyze, summarize } from './tracesift/engine';
import { useStore } from './tracesift/state';
import {
  resetSelection,
  selectSpan,
  selectTrace,
  setServiceFilter,
  toggleCritical,
} from './tracesift/store';
import type { LaidOutSpan } from './tracesift/types';

// In-browser distributed-trace waterfall viewer. Three sample traces ship as
// read-only seed data; the engine derives every view from the raw spans alone
// (no eval, no clock, no network), so the same trace always renders the same
// waterfall, critical path, slowest spans and per-service breakdown. The open
// trace, focused span, service filter and critical-path toggle persist in
// localStorage, so a reload restores exactly what was on screen.

// Fixed service palette so a service keeps one colour across every trace.
const SERVICE_HUES: Record<string, number> = {
  gateway: 188,
  auth: 280,
  orders: 28,
  inventory: 150,
  payments: 330,
  db: 210,
  cache: 50,
  email: 110,
};

function hueFor(service: string): number {
  if (service in SERVICE_HUES) return SERVICE_HUES[service];
  // Deterministic fallback for any service not in the palette.
  let h = 0;
  for (let i = 0; i < service.length; i++) h = (h * 31 + service.charCodeAt(i)) % 360;
  return h;
}

function serviceColor(service: string): string {
  return `hsl(${hueFor(service)} 80% 62%)`;
}

function fmtMs(ms: number): string {
  return `${Math.round(ms)} ms`;
}

export default function TracesiftDemo() {
  const state = useStore();

  const summaries = useMemo(() => state.traces.map(summarize), [state.traces]);

  const trace = useMemo(
    () => state.traces.find((t) => t.id === state.traceId),
    [state.traces, state.traceId],
  );

  const insights = useMemo(() => (trace ? analyze(trace) : null), [trace]);

  const criticalSet = useMemo(
    () => new Set(insights?.criticalPath ?? []),
    [insights],
  );

  const selectedSpan = useMemo(
    () => insights?.layout.find((l) => l.span.id === state.spanId) ?? null,
    [insights, state.spanId],
  );

  const slowest = useMemo(() => {
    if (!insights) return [] as LaidOutSpan[];
    const byId = new Map(insights.layout.map((l) => [l.span.id, l]));
    return insights.slowestSpans
      .slice(0, 4)
      .map((id) => byId.get(id))
      .filter((l): l is LaidOutSpan => l != null);
  }, [insights]);

  return (
    <div className="demo ts" aria-label="TraceSift distributed-trace waterfall viewer">
      <span className="demo__tag">TraceSift</span>
      <h2 className="demo__title">Distributed-trace waterfall</h2>
      <p className="demo__lede">
        Browse sample traces, open one as a waterfall, inspect a span, highlight
        the critical path, and read the slowest spans and per-service time. Every
        view is derived from the raw spans, so it is fully deterministic.
      </p>

      <div className="ts__layout">
        <TraceList summaries={summaries} activeId={state.traceId} />

        <div className="ts__main">
          {insights ? (
            <>
              <Waterfall
                insights={insights}
                selectedId={state.spanId}
                serviceFilter={state.serviceFilter}
                highlightCritical={state.highlightCritical}
                criticalSet={criticalSet}
              />
              <SpanDetail
                selected={selectedSpan}
                criticalSet={criticalSet}
                highlightCritical={state.highlightCritical}
              />
              <Insights
                insights={insights}
                slowest={slowest}
                serviceFilter={state.serviceFilter}
                selectedId={state.spanId}
              />
            </>
          ) : (
            <p className="ts__empty" role="status">
              No trace selected.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- trace list ----------

function TraceList({
  summaries,
  activeId,
}: {
  summaries: ReturnType<typeof summarize>[];
  activeId: string;
}) {
  return (
    <nav className="ts__list glass" aria-label="Traces">
      <h3 className="ts__list-title">Traces</h3>
      <ul className="ts__list-items">
        {summaries.map((s) => {
          const active = s.id === activeId;
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`ts__trace${active ? ' ts__trace--active' : ''}`}
                aria-pressed={active}
                onClick={() => selectTrace(s.id)}
              >
                <span className="ts__trace-name">{s.name}</span>
                <span className="ts__trace-meta">
                  <span>{fmtMs(s.totalMs)}</span>
                  <span aria-label={`${s.spanCount} spans`}>{s.spanCount} spans</span>
                  <span aria-label={`${s.serviceCount} services`}>
                    {s.serviceCount} svc
                  </span>
                </span>
                {s.errorCount > 0 && (
                  <span className="ts__badge ts__badge--error">
                    {s.errorCount} error{s.errorCount > 1 ? 's' : ''}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---------- waterfall ----------

function Waterfall({
  insights,
  selectedId,
  serviceFilter,
  highlightCritical,
  criticalSet,
}: {
  insights: ReturnType<typeof analyze>;
  selectedId: string | null;
  serviceFilter: string | null;
  highlightCritical: boolean;
  criticalSet: Set<string>;
}) {
  return (
    <section className="ts__waterfall glass" aria-label="Waterfall">
      <header className="ts__wf-head">
        <h3>{insights.trace.name}</h3>
        <span className="ts__wf-total">{fmtMs(insights.totalMs)} end to end</span>
      </header>
      <ol className="ts__bars">
        {insights.layout.map((l) => {
          const onCritical = criticalSet.has(l.span.id);
          const dimmed = serviceFilter != null && l.span.service !== serviceFilter;
          const selected = l.span.id === selectedId;
          const classes = [
            'ts__bar-row',
            selected ? 'ts__bar-row--selected' : '',
            dimmed ? 'ts__bar-row--dim' : '',
            highlightCritical && onCritical ? 'ts__bar-row--critical' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li key={l.span.id}>
              <button
                type="button"
                className={classes}
                aria-pressed={selected}
                onClick={() => selectSpan(selected ? null : l.span.id)}
                title={`${l.span.service} · ${l.span.name} · ${fmtMs(l.span.durationMs)}`}
              >
                <span
                  className="ts__bar-label"
                  style={{ paddingLeft: `${l.depth * 14}px` }}
                >
                  <span
                    className="ts__svc-dot"
                    style={{ background: serviceColor(l.span.service) }}
                    aria-hidden="true"
                  />
                  <span className="ts__bar-name">{l.span.name}</span>
                  {l.hasError && (
                    <span className="ts__bar-err" aria-label="error span">
                      !
                    </span>
                  )}
                </span>
                <span className="ts__bar-track" aria-hidden="true">
                  <span
                    className="ts__bar-fill"
                    style={{
                      left: `${l.leftFrac * 100}%`,
                      width: `${Math.max(l.widthFrac * 100, 0.8)}%`,
                      background: serviceColor(l.span.service),
                    }}
                  />
                </span>
                <span className="ts__bar-dur">{fmtMs(l.span.durationMs)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------- span detail ----------

function SpanDetail({
  selected,
  criticalSet,
  highlightCritical,
}: {
  selected: LaidOutSpan | null;
  criticalSet: Set<string>;
  highlightCritical: boolean;
}) {
  return (
    <section className="ts__detail glass" aria-label="Span detail">
      <div className="ts__detail-head">
        <h3>Span detail</h3>
        <div className="ts__detail-actions">
          <button
            type="button"
            className="demo__btn demo__btn--ghost"
            aria-pressed={highlightCritical}
            onClick={toggleCritical}
          >
            {highlightCritical ? 'Hide critical path' : 'Highlight critical path'}
          </button>
          <button
            type="button"
            className="demo__btn demo__btn--ghost"
            onClick={resetSelection}
          >
            Reset selection
          </button>
        </div>
      </div>
      {selected ? (
        <dl className="ts__detail-grid">
          <div>
            <dt>Span</dt>
            <dd>{selected.span.name}</dd>
          </div>
          <div>
            <dt>Service</dt>
            <dd>
              <span
                className="ts__svc-dot"
                style={{ background: serviceColor(selected.span.service) }}
                aria-hidden="true"
              />
              {selected.span.service}
            </dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{fmtMs(selected.span.durationMs)}</dd>
          </div>
          <div>
            <dt>Self time</dt>
            <dd>{fmtMs(selected.selfMs)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd className={selected.hasError ? 'ts__status--error' : 'ts__status--ok'}>
              {selected.span.status}
            </dd>
          </div>
          <div>
            <dt>On critical path</dt>
            <dd>{criticalSet.has(selected.span.id) ? 'yes' : 'no'}</dd>
          </div>
        </dl>
      ) : (
        <p className="ts__detail-empty" role="status">
          Select a span in the waterfall to inspect it.
        </p>
      )}
    </section>
  );
}

// ---------- insights: slowest spans + per-service ----------

function Insights({
  insights,
  slowest,
  serviceFilter,
  selectedId,
}: {
  insights: ReturnType<typeof analyze>;
  slowest: LaidOutSpan[];
  serviceFilter: string | null;
  selectedId: string | null;
}) {
  const maxSelf = insights.perService.reduce((m, s) => Math.max(m, s.selfMs), 0) || 1;
  return (
    <div className="ts__insights">
      <section className="ts__panel glass" aria-label="Slowest spans">
        <h3>Slowest spans</h3>
        <ul className="ts__slow">
          {slowest.map((l) => {
            const selected = l.span.id === selectedId;
            return (
              <li key={l.span.id}>
                <button
                  type="button"
                  className={`ts__slow-row${selected ? ' ts__slow-row--active' : ''}`}
                  aria-pressed={selected}
                  onClick={() => selectSpan(selected ? null : l.span.id)}
                >
                  <span
                    className="ts__svc-dot"
                    style={{ background: serviceColor(l.span.service) }}
                    aria-hidden="true"
                  />
                  <span className="ts__slow-name">{l.span.name}</span>
                  <span className="ts__slow-self">{fmtMs(l.selfMs)} self</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="ts__panel glass" aria-label="Per-service time">
        <h3>Per-service self-time</h3>
        <ul className="ts__svc">
          {insights.perService.map((s) => {
            const active = serviceFilter === s.service;
            return (
              <li key={s.service}>
                <button
                  type="button"
                  className={`ts__svc-row${active ? ' ts__svc-row--active' : ''}`}
                  aria-pressed={active}
                  onClick={() => setServiceFilter(active ? null : s.service)}
                  title={`Filter the waterfall to ${s.service}`}
                >
                  <span className="ts__svc-head">
                    <span
                      className="ts__svc-dot"
                      style={{ background: serviceColor(s.service) }}
                      aria-hidden="true"
                    />
                    <span className="ts__svc-name">{s.service}</span>
                    <span className="ts__svc-val">{fmtMs(s.selfMs)}</span>
                  </span>
                  <span className="ts__svc-track" aria-hidden="true">
                    <span
                      className="ts__svc-bar"
                      style={{
                        width: `${(s.selfMs / maxSelf) * 100}%`,
                        background: serviceColor(s.service),
                      }}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {serviceFilter && (
          <button
            type="button"
            className="demo__btn demo__btn--ghost ts__clear-filter"
            onClick={() => setServiceFilter(null)}
          >
            Clear {serviceFilter} filter
          </button>
        )}
      </section>
    </div>
  );
}
