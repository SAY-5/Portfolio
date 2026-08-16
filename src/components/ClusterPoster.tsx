import { useMemo } from 'react';
import { projects } from '../data/projects';
import { buildCells, cellPosition, CELL, GAP, type ClusterCell } from '../lib/cluster';

type Props = {
  className?: string;
  cells?: ClusterCell[];
};

// 2:1 isometric projection. U is the screen half-width of one cell, V the screen height of one world unit.
const U = 12;
const V = 11;
const HALF = (CELL - GAP) / 2;
const PAD = 10;

const LIME = '#cdf53a';
const TOP = '#1e211d';
const LEFT = '#121412';
const RIGHT = '#0e100e';

type Face = { points: string; fill: string; stroke?: string };
type Scene = { faces: Face[]; viewBox: string; glow: { cx: number; cy: number; rx: number; ry: number } };

function project(px: number, pz: number, h: number): [number, number] {
  return [(px - pz) * U, (px + pz) * (U / 2) - h * V];
}

function poly(points: Array<[number, number]>): string {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function buildScene(cells: ClusterCell[]): Scene {
  const faces: Face[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const track = (p: [number, number]) => {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  };

  // Back to front so nearer blocks paint over farther ones.
  const ordered = [...cells].sort((a, b) => a.col + a.row - (b.col + b.row));

  for (const cell of ordered) {
    const [x, , z] = cellPosition(cell);
    const h = cell.height;
    const aT = project(x - HALF, z - HALF, h);
    const bT = project(x + HALF, z - HALF, h);
    const cT = project(x + HALF, z + HALF, h);
    const dT = project(x - HALF, z + HALF, h);
    const bG = project(x + HALF, z - HALF, 0);
    const cG = project(x + HALF, z + HALF, 0);
    const dG = project(x - HALF, z + HALF, 0);
    [aT, bT, cT, dT, bG, cG, dG].forEach(track);

    faces.push({ points: poly([dT, cT, cG, dG]), fill: LEFT });
    faces.push({ points: poly([cT, bT, bG, cG]), fill: RIGHT });
    faces.push({
      points: poly([aT, bT, cT, dT]),
      fill: cell.lit ? LIME : TOP,
      stroke: cell.lit ? LIME : undefined,
    });
  }

  const cx = (minX + maxX) / 2;
  const cy = maxY - (maxY - minY) * 0.18;
  return {
    faces,
    viewBox: `${(minX - PAD).toFixed(1)} ${(minY - PAD).toFixed(1)} ${(maxX - minX + PAD * 2).toFixed(1)} ${(maxY - minY + PAD * 2).toFixed(1)}`,
    glow: { cx, cy, rx: (maxX - minX) * 0.46, ry: (maxY - minY) * 0.22 },
  };
}

export default function ClusterPoster({ className, cells }: Props) {
  const scene = useMemo(() => buildScene(cells ?? buildCells(projects)), [cells]);

  return (
    <svg
      className={className ? `cluster-poster ${className}` : 'cluster-poster'}
      viewBox={scene.viewBox}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-hidden="true"
      focusable="false"
    >
      <ellipse
        cx={scene.glow.cx.toFixed(1)}
        cy={scene.glow.cy.toFixed(1)}
        rx={scene.glow.rx.toFixed(1)}
        ry={scene.glow.ry.toFixed(1)}
        fill={LIME}
        fillOpacity={0.08}
      />
      <g shapeRendering="geometricPrecision" strokeLinejoin="round">
        {scene.faces.map((face, i) => (
          <polygon
            key={i}
            points={face.points}
            fill={face.fill}
            stroke={face.stroke}
            strokeWidth={face.stroke ? 1 : undefined}
            strokeOpacity={face.stroke ? 0.7 : undefined}
            vectorEffect={face.stroke ? 'non-scaling-stroke' : undefined}
          />
        ))}
      </g>
    </svg>
  );
}
