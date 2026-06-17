// Pure, deterministic gateway engine. No eval, no randomness, no real network,
// no clock reads. Admission is a total function of (routes, keys, request,
// window state), so the same inputs always produce the same status and the UI
// can explain every decision.

import type {
  ApiKey,
  Decision,
  RequestInput,
  Route,
  RouteMatch,
  Status,
} from './types';

// ---------- route matching ----------

// True when path lies under prefix on a segment boundary. '/v1/users' covers
// '/v1/users' and '/v1/users/42' but not '/v1/usersX'. The root prefix '/'
// covers everything.
export function prefixCovers(prefix: string, path: string): boolean {
  if (prefix === '/') return path.startsWith('/');
  if (path === prefix) return true;
  return path.startsWith(prefix + '/');
}

// Longest-prefix match. Returns the winning route (or null) and every covering
// route ordered longest-first, so ties resolve by specificity and the UI can
// show the runners-up.
export function matchRoute(routes: Route[], path: string): RouteMatch {
  const candidates = routes
    .filter((r) => prefixCovers(r.prefix, path))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  return { route: candidates[0] ?? null, candidates };
}

// ---------- rate limiting ----------

// Fixed-window counter key. A request is counted per (apiKey, route) within the
// current window. The window number is supplied by the caller (a settable
// virtual clock), never read from a real clock here.
export function windowKey(keyId: string, routeId: string, window: number): string {
  return `${keyId}::${routeId}::${window}`;
}

// Given how many requests this key+route has already made in the current
// window, decide whether one more is admitted. limit 0 means unlimited.
export function withinLimit(used: number, limit: number): boolean {
  if (limit <= 0) return true;
  return used < limit;
}

// ---------- admission ----------

// Decide a single request. counts maps a windowKey to the number of admitted
// requests already recorded for it in the current window; the caller advances
// the window and persists counts. This function only reads counts, it does not
// mutate them, so it stays pure and testable.
export function decide(
  routes: Route[],
  keys: ApiKey[],
  req: RequestInput,
  window: number,
  counts: Record<string, number>,
): Decision {
  const match = matchRoute(routes, req.path);
  const route = match.route;

  // No route covers this path: nothing to forward to.
  if (!route) {
    return {
      status: 401 as Status,
      reason: `No route matches ${req.path}`,
      match,
      keyId: req.keyId,
      windowCount: 0,
      limit: 0,
    };
  }

  const key = req.keyId ? keys.find((k) => k.id === req.keyId) ?? null : null;

  // Auth gate. A route that requires auth refuses anonymous or unknown keys
  // with 401, and known-but-suspended keys with 403.
  if (route.requiresAuth) {
    if (!key) {
      return {
        status: 401 as Status,
        reason: req.keyId
          ? `Unknown API key on ${route.prefix}`
          : `${route.prefix} requires an API key`,
        match,
        keyId: req.keyId,
        windowCount: 0,
        limit: route.rateLimit,
      };
    }
    if (!key.active) {
      return {
        status: 403 as Status,
        reason: `Key ${key.label} is inactive`,
        match,
        keyId: key.id,
        windowCount: 0,
        limit: route.rateLimit,
      };
    }
  }

  // Rate gate. Only keyed traffic is metered; an open route with no key is not
  // rate limited because there is no key to meter against.
  const meterKeyId = key ? key.id : null;
  if (meterKeyId && route.rateLimit > 0) {
    const used = counts[windowKey(meterKeyId, route.id, window)] ?? 0;
    if (!withinLimit(used, route.rateLimit)) {
      return {
        status: 429 as Status,
        reason: `Rate limit reached: ${used}/${route.rateLimit} in window ${window}`,
        match,
        keyId: meterKeyId,
        windowCount: used,
        limit: route.rateLimit,
      };
    }
    return {
      status: 200 as Status,
      reason: `Routed to ${route.upstream}`,
      match,
      keyId: meterKeyId,
      windowCount: used + 1,
      limit: route.rateLimit,
    };
  }

  return {
    status: 200 as Status,
    reason: `Routed to ${route.upstream}`,
    match,
    keyId: meterKeyId,
    windowCount: 0,
    limit: route.rateLimit,
  };
}
