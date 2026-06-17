// Core types for the distributed-trace waterfall viewer. A trace is a set of
// spans; each span records the service that ran it, where it sits in the call
// tree (parentId), when it started relative to the trace root (startMs) and how
// long it ran (durationMs). The engine derives layout, the critical path,
// slowest spans, per-service time and error spans from these primitives alone.

export type SpanStatus = 'ok' | 'error';

export type Span = {
  id: string;
  name: string;
  service: string;
  // null for the root span; otherwise the id of the enclosing span.
  parentId: string | null;
  // Offset from the trace start, in milliseconds.
  startMs: number;
  durationMs: number;
  status: SpanStatus;
};

export type Trace = {
  id: string;
  name: string;
  spans: Span[];
};

// A span placed in the waterfall: tree depth plus its bar geometry expressed as
// fractions (0..1) of the total trace duration, so the view scales to any width.
export type LaidOutSpan = {
  span: Span;
  depth: number;
  // Fraction of the trace duration at which the bar starts and its width.
  leftFrac: number;
  widthFrac: number;
  // Time spent in this span but not in any of its children (self-time).
  selfMs: number;
  hasError: boolean;
};

export type ServiceTime = {
  service: string;
  totalMs: number;
  selfMs: number;
  spanCount: number;
  fraction: number;
};

export type TraceInsights = {
  trace: Trace;
  layout: LaidOutSpan[];
  // End-to-end duration of the trace, from the earliest start to the latest end.
  totalMs: number;
  // Ordered span ids forming the chain that determines end-to-end latency.
  criticalPath: string[];
  // Span ids ranked by self-time, slowest first.
  slowestSpans: string[];
  perService: ServiceTime[];
  errorSpanIds: string[];
  serviceCount: number;
};
