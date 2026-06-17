// Pure document serializers. Given the shapes, these build the JSON and the
// standalone SVG strings the editor offers for copy/export. No DOM, no clock:
// the same shapes always produce the same output, which keeps export testable
// and the render path clean.

import type { Shape } from './types';

export const CANVAS_W = 720;
export const CANVAS_H = 460;

// Pretty-printed JSON of the shapes in paint order (ascending z).
export function toJSON(shapes: Shape[]): string {
  const ordered = [...shapes].sort((a, b) => a.z - b.z);
  return JSON.stringify({ version: 1, shapes: ordered }, null, 2);
}

// Escape the five XML-significant characters so user text cannot break the SVG.
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function shapeToSvg(s: Shape): string {
  const fill = escapeXml(s.fill);
  const stroke = escapeXml(s.stroke);
  switch (s.kind) {
    case 'rect':
      return `  <rect x="${s.x}" y="${s.y}" width="${Math.max(0, s.w)}" height="${Math.max(0, s.h)}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="2" />`;
    case 'ellipse':
      return `  <ellipse cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" rx="${Math.abs(s.w / 2)}" ry="${Math.abs(s.h / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`;
    case 'line':
      return `  <line x1="${s.x}" y1="${s.y}" x2="${s.x + s.w}" y2="${s.y + s.h}" stroke="${stroke}" stroke-width="2" stroke-linecap="round" />`;
    case 'text':
      return `  <text x="${s.x}" y="${s.y + 22}" fill="${stroke}" font-family="sans-serif" font-size="18" font-weight="600">${escapeXml(s.text)}</text>`;
  }
}

// A standalone, self-contained SVG document of the whole canvas.
export function toSVG(shapes: Shape[]): string {
  const ordered = [...shapes].sort((a, b) => a.z - b.z);
  const body = ordered.map(shapeToSvg).join('\n');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" width="${CANVAS_W}" height="${CANVAS_H}">`,
    `  <rect x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" fill="#0a0c15" />`,
    body,
    '</svg>',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}
