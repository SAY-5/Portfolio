// Core gateway domain model. The configurator side of an API platform: routes
// map an incoming path prefix to an upstream and carry per-route admission
// policy (auth requirement, per-key rate limit), and API keys are the
// credentials a caller presents. Everything is a plain, serialisable shape so
// the pure engine can decide admission deterministically and the UI never has
// to guess at a free-text field.

// A route binds a path prefix to a single upstream service and the policy that
// guards it. Matching is longest-prefix: '/v1/users' wins over '/v1' for a
// request to '/v1/users/42'. rateLimit is requests-per-window for one key on
// this route; 0 means unlimited.
export type Route = {
  id: string;
  prefix: string;
  upstream: string;
  requiresAuth: boolean;
  rateLimit: number;
};

// An API key a caller presents via the gateway. Inactive keys are known but
// suspended: they authenticate as a real key yet are refused (403) rather than
// treated as anonymous (401).
export type ApiKey = {
  id: string;
  label: string;
  active: boolean;
};

// The four terminal gateway outcomes, mirroring HTTP status codes.
//  200 routed   admitted and forwarded to the upstream
//  401 missing or unknown key on a route that requires auth
//  403 known but inactive key
//  429 admitted by auth but over the per-key rate limit for the window
export type Status = 200 | 401 | 403 | 429;

// Why a route did or did not match, and which one did. matched is null when no
// route prefix covered the path (a 404-shaped miss, surfaced as 401/200 by the
// caller depending on whether the gateway has a catch-all).
export type RouteMatch = {
  route: Route | null;
  // Every route whose prefix the path started with, longest first. Exposed so
  // the UI can show why a particular route won the match.
  candidates: Route[];
};

// A single admission decision. reason is a short human sentence the UI shows
// verbatim; windowCount is the request's position in its key+route window so
// the traffic view can render usage without recomputing.
export type Decision = {
  status: Status;
  reason: string;
  match: RouteMatch;
  keyId: string | null;
  windowCount: number;
  limit: number;
};

// One persisted request attempt plus the decision it produced.
export type LogEntry = {
  id: string;
  path: string;
  keyId: string | null;
  status: Status;
  reason: string;
  routeId: string | null;
  window: number;
  at: number;
};

// A simulated incoming request: a path and an optional presented key.
export type RequestInput = {
  path: string;
  keyId: string | null;
};
