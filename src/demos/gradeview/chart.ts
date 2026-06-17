// Hand-rolled chart geometry for the GradeView SVG views. These are the scales
// and path builders the project writes directly against rather than reaching
// for a chart library: a linear x over weeks, a linear y over mastery, a line
// generator, and an area generator for the percentile bands.

import { WEEKS } from './data';
import type { Band } from './compute';

export const CHART = {
  w: 540,
  h: 240,
  pad: { l: 34, r: 16, t: 14, b: 26 },
};

export const innerW = CHART.w - CHART.pad.l - CHART.pad.r;
export const innerH = CHART.h - CHART.pad.t - CHART.pad.b;

// Linear scales. xAt maps a week index to an x pixel, yAt maps a 0..1 mastery
// value to a y pixel (inverted so higher mastery sits higher on the chart).
export function xAt(week: number): number {
  return CHART.pad.l + (week / (WEEKS - 1)) * innerW;
}

export function yAt(value: number): number {
  return CHART.pad.t + (1 - value) * innerH;
}

// Line generator: a polyline through one mastery series.
export function linePath(series: number[]): string {
  return series
    .map((v, w) => `${w === 0 ? 'M' : 'L'} ${xAt(w).toFixed(1)} ${yAt(v).toFixed(1)}`)
    .join(' ');
}

// Area generator for a percentile band: trace the upper edge left to right, then
// the lower edge right to left, and close. Used for p10-p90 and p25-p75.
export function bandPath(upper: number[], lower: number[]): string {
  const top = upper.map((v, w) => `${w === 0 ? 'M' : 'L'} ${xAt(w).toFixed(1)} ${yAt(v).toFixed(1)}`);
  const bottom = lower.map((v, w) => `L ${xAt(w).toFixed(1)} ${yAt(v).toFixed(1)}`);
  return `${top.join(' ')} ${bottom.reverse().join(' ')} Z`;
}

// Convenience: pull the upper/lower edges of a band pair from the percentile
// rows. outer is p10-p90, inner is p25-p75.
export function bandEdges(bands: Band[], which: 'outer' | 'inner'): { upper: number[]; lower: number[] } {
  if (which === 'outer') {
    return { upper: bands.map((b) => b.p90), lower: bands.map((b) => b.p10) };
  }
  return { upper: bands.map((b) => b.p75), lower: bands.map((b) => b.p25) };
}

// Map a client x pixel (from a pointer event) back to the nearest week index,
// clamped to the chart, for the draggable week-range handles.
export function weekFromClientX(clientX: number, rect: DOMRect): number {
  const px = ((clientX - rect.left) / rect.width) * CHART.w;
  const w = Math.round(((px - CHART.pad.l) / innerW) * (WEEKS - 1));
  return Math.max(0, Math.min(WEEKS - 1, w));
}
