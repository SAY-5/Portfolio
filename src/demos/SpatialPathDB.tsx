import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './SpatialPathDB.css';

// Real numbers from the project, benchmarked on 42.1M nuclei across 29 TCGA
// BLCA slides. Viewport queries run 2.5x faster (63ms vs 159ms p50) and
// cold-cache 9.1x faster (53ms vs 486ms). Pruning reaches 89% (5.7 of ~59
// sub-partitions scanned). The two-level scheme is LIST(slide_id) over 29
// slides and RANGE(hilbert_key) at ~30 per slide for 857 leaf partitions.
const GRID = 8; // 8x8 = 64 Hilbert cells, close to the ~59 sub-partitions/slide
const CELLS = GRID * GRID;
const PRUNED_P50 = 63; // ms, viewport query with partition pruning
const FULL_P50 = 159; // ms, scanning the whole slide
const COLD_PRUNED = 53;
const COLD_FULL = 486;
const VIEW = 3; // viewport spans 3x3 cells

// Hilbert curve d->(x,y) mapping for an order-3 (8x8) curve. This is the order
// the storage uses to keep spatially close nuclei in adjacent key ranges, so a
// viewport touches a short, contiguous run of partitions.
function d2xy(n: number, d: number): [number, number] {
  let rx: number;
  let ry: number;
  let t = d;
  let x = 0;
  let y = 0;
  for (let s = 1; s < n; s *= 2) {
    rx = 1 & (t / 2);
    ry = 1 & (t ^ rx);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      const tmp = x;
      x = y;
      y = tmp;
    }
    x += s * rx;
    y += s * ry;
    t = Math.floor(t / 4);
  }
  return [x, y];
}

// Precompute the Hilbert key for every grid cell (inverse of d2xy).
function buildKeyGrid(): number[][] {
  const keys: number[][] = Array.from({ length: GRID }, () =>
    new Array(GRID).fill(0),
  );
  for (let d = 0; d < CELLS; d++) {
    const [x, y] = d2xy(GRID, d);
    keys[y][x] = d;
  }
  return keys;
}

// Deterministic scatter of nuclei points per cell so the slide looks dense but
// renders identically every time (no Math.random at render).
function seededPoints(cell: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  let seed = (cell + 1) * 2654435761;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed % 1000) / 1000;
  };
  const count = 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < count; i++) {
    pts.push({ x: rnd(), y: rnd() });
  }
  return pts;
}

const SVG = 420; // px stage
const STEP = SVG / GRID;

export default function SpatialPathDbDemo() {
  const reduce = useReducedMotion();
  const keyGrid = useMemo(buildKeyGrid, []);
  const pointsByCell = useMemo(
    () => Array.from({ length: CELLS }, (_, c) => seededPoints(c)),
    [],
  );
  // viewport top-left in cell coordinates
  const [vp, setVp] = useState({ x: 2, y: 3 });
  const dragRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState(false);

  // Which cells the viewport overlaps: those are the only sub-partitions
  // scanned. Everything else is pruned before any row is read.
  const scanned = useMemo(() => {
    const set = new Set<number>();
    for (let dy = 0; dy < VIEW; dy++) {
      for (let dx = 0; dx < VIEW; dx++) {
        const cx = vp.x + dx;
        const cy = vp.y + dy;
        if (cx < GRID && cy < GRID) set.add(cy * GRID + cx);
      }
    }
    return set;
  }, [vp]);

  // Hilbert keys touched, shown as the contiguous-ish range the planner reads.
  const keysTouched = useMemo(() => {
    const arr: number[] = [];
    scanned.forEach((c) => arr.push(keyGrid[Math.floor(c / GRID)][c % GRID]));
    return arr.sort((a, b) => a - b);
  }, [scanned, keyGrid]);

  const scannedCount = scanned.size;
  const prunePct = Math.round(((CELLS - scannedCount) / CELLS) * 100);
  // Latency interpolates between the pruned p50 and a full scan by how much of
  // the slide the planner had to touch.
  const fraction = scannedCount / CELLS;
  const latency = Math.round(PRUNED_P50 + fraction * (FULL_P50 - PRUNED_P50) * 0.9);

  function clampVp(x: number, y: number) {
    return {
      x: Math.max(0, Math.min(GRID - VIEW, x)),
      y: Math.max(0, Math.min(GRID - VIEW, y)),
    };
  }

  function pointerToCell(e: React.PointerEvent) {
    const svg = dragRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * SVG;
    const py = ((e.clientY - rect.top) / rect.height) * SVG;
    return {
      x: Math.round(px / STEP - VIEW / 2),
      y: Math.round(py / STEP - VIEW / 2),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDragging(true);
    const c = pointerToCell(e);
    if (c) setVp(clampVp(c.x, c.y));
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    const c = pointerToCell(e);
    if (c) setVp(clampVp(c.x, c.y));
  }
  function onPointerUp() {
    setDragging(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const map: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const mv = map[e.key];
    if (mv) {
      e.preventDefault();
      setVp((v) => clampVp(v.x + mv[0], v.y + mv[1]));
    }
  }

  useEffect(() => {
    function up() {
      setDragging(false);
    }
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  return (
    <div className="demo" aria-label="SpatialPathDB viewport partition pruning demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Pan the viewport, watch pruning</h3>
      <p className="demo__lede">
        The slide is laid out along a Hilbert curve so nearby nuclei share
        nearby partition keys. Drag the viewport across the slide: only the
        Hilbert sub-partitions it overlaps get scanned, and the rest are pruned
        before any row is read. The latency tracks how much of the slide the
        planner had to touch.
      </p>

      <div className="sp__stage">
        <div className="sp__slidewrap">
          <svg
            ref={dragRef}
            className={`sp__slide ${dragging ? 'sp__slide--drag' : ''}`}
            viewBox={`0 0 ${SVG} ${SVG}`}
            role="application"
            tabIndex={0}
            aria-label="Drag or use arrow keys to move the query viewport across the slide"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onKeyDown={onKeyDown}
          >
            {/* partition cells */}
            {Array.from({ length: CELLS }).map((_, c) => {
              const cx = c % GRID;
              const cy = Math.floor(c / GRID);
              const hit = scanned.has(c);
              return (
                <rect
                  key={`cell-${c}`}
                  x={cx * STEP}
                  y={cy * STEP}
                  width={STEP}
                  height={STEP}
                  fill={hit ? 'var(--accent-glow)' : 'transparent'}
                  stroke="var(--line)"
                  strokeWidth={0.6}
                  className="sp__cell"
                />
              );
            })}

            {/* nuclei */}
            {Array.from({ length: CELLS }).map((_, c) => {
              const cx = c % GRID;
              const cy = Math.floor(c / GRID);
              const hit = scanned.has(c);
              return pointsByCell[c].map((p, i) => (
                <circle
                  key={`n-${c}-${i}`}
                  cx={(cx + p.x) * STEP}
                  cy={(cy + p.y) * STEP}
                  r={1.5}
                  fill={hit ? 'var(--accent)' : 'var(--paper-faint)'}
                  opacity={hit ? 1 : 0.5}
                />
              ));
            })}

            {/* viewport */}
            <motion.rect
              x={vp.x * STEP}
              y={vp.y * STEP}
              width={VIEW * STEP}
              height={VIEW * STEP}
              rx={4}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2.2}
              className="sp__viewport"
              animate={{ x: vp.x * STEP, y: vp.y * STEP }}
              transition={{ duration: reduce ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
            />
          </svg>
          <div className="sp__hint-row">drag the box or use arrow keys</div>
        </div>

        <div className="sp__side">
          <div className="sp__meters">
            <div className="sp__meter">
              <div className="sp__meter-name">Sub-partitions scanned</div>
              <div className="sp__meter-val">
                {scannedCount}
                <span className="sp__meter-unit">of {CELLS}</span>
              </div>
            </div>
            <div className="sp__meter sp__meter--accent">
              <div className="sp__meter-name">Pruned</div>
              <div className="sp__meter-val">
                {prunePct}
                <span className="sp__meter-unit">%</span>
              </div>
            </div>
            <div className="sp__meter">
              <div className="sp__meter-name">Viewport p50</div>
              <div className="sp__meter-val">
                {latency}
                <span className="sp__meter-unit">ms</span>
              </div>
            </div>
          </div>

          <div className="sp__keys">
            <div className="sp__keys-head">Hilbert keys touched</div>
            <div className="sp__keys-list">
              {keysTouched.map((k) => (
                <span className="sp__key" key={k}>
                  {k}
                </span>
              ))}
            </div>
            <div className="sp__keys-note">
              a short contiguous run, so RANGE(hilbert_key) prunes the rest
            </div>
          </div>
        </div>

        <AnimatePresence>
          {prunePct >= 80 && (
            <motion.div
              className="sp__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
            >
              <span className="sp__verdict-x">{prunePct}% pruned</span>
              <span className="sp__verdict-text">
                On 42.1M nuclei across 29 TCGA slides this pruning makes viewport
                queries 2.5x faster ({PRUNED_P50}ms vs {FULL_P50}ms p50) and{' '}
                {Math.round(COLD_FULL / COLD_PRUNED)}x faster cold-cache (
                {COLD_PRUNED}ms vs {COLD_FULL}ms). Hilbert ordering runs 28%
                faster than Z-order on the same 857-partition layout.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <span className="demo__hint">
          two-level scheme: LIST(slide_id) x RANGE(hilbert_key), 857 leaf
          partitions
        </span>
      </div>
    </div>
  );
}
