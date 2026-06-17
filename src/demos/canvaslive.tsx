import { useEffect, useRef, useState } from 'react';
import '../styles/demo.css';
import './canvaslive.css';
import {
  addShape,
  canRedoNow,
  canUndoNow,
  clearAll,
  deleteShape,
  getSnapshot,
  redoAction,
  reorderBackward,
  reorderForward,
  reorderToBack,
  reorderToFront,
  resetAll,
  select,
  setShapes,
  undoAction,
  updateShape,
} from './canvaslive/store';
import { useCanvasStore } from './canvaslive/state';
import { boundingBox, hitTest, moveShape, resizeShape } from './canvaslive/engine';
import { toJSON, toSVG } from './canvaslive/export';
import { HANDLE_IDS, type HandleId, type Point, type Shape } from './canvaslive/types';

// In-browser whiteboard editor. The document (shapes plus selection) lives in a
// localStorage-backed external store; this component renders it as an SVG canvas
// and turns pointer gestures into store edits. All geometry, hit-testing, and
// z-order math runs through the pure engine, so the render path stays a function
// of store state. A pointer drag on a shape moves it; a drag on a selection
// handle resizes it; a single gesture is committed to undo history on release.

const CANVAS_W = 720;
const CANVAS_H = 460;

// Active pointer gesture. move drags the whole shape; resize drags one handle.
type Drag =
  | { mode: 'move'; id: string; start: Point; origin: Shape }
  | { mode: 'resize'; id: string; handle: HandleId; start: Point; origin: Shape }
  | null;

// Map a pointer event to canvas coordinates using the SVG element's box, so the
// math is correct regardless of how the canvas is scaled in the page.
function toCanvasPoint(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  const rect = svg.getBoundingClientRect();
  const sx = CANVAS_W / rect.width;
  const sy = CANVAS_H / rect.height;
  return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
}

export default function CanvasliveDemo() {
  const { doc } = useCanvasStore();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<Drag>(null);
  const [dragging, setDragging] = useState(false);

  const [exportFmt, setExportFmt] = useState<'none' | 'json' | 'svg'>('none');
  const [copied, setCopied] = useState(false);

  const selected = doc.shapes.find((s) => s.id === doc.selectedId) ?? null;
  const ordered = [...doc.shapes].sort((a, b) => a.z - b.z);
  const selBox = selected ? boundingBox([selected]) : null;
  const undoable = canUndoNow();
  const redoable = canRedoNow();

  // Keyboard history shortcuts. Cmd/Ctrl+Z undoes; adding Shift redoes. The
  // listener skips events from form fields so typing in the inspector is safe.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoAction();
        else undoAction();
        return;
      }
      // Delete or Backspace removes the current selection when no field is focused.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const id = getSnapshot().doc.selectedId;
        if (id) {
          e.preventDefault();
          deleteShape(id);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const exportText =
    exportFmt === 'json'
      ? toJSON(doc.shapes)
      : exportFmt === 'svg'
        ? toSVG(doc.shapes)
        : '';

  async function copyExport() {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be blocked; the textarea stays selectable as a fallback.
    }
  }

  // Handlers read the live store snapshot rather than closing over the rendered
  // doc, so a mid-gesture pointer move always patches the freshest shapes array
  // and the React Compiler can memoize without a stale dependency.
  function onCanvasPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const p = toCanvasPoint(svg, e.clientX, e.clientY);
    const hit = hitTest(getSnapshot().doc.shapes, p);
    if (hit) {
      select(hit.id);
      dragRef.current = { mode: 'move', id: hit.id, start: p, origin: hit };
      setDragging(true);
      svg.setPointerCapture(e.pointerId);
    } else {
      select(null);
    }
  }

  function onHandlePointerDown(e: React.PointerEvent<SVGRectElement>, handle: HandleId) {
    e.stopPropagation();
    const svg = svgRef.current;
    const current = getSnapshot().doc;
    const target = current.shapes.find((s) => s.id === current.selectedId);
    if (!svg || !target) return;
    const p = toCanvasPoint(svg, e.clientX, e.clientY);
    dragRef.current = {
      mode: 'resize',
      id: target.id,
      handle,
      start: p,
      origin: target,
    };
    setDragging(true);
    svg.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    const svg = svgRef.current;
    if (!drag || !svg) return;
    const p = toCanvasPoint(svg, e.clientX, e.clientY);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    const next =
      drag.mode === 'move'
        ? moveShape(drag.origin, dx, dy)
        : resizeShape(drag.origin, drag.handle, dx, dy);
    // Transient update mid-gesture: no undo commit until release.
    setShapes(
      getSnapshot().doc.shapes.map((s) => (s.id === drag.id ? next : s)),
      false,
    );
  }

  function endDrag() {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    // Commit the final geometry as one undo step.
    setShapes(getSnapshot().doc.shapes, true);
  }

  return (
    <div className="demo cl">
      <span className="demo__tag">Whiteboard Editor</span>
      <h3 className="demo__title">CanvasLive</h3>
      <p className="demo__lede">
        Add shapes, then click to select, drag to move, and pull a handle to
        resize. The document is kept in your browser and restored on reload.
      </p>

      <p className="demo__hint cl__status" role="status" aria-live="polite">
        {doc.shapes.length === 0
          ? 'Empty canvas'
          : `${doc.shapes.length} shape${doc.shapes.length === 1 ? '' : 's'}` +
            (selected ? `, ${selected.kind} selected` : ', none selected')}
      </p>

      <div className="demo__controls cl__toolbar" role="toolbar" aria-label="Add shapes">
        <button type="button" className="demo__btn" onClick={() => addShape('rect')}>
          Rectangle
        </button>
        <button type="button" className="demo__btn" onClick={() => addShape('ellipse')}>
          Ellipse
        </button>
        <button type="button" className="demo__btn" onClick={() => addShape('line')}>
          Line
        </button>
        <button type="button" className="demo__btn" onClick={() => addShape('text')}>
          Text
        </button>
      </div>

      <div className="demo__controls cl__actions" role="toolbar" aria-label="Document actions">
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={() => undoAction()}
          disabled={!undoable}
          aria-keyshortcuts="Control+Z Meta+Z"
        >
          Undo
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={() => redoAction()}
          disabled={!redoable}
          aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
        >
          Redo
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={() => setExportFmt(exportFmt === 'json' ? 'none' : 'json')}
          aria-pressed={exportFmt === 'json'}
        >
          Export JSON
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={() => setExportFmt(exportFmt === 'svg' ? 'none' : 'svg')}
          aria-pressed={exportFmt === 'svg'}
        >
          Export SVG
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={() => clearAll()}
          disabled={doc.shapes.length === 0}
        >
          Clear
        </button>
        <button type="button" className="demo__btn demo__btn--ghost" onClick={() => resetAll()}>
          Reset
        </button>
      </div>

      <div className="cl__layout">
        <div className="cl__stage">
          <svg
            ref={svgRef}
            className="cl__canvas"
            viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
            role="img"
            aria-label={`Canvas with ${doc.shapes.length} shapes`}
            data-dragging={dragging ? 'true' : 'false'}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {ordered.map((s) => (
              <ShapeNode key={s.id} shape={s} selected={s.id === doc.selectedId} />
            ))}

            {selBox && selected ? (
              <g className="cl__selection" pointerEvents="none">
                <rect
                  className="cl__selbox"
                  x={selBox.x}
                  y={selBox.y}
                  width={selBox.w}
                  height={selBox.h}
                  fill="none"
                />
                {HANDLE_IDS.map((h) => {
                  const pos = handlePosition(selBox, h);
                  return (
                    <rect
                      key={h}
                      className="cl__handle"
                      x={pos.x - 5}
                      y={pos.y - 5}
                      width={10}
                      height={10}
                      pointerEvents="all"
                      onPointerDown={(ev) => onHandlePointerDown(ev, h)}
                    />
                  );
                })}
              </g>
            ) : null}
          </svg>
        </div>

        <aside className="cl__inspector glass" aria-label="Inspector">
          {selected ? (
            <Inspector shape={selected} />
          ) : (
            <p className="demo__hint cl__empty">Add a shape, then click it to edit.</p>
          )}
        </aside>
      </div>

      {exportFmt !== 'none' ? (
        <div className="cl__export glass">
          <div className="cl__export-head">
            <h4 className="cl__inspector-title">
              {exportFmt === 'json' ? 'JSON export' : 'SVG export'}
            </h4>
            <button type="button" className="demo__btn" onClick={() => copyExport()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <textarea
            className="cl__export-text"
            readOnly
            value={exportText}
            aria-label={`${exportFmt.toUpperCase()} export, read only`}
            onFocus={(e) => e.currentTarget.select()}
            rows={8}
          />
        </div>
      ) : null}
    </div>
  );
}

// Edit panel for the selected shape. Each control writes straight to the store
// as a committed edit, so every change is independently undoable.
function Inspector({ shape }: { shape: Shape }) {
  return (
    <div className="cl__inspector-body">
      <h4 className="cl__inspector-title">
        {shape.kind.charAt(0).toUpperCase() + shape.kind.slice(1)}
      </h4>

      {shape.kind === 'text' ? (
        <label className="cl__field">
          <span>Text</span>
          <input
            type="text"
            value={shape.text}
            onChange={(e) => updateShape(shape.id, { text: e.target.value })}
          />
        </label>
      ) : null}

      {shape.kind !== 'line' && shape.kind !== 'text' ? (
        <label className="cl__field">
          <span>Fill</span>
          <input
            type="color"
            value={toHex(shape.fill)}
            onChange={(e) => updateShape(shape.id, { fill: e.target.value })}
          />
        </label>
      ) : null}

      <label className="cl__field">
        <span>Stroke</span>
        <input
          type="color"
          value={toHex(shape.stroke)}
          onChange={(e) => updateShape(shape.id, { stroke: e.target.value })}
        />
      </label>

      <div className="cl__dims">
        <label className="cl__field cl__field--num">
          <span>Width</span>
          <input
            type="number"
            value={Math.round(shape.w)}
            onChange={(e) => updateShape(shape.id, { w: Number(e.target.value) })}
          />
        </label>
        <label className="cl__field cl__field--num">
          <span>Height</span>
          <input
            type="number"
            value={Math.round(shape.h)}
            onChange={(e) => updateShape(shape.id, { h: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="cl__zrow" role="group" aria-label="Layer order">
        <button type="button" className="demo__btn demo__btn--ghost" onClick={() => reorderToFront(shape.id)}>
          To front
        </button>
        <button type="button" className="demo__btn demo__btn--ghost" onClick={() => reorderForward(shape.id)}>
          Forward
        </button>
        <button type="button" className="demo__btn demo__btn--ghost" onClick={() => reorderBackward(shape.id)}>
          Backward
        </button>
        <button type="button" className="demo__btn demo__btn--ghost" onClick={() => reorderToBack(shape.id)}>
          To back
        </button>
      </div>

      <button type="button" className="demo__btn cl__delete" onClick={() => deleteShape(shape.id)}>
        Delete shape
      </button>
    </div>
  );
}

// Color inputs require a #rrggbb value. Pass hex through; map anything else
// (named colors, rgba fills) to a readable default so the picker still opens.
function toHex(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  return '#3df0ff';
}

// Position of one handle on the selection box edge or corner.
function handlePosition(
  b: { x: number; y: number; w: number; h: number },
  h: HandleId,
): Point {
  const midX = b.x + b.w / 2;
  const midY = b.y + b.h / 2;
  switch (h) {
    case 'nw':
      return { x: b.x, y: b.y };
    case 'n':
      return { x: midX, y: b.y };
    case 'ne':
      return { x: b.x + b.w, y: b.y };
    case 'e':
      return { x: b.x + b.w, y: midY };
    case 'se':
      return { x: b.x + b.w, y: b.y + b.h };
    case 's':
      return { x: midX, y: b.y + b.h };
    case 'sw':
      return { x: b.x, y: b.y + b.h };
    case 'w':
      return { x: b.x, y: midY };
  }
}

// Render one shape as the appropriate SVG primitive. Pointer handling lives on
// the canvas, so these are presentational and ignore their own pointer events.
function ShapeNode({ shape, selected }: { shape: Shape; selected: boolean }) {
  const sel = selected ? 'true' : 'false';
  if (shape.kind === 'rect') {
    return (
      <rect
        x={shape.x}
        y={shape.y}
        width={Math.max(0, shape.w)}
        height={Math.max(0, shape.h)}
        rx={6}
        fill={shape.fill}
        stroke={shape.stroke}
        strokeWidth={2}
        data-selected={sel}
      />
    );
  }
  if (shape.kind === 'ellipse') {
    return (
      <ellipse
        cx={shape.x + shape.w / 2}
        cy={shape.y + shape.h / 2}
        rx={Math.abs(shape.w / 2)}
        ry={Math.abs(shape.h / 2)}
        fill={shape.fill}
        stroke={shape.stroke}
        strokeWidth={2}
        data-selected={sel}
      />
    );
  }
  if (shape.kind === 'line') {
    return (
      <line
        x1={shape.x}
        y1={shape.y}
        x2={shape.x + shape.w}
        y2={shape.y + shape.h}
        stroke={shape.stroke}
        strokeWidth={2}
        strokeLinecap="round"
        data-selected={sel}
      />
    );
  }
  return (
    <text x={shape.x} y={shape.y + 22} className="cl__text" fill={shape.stroke} data-selected={sel}>
      {shape.text}
    </text>
  );
}
