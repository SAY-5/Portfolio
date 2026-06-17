// Pure dependency engine for the dev-services manager. Everything here is a
// deterministic function of (services, target): there is no eval, no clock, no
// randomness. The UI calls these to compute start order, validate new
// dependency edges, decide what a stop should touch, and surface port
// conflicts. Keeping the graph logic isolated makes it trivial to reason about
// and test.

import type { CycleError, PortConflict, Service } from './types';

// Index services by id for O(1) lookup, ignoring dangling ids defensively.
function index(services: Service[]): Map<string, Service> {
  const map = new Map<string, Service>();
  for (const s of services) map.set(s.id, s);
  return map;
}

// Depth-first topological sort over the dependency graph. Returns ids ordered
// so that every dependency precedes the service that needs it. Assumes the
// graph is acyclic; addDependency guards against ever creating a cycle, so a
// stored graph is always sortable. Visiting is stable (input order) so the
// result is deterministic.
export function topoOrder(services: Service[]): string[] {
  const byId = index(services);
  const visited = new Set<string>();
  const order: string[] = [];

  const visit = (id: string, stack: Set<string>): void => {
    if (visited.has(id)) return;
    if (stack.has(id)) return; // defensive: ignore a cycle rather than loop
    stack.add(id);
    const svc = byId.get(id);
    if (svc) {
      for (const dep of svc.dependsOn) {
        if (byId.has(dep)) visit(dep, stack);
      }
    }
    stack.delete(id);
    visited.add(id);
    order.push(id);
  };

  for (const s of services) visit(s.id, new Set());
  return order;
}

// All ids that must be running for `id` to run: its transitive dependencies in
// start order, with `id` itself appended last. Used both to start a single
// service (start each in turn) and to preview the chain in the dependency view.
export function startChain(services: Service[], id: string): string[] {
  const byId = index(services);
  if (!byId.has(id)) return [];
  const needed = new Set<string>();

  const collect = (cur: string, stack: Set<string>): void => {
    if (needed.has(cur) || stack.has(cur)) return;
    stack.add(cur);
    const svc = byId.get(cur);
    if (svc) {
      for (const dep of svc.dependsOn) {
        if (byId.has(dep)) collect(dep, stack);
      }
    }
    stack.delete(cur);
    needed.add(cur);
  };
  collect(id, new Set());

  // Order the needed set topologically so dependencies come first.
  return topoOrder(services).filter((sid) => needed.has(sid));
}

// Would adding edge from -> to (from dependsOn to) create a cycle? It does when
// `to` already reaches `from` through the existing graph, because the new edge
// would close that path. Returns the offending path for the UI, or null if the
// edge is safe. Also rejects a self-dependency.
export function findCycle(
  services: Service[],
  from: string,
  to: string,
): CycleError | null {
  if (from === to) return { from, to, path: [to, from] };
  const byId = index(services);
  if (!byId.has(from) || !byId.has(to)) return null;

  // Search from `to` along dependsOn edges looking for `from`.
  const path: string[] = [];
  const seen = new Set<string>();

  const reaches = (cur: string): boolean => {
    if (cur === from) {
      path.push(cur);
      return true;
    }
    if (seen.has(cur)) return false;
    seen.add(cur);
    const svc = byId.get(cur);
    if (svc) {
      for (const dep of svc.dependsOn) {
        if (byId.has(dep) && reaches(dep)) {
          path.push(cur);
          return true;
        }
      }
    }
    return false;
  };

  if (reaches(to)) {
    // path is from -> ... -> to (built leaf-first); present it to -> ... -> from
    return { from, to, path: [...path].reverse() };
  }
  return null;
}

// Direct dependents: services that list `id` in their dependsOn.
export function directDependents(services: Service[], id: string): string[] {
  return services.filter((s) => s.dependsOn.includes(id)).map((s) => s.id);
}

// Running dependents of `id`, transitively. Stopping `id` would orphan these,
// so the store either blocks the stop or stops this set first depending on the
// cascade flag. Ordered so dependents stop before their dependencies (the
// reverse of start order).
export function runningDependents(services: Service[], id: string): string[] {
  const byId = index(services);
  const found = new Set<string>();

  const collect = (cur: string): void => {
    for (const s of services) {
      if (s.dependsOn.includes(cur) && !found.has(s.id)) {
        if (s.status === 'running' || s.status === 'starting') {
          found.add(s.id);
          collect(s.id);
        }
      }
    }
  };
  collect(id);

  // Reverse topological order: a dependent appears before the service it needs.
  return topoOrder(services)
    .filter((sid) => found.has(sid) && byId.has(sid))
    .reverse();
}

// Detect ports claimed by more than one service. Returns one entry per
// conflicted port, deterministically ordered by port number.
export function portConflicts(services: Service[]): PortConflict[] {
  const byPort = new Map<number, string[]>();
  for (const s of services) {
    const list = byPort.get(s.port) ?? [];
    list.push(s.id);
    byPort.set(s.port, list);
  }
  const conflicts: PortConflict[] = [];
  for (const [port, serviceIds] of byPort) {
    if (serviceIds.length > 1) conflicts.push({ port, serviceIds });
  }
  return conflicts.sort((a, b) => a.port - b.port);
}

// Ids of every service whose port collides with another, for quick membership
// checks when rendering a service tile.
export function conflictedServiceIds(services: Service[]): Set<string> {
  const ids = new Set<string>();
  for (const c of portConflicts(services)) {
    for (const id of c.serviceIds) ids.add(id);
  }
  return ids;
}
