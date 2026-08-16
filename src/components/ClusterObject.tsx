import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { projects } from '../data/projects';
import { buildCells, cellPosition, CELL, GAP, type ClusterCell } from '../lib/cluster';
import ClusterPoster from './ClusterPoster';

type Props = {
  onSelect?: (name: string) => void;
  onHover?: (cell: ClusterCell | null, clientX: number, clientY: number) => void;
  className?: string;
  reducedMotion?: boolean;
  scrollProgress?: number;
};

const LIME = new THREE.Color('#cdf53a');
const LIME_SOFT = new THREE.Color('#e6ff7a');
const GRAPHITE = new THREE.Color('#1e221e');
const GRAPHITE_LIT = new THREE.Color('#3a4a1e');
const CAP_DARK = new THREE.Color('#353b33');
const CAP_HOVER = new THREE.Color('#eef1e4');

const BASE_YAW = -0.42;
const BASE_PITCH = 0.0;
const SPIN = 0.045; // rad per second
const LIFT = 0.28; // world units a hovered block rises

type Shared = {
  pointer: { x: number; y: number };
  scroll: { p: number };
};

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (c.getContext('webgl2') || c.getContext('webgl')),
    );
  } catch {
    return false;
  }
}

class Boundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

type SceneProps = {
  cells: ClusterCell[];
  sharedRef: RefObject<Shared>;
  reduced: boolean;
  onHover?: Props['onHover'];
  onSelect?: Props['onSelect'];
};

function Slab({ cells, sharedRef, reduced, onHover, onSelect }: SceneProps) {
  const group = useRef<THREE.Group>(null);
  const blocks = useRef<THREE.InstancedMesh>(null);
  const caps = useRef<THREE.InstancedMesh>(null);
  const hovered = useRef(-1);
  const lastReport = useRef(0);
  const liftRef = useRef<Float32Array | null>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmp = useMemo(() => new THREE.Color(), []);
  const { camera, size } = useThree();

  // Narrow canvases (phones) get a closer camera so the slab keeps its presence.
  useLayoutEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const k = aspect < 1.7 ? 0.78 : 1;
    camera.position.set(0, 16 * k, 24 * k);
    camera.lookAt(0, 0.2, 0);
  }, [camera, size]);

  const writeBlock = useCallback(
    (i: number, cell: ClusterCell, l: number) => {
      const b = blocks.current;
      const c = caps.current;
      if (!b || !c) return;
      const [x, , z] = cellPosition(cell);
      const y = l * LIFT;
      dummy.position.set(x, cell.height / 2 + y, z);
      dummy.scale.set(CELL - GAP, cell.height, CELL - GAP);
      dummy.updateMatrix();
      b.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, cell.height + y + 0.012, z);
      dummy.scale.set(CELL - GAP, 0.024, CELL - GAP);
      dummy.updateMatrix();
      c.setMatrixAt(i, dummy.matrix);
      const baseBody = cell.lit ? GRAPHITE_LIT : GRAPHITE;
      const baseCap = cell.lit ? LIME : CAP_DARK;
      b.setColorAt(i, tmp.copy(baseBody).lerp(LIME_SOFT, l * 0.55));
      c.setColorAt(i, tmp.copy(baseCap).lerp(CAP_HOVER, l));
    },
    [dummy, tmp],
  );

  useLayoutEffect(() => {
    cells.forEach((cell, i) => writeBlock(i, cell, 0));
    for (const m of [blocks.current, caps.current]) {
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      (m.material as THREE.Material).needsUpdate = true;
    }
  }, [cells, writeBlock]);

  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
    };
  }, []);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const shared = sharedRef.current;
    const lift = liftRef.current ?? (liftRef.current = new Float32Array(cells.length));
    const t = state.clock.elapsedTime;
    const px = reduced ? 0 : shared.pointer.x;
    const py = reduced ? 0 : shared.pointer.y;
    const spin = reduced ? 0 : t * SPIN;
    const targetY = BASE_YAW + spin + shared.scroll.p * 0.35 + px * 0.14;
    const targetX = BASE_PITCH + py * -0.1 + shared.scroll.p * 0.06;
    const k = 1 - Math.exp(-dt * 6);
    g.rotation.y += (targetY - g.rotation.y) * k;
    g.rotation.x += (targetX - g.rotation.x) * k;

    // Animate only blocks that are moving toward or away from the hovered state.
    let touched = false;
    const rate = 1 - Math.exp(-dt * 12);
    for (let i = 0; i < cells.length; i++) {
      const target = i === hovered.current ? 1 : 0;
      const cur = lift[i];
      if (Math.abs(cur - target) < 0.002) {
        if (cur !== target) {
          lift[i] = target;
          writeBlock(i, cells[i], target);
          touched = true;
        }
        continue;
      }
      lift[i] = cur + (target - cur) * rate;
      writeBlock(i, cells[i], lift[i]);
      touched = true;
    }
    if (touched) {
      for (const m of [blocks.current, caps.current]) {
        if (!m) continue;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  });

  const setHovered = (id: number, e: ThreeEvent<PointerEvent>) => {
    const now = performance.now();
    if (id !== hovered.current) {
      hovered.current = id;
      document.body.style.cursor = id >= 0 ? 'pointer' : '';
      onHover?.(id >= 0 ? cells[id] : null, e.clientX, e.clientY);
      lastReport.current = now;
    } else if (id >= 0 && now - lastReport.current > 40) {
      onHover?.(cells[id], e.clientX, e.clientY);
      lastReport.current = now;
    }
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(e.instanceId ?? -1, e);
  };
  const onOut = (e: ThreeEvent<PointerEvent>) => {
    setHovered(-1, e);
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    const id = e.instanceId;
    if (id === undefined) return;
    e.stopPropagation();
    onSelect?.(cells[id].name);
  };

  return (
    <group ref={group} rotation={[BASE_PITCH, BASE_YAW, 0]}>
      <instancedMesh
        ref={blocks}
        args={[undefined, undefined, cells.length]}
        onPointerMove={onMove}
        onPointerOut={onOut}
        onClick={onClick}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.55} metalness={0.35} />
      </instancedMesh>
      <instancedMesh ref={caps} args={[undefined, undefined, cells.length]} raycast={() => null}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.35} metalness={0.2} />
      </instancedMesh>
    </group>
  );
}

function Lights() {
  return (
    <>
      <hemisphereLight args={["#454a40", "#0b0c0a", 0.7]} />
      <ambientLight intensity={0.16} />
      <directionalLight position={[-6, 9, 4]} intensity={2.4} color="#cdf53a" />
      <directionalLight position={[8, 6, -6]} intensity={0.9} color="#dfe6ff" />
    </>
  );
}

export default function ClusterObject({
  onSelect,
  onHover,
  className,
  reducedMotion = false,
  scrollProgress = 0,
}: Props) {
  const cells = useMemo(() => buildCells(projects), []);
  const [webgl] = useState(() => (typeof window === 'undefined' ? false : hasWebGL()));
  const [inView, setInView] = useState(true);
  const wrap = useRef<HTMLDivElement>(null);
  const shared = useRef<Shared>({ pointer: { x: 0, y: 0 }, scroll: { p: 0 } });

  useEffect(() => {
    shared.current.scroll.p = scrollProgress;
  }, [scrollProgress]);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: '80px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = wrap.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    shared.current.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    shared.current.pointer.y = ((e.clientY - r.top) / r.height) * 2 - 1;
  };
  const onPointerLeave = () => {
    shared.current.pointer.x = 0;
    shared.current.pointer.y = 0;
  };

  const rootClass = className ? `cluster-object ${className}` : 'cluster-object';
  const poster = <ClusterPoster cells={cells} />;

  if (!webgl || reducedMotion) {
    return (
      <div className={rootClass} style={{ width: '100%', height: '100%' }} aria-hidden="true">
        {poster}
      </div>
    );
  }

  return (
    <div
      ref={wrap}
      className={rootClass}
      style={{ width: '100%', height: '100%' }}
      aria-hidden="true"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <Boundary fallback={poster}>
        <Canvas
          flat
          dpr={[1, 2]}
          frameloop={inView ? 'always' : 'never'}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          camera={{ fov: 30, position: [0, 16, 24], near: 0.1, far: 120 }}
          style={{ background: 'transparent' }}
        >
          <Lights />
          <Slab
            cells={cells}
            sharedRef={shared}
            reduced={reducedMotion}
            onHover={onHover}
            onSelect={onSelect}
          />
        </Canvas>
      </Boundary>
    </div>
  );
}
