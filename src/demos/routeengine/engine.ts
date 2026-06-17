// Safe, deterministic route engine for the delivery planner. No eval, no
// network, no clock: given a depot and a set of stops it builds a Euclidean
// distance matrix, constructs a nearest-neighbour tour from the depot through
// every stop and back, improves it with a 2-opt pass, and reports the total and
// per-leg distances. The same inputs always produce the same route.

import { DEPOT_ID, type Leg, type Point, type Route, type Stop } from './types';

// Straight-line distance between two grid points.
export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// A node in the working tour: the depot plus every stop, indexed for the matrix.
type Node = Point & { id: string };

function buildNodes(depot: Point, stops: Stop[]): Node[] {
  const depotNode: Node = { id: DEPOT_ID, x: depot.x, y: depot.y };
  const stopNodes: Node[] = stops.map((s) => ({ id: s.id, x: s.x, y: s.y }));
  return [depotNode, ...stopNodes];
}

// Full symmetric distance matrix over the node list, computed once and reused by
// both the nearest-neighbour build and the 2-opt swaps.
export function distanceMatrix(nodes: Point[]): number[][] {
  const n = nodes.length;
  const m: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = distance(nodes[i], nodes[j]);
      m[i][j] = d;
      m[j][i] = d;
    }
  }
  return m;
}

// Sum the closed-tour length for an ordering of node indices. The order is a
// permutation of all indices starting at the depot (index 0); the closing leg
// back to the depot is added here.
function tourLength(order: number[], m: number[][]): number {
  let total = 0;
  for (let i = 0; i < order.length - 1; i++) {
    total += m[order[i]][order[i + 1]];
  }
  if (order.length > 1) {
    total += m[order[order.length - 1]][order[0]];
  }
  return total;
}

// Nearest-neighbour tour: start at the depot, repeatedly hop to the closest
// not-yet-visited node. Ties break on the lower index, which keeps the result
// deterministic regardless of input ordering quirks.
function nearestNeighbourOrder(m: number[][]): number[] {
  const n = m.length;
  if (n <= 1) return n === 1 ? [0] : [];
  const visited = new Array<boolean>(n).fill(false);
  const order: number[] = [0];
  visited[0] = true;
  let current = 0;
  for (let step = 1; step < n; step++) {
    let best = -1;
    let bestDist = Infinity;
    for (let j = 0; j < n; j++) {
      if (visited[j]) continue;
      const d = m[current][j];
      if (d < bestDist) {
        bestDist = d;
        best = j;
      }
    }
    visited[best] = true;
    order.push(best);
    current = best;
  }
  return order;
}

// 2-opt improvement: repeatedly reverse a tour segment when doing so shortens
// the closed tour. The depot is pinned at position 0, so swaps only touch the
// stop positions. Runs to a local optimum; deterministic because it always
// takes the first improving move in a fixed scan order.
function twoOpt(order: number[], m: number[][]): number[] {
  const n = order.length;
  if (n < 4) return order.slice();
  const route = order.slice();
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const a = route[i - 1];
        const b = route[i];
        const c = route[k];
        const d = route[(k + 1) % n];
        const before = m[a][b] + m[c][d];
        const after = m[a][c] + m[b][d];
        if (after + 1e-9 < before) {
          let lo = i;
          let hi = k;
          while (lo < hi) {
            const tmp = route[lo];
            route[lo] = route[hi];
            route[hi] = tmp;
            lo++;
            hi--;
          }
          improved = true;
        }
      }
    }
  }
  return route;
}

// Turn an ordering of node indices into a Route over ids, including the closing
// leg back to the depot.
function toRoute(order: number[], nodes: Node[], m: number[][]): Route {
  const legs: Leg[] = [];
  let total = 0;
  for (let i = 0; i < order.length; i++) {
    const fromIdx = order[i];
    const toIdx = order[(i + 1) % order.length];
    if (order.length > 1) {
      const d = m[fromIdx][toIdx];
      legs.push({ from: nodes[fromIdx].id, to: nodes[toIdx].id, distance: d });
      total += d;
    }
  }
  return { order: order.map((i) => nodes[i].id), legs, total };
}

// The naive route: depot, then stops in their given order, then back. Used as
// the baseline the optimizer improves on.
export function naiveRoute(depot: Point, stops: Stop[]): Route {
  const nodes = buildNodes(depot, stops);
  const m = distanceMatrix(nodes);
  const order = nodes.map((_, i) => i);
  return toRoute(order, nodes, m);
}

// The optimized route: nearest-neighbour build followed by a 2-opt pass.
export function optimizeRoute(depot: Point, stops: Stop[]): Route {
  const nodes = buildNodes(depot, stops);
  const m = distanceMatrix(nodes);
  const nn = nearestNeighbourOrder(m);
  const improved = twoOpt(nn, m);
  // Guard: keep whichever of the two is shorter so optimize never regresses.
  const better = tourLength(improved, m) <= tourLength(nn, m) ? improved : nn;
  return toRoute(better, nodes, m);
}
