// Shared types for the in-browser REST console. Everything here is plain data:
// requests the user composes, responses the mock router returns, and the saved
// collection plus history entries persisted to localStorage. No value in this
// module ever reaches a real network.

export type Method = 'GET' | 'POST';

export type KeyValue = {
  // A stable id so the editor rows keep their identity across edits without
  // keying React on array index.
  id: string;
  key: string;
  value: string;
  enabled: boolean;
};

// A request the user is building or has saved. Query params and headers are
// edited as key/value rows; the body is a raw JSON string the user types.
export type RequestDraft = {
  method: Method;
  path: string;
  query: KeyValue[];
  headers: KeyValue[];
  body: string;
};

// A named entry in the saved collection.
export type SavedRequest = {
  id: string;
  name: string;
  request: RequestDraft;
};

// The shape the mock router consumes. The console flattens enabled rows into
// these maps before dispatching, so the router never sees disabled rows.
export type MockRequest = {
  method: Method;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  // Parsed JSON body, or undefined when the request has no body. A body that
  // fails to parse is reported before dispatch and never reaches the router.
  body: unknown;
};

export type MockResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  // Always a JSON-serialisable value the viewer pretty-prints.
  body: unknown;
};

// One completed exchange recorded in history: what was sent, what came back,
// how long the router took, and when it ran.
export type HistoryEntry = {
  id: string;
  method: Method;
  path: string;
  status: number;
  durationMs: number;
  at: number;
  request: RequestDraft;
  response: MockResponse;
};
