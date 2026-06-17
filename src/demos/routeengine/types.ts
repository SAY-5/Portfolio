// Shared shapes for the in-browser delivery route planner. The depot and every
// stop live on a 0..100 grid so the same coordinates drive both the SVG map and
// the distance math. Nothing here talks to a server.

export const GRID_MIN = 0;
export const GRID_MAX = 100;

// A point on the grid. The depot reuses this shape with a fixed id.
export type Point = {
  x: number;
  y: number;
};

// A delivery stop. The id is stable across reorders so React keys and the route
// (a list of ids) stay valid when stops are added or removed.
export type Stop = Point & {
  id: string;
  label: string;
};

export const DEPOT_ID = 'depot';

// One leg of a route: the straight-line hop from `from` to `to` and its length.
export type Leg = {
  from: string;
  to: string;
  distance: number;
};

// A computed route: the visiting order of stop ids (depot is implicit at both
// ends), the per-leg breakdown, and the total round-trip distance.
export type Route = {
  order: string[];
  legs: Leg[];
  total: number;
};
