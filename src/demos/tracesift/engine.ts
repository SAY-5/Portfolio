// Pure, deterministic analysis of a trace. No eval, no randomness, no clock:
// every output is a function of the span list alone. Given a set of spans the
// engine builds the call tree, lays out the waterfall, and derives the total
// duration, the critical path, the slowest spans, per-service time and the
// error spans.

import type {
  LaidOutSpan,
  ServiceTime,
  Span,
  Trace,
  TraceInsights,
} from './types';

function endOf(s: Span): number {
  return s.startMs + s.durationMs;
}

// Children of each span, ordered by start time then id for stable output.
function childMap(spans: Span[]): Map<string | null, Span[]> {
  const map = new Map<string | null, Span[]>();
  for (const s of spans) {
    const list = map.get(s.parentId) ?? [];
    list.push(s);
    map.set(s.parentId, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
  }
  return map;
}

// Self-time: a span's duration minus the union of time covered by its direct
// children. Overlapping child intervals are merged so shared time is not
// double-counted.
function selfTime(span: Span, children: Span[]): number {
  if (children.length === 0) return span.durationMs;
  const intervals = children
    .map((c) => [c.startMs, endOf(c)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let curStart = intervals[0][0];
  let curEnd = intervals[0][1];
  for (let i = 1; i < intervals.length; i++) {
    const [s, e] = intervals[i];
    if (s > curEnd) {
      covered += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  covered += curEnd - curStart;
  // Clamp the covered window to the span's own bounds.
  const clamped = Math.min(covered, span.durationMs);
  return Math.max(0, span.durationMs - clamped);
}

// Depth-first ordering with computed depth, mirroring how a waterfall renders
// parents above their children.
function flatten(
  kids: Map<string | null, Span[]>,
): { span: Span; depth: number }[] {
  const out: { span: Span; depth: number }[] = [];
  const roots = kids.get(null) ?? [];
  const walk = (node: Span, depth: number): void => {
    out.push({ span: node, depth });
    for (const child of kids.get(node.id) ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return out;
}

// The critical path is the chain of spans that determines end-to-end latency.
// Starting at the root, at each step follow the child whose end time is latest
// (it gates when the parent can complete); stop when a span has no child that
// ends at or after the parent's own work continues. We follow the child that
// reaches furthest in time, which is the span on the path to the trace end.
function criticalPath(
  roots: Span[],
  kids: Map<string | null, Span[]>,
): string[] {
  if (roots.length === 0) return [];
  // Pick the root that ends last as the driver of end-to-end latency.
  let node = roots.reduce((a, b) => (endOf(b) > endOf(a) ? b : a));
  const path: string[] = [node.id];
  for (;;) {
    const children = kids.get(node.id) ?? [];
    if (children.length === 0) break;
    // The child that ends latest gates this span's completion.
    const next = children.reduce((a, b) => (endOf(b) > endOf(a) ? b : a));
    // Only descend if the child actually reaches near the parent's end; if the
    // parent does meaningful work after all children finish, the path ends here.
    if (endOf(next) <= node.startMs) break;
    path.push(next.id);
    node = next;
  }
  return path;
}

function perServiceTime(
  layout: LaidOutSpan[],
  totalMs: number,
): ServiceTime[] {
  const agg = new Map<string, { totalMs: number; selfMs: number; spanCount: number }>();
  for (const l of layout) {
    const prev = agg.get(l.span.service) ?? { totalMs: 0, selfMs: 0, spanCount: 0 };
    prev.totalMs += l.span.durationMs;
    prev.selfMs += l.selfMs;
    prev.spanCount += 1;
    agg.set(l.span.service, prev);
  }
  const rows: ServiceTime[] = [];
  for (const [service, v] of agg) {
    rows.push({
      service,
      totalMs: v.totalMs,
      selfMs: v.selfMs,
      spanCount: v.spanCount,
      fraction: totalMs > 0 ? v.selfMs / totalMs : 0,
    });
  }
  // Rank by self-time so the heaviest service surfaces first; stable by name.
  rows.sort((a, b) => b.selfMs - a.selfMs || a.service.localeCompare(b.service));
  return rows;
}

export function analyze(trace: Trace): TraceInsights {
  const spans = trace.spans;
  const kids = childMap(spans);
  const roots = kids.get(null) ?? [];

  const minStart = spans.reduce((m, s) => Math.min(m, s.startMs), Infinity);
  const maxEnd = spans.reduce((m, s) => Math.max(m, endOf(s)), -Infinity);
  const totalMs = spans.length > 0 ? maxEnd - minStart : 0;
  const span0 = totalMs > 0 ? totalMs : 1;

  const flat = flatten(kids);
  const layout: LaidOutSpan[] = flat.map(({ span, depth }) => {
    const self = selfTime(span, kids.get(span.id) ?? []);
    return {
      span,
      depth,
      leftFrac: (span.startMs - minStart) / span0,
      widthFrac: span.durationMs / span0,
      selfMs: self,
      hasError: span.status === 'error',
    };
  });

  const slowestSpans = [...layout]
    .sort((a, b) => b.selfMs - a.selfMs || a.span.id.localeCompare(b.span.id))
    .map((l) => l.span.id);

  const errorSpanIds = spans
    .filter((s) => s.status === 'error')
    .map((s) => s.id);

  const perService = perServiceTime(layout, totalMs);

  return {
    trace,
    layout,
    totalMs,
    criticalPath: criticalPath(roots, kids),
    slowestSpans,
    perService,
    errorSpanIds,
    serviceCount: perService.length,
  };
}

// Convenience summary for the trace list, computed without laying out every bar.
export type TraceSummary = {
  id: string;
  name: string;
  totalMs: number;
  spanCount: number;
  serviceCount: number;
  errorCount: number;
};

export function summarize(trace: Trace): TraceSummary {
  const spans = trace.spans;
  const minStart = spans.reduce((m, s) => Math.min(m, s.startMs), Infinity);
  const maxEnd = spans.reduce((m, s) => Math.max(m, endOf(s)), -Infinity);
  const services = new Set(spans.map((s) => s.service));
  return {
    id: trace.id,
    name: trace.name,
    totalMs: spans.length > 0 ? maxEnd - minStart : 0,
    spanCount: spans.length,
    serviceCount: services.size,
    errorCount: spans.filter((s) => s.status === 'error').length,
  };
}
