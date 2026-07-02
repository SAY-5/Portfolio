import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './snapvault.css';
import { buildPipeline } from './snapvault/engine';

// Real mechanism from snapvault: files chunk into content-addressed blocks,
// identical content is stored once (the dedup collapse), an incremental
// snapshot adds exactly one new chunk for a one-file edit, chunks replicate
// across simulated nodes by content hash, and after a node failure the
// parallel restore re-hashes every chunk fetched from the survivors before
// declaring the restored tree intact. The pipeline is a pure function of the
// fixed chunk contents, so every run is identical.
const ease = [0.22, 1, 0.36, 1] as const;

type Phase =
  | 'idle'
  | 'chunk'
  | 'edit'
  | 'replicate'
  | 'fail'
  | 'restore'
  | 'done';

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'ready',
  chunk: 'snapshot v1: chunk and dedup',
  edit: 'snapshot v2: incremental',
  replicate: 'distribute with replication',
  fail: 'node failure',
  restore: 'parallel verified restore',
  done: 'integrity verdict',
};

export default function SnapvaultDemo() {
  const reduce = useReducedMotion();
  const pipeline = useMemo(() => buildPipeline(), []);
  const [phase, setPhase] = useState<Phase>('idle');
  const [blocksShown, setBlocksShown] = useState(0);
  const [nodesShown, setNodesShown] = useState(0);
  const [restored, setRestored] = useState(0);
  const timers = useRef<number[]>([]);

  const totalBlocks = pipeline.v1.refs;
  const copies = pipeline.nodes.reduce((n, node) => n + node.chunks.length, 0);
  const files = phase === 'chunk' ? pipeline.v1Files : pipeline.v2Files;
  const failed = phase === 'fail' || phase === 'restore' || phase === 'done';

  function clearAll() {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearAll, []);

  function later(fn: () => void, ms: number) {
    const id = window.setTimeout(fn, reduce ? 0 : ms);
    timers.current.push(id);
  }

  function reset() {
    clearAll();
    setPhase('idle');
    setBlocksShown(0);
    setNodesShown(0);
    setRestored(0);
  }

  function run() {
    if (phase !== 'idle' && phase !== 'done') return;
    reset();
    setPhase('chunk');
    for (let i = 1; i <= totalBlocks; i++) later(() => setBlocksShown(i), i * 90);
    later(() => setPhase('edit'), totalBlocks * 90 + 700);
    const tEdit = totalBlocks * 90 + 1600;
    later(() => {
      setPhase('replicate');
      for (let i = 1; i <= pipeline.nodes.length; i++)
        later(() => setNodesShown(i), i * 220);
    }, tEdit);
    const tFail = tEdit + pipeline.nodes.length * 220 + 700;
    later(() => setPhase('fail'), tFail);
    const tRestore = tFail + 900;
    later(() => {
      setPhase('restore');
      for (let i = 1; i <= pipeline.restore.length; i++)
        later(() => setRestored(i), i * 200);
      later(() => setPhase('done'), pipeline.restore.length * 200 + 500);
    }, tRestore);
  }

  let blockIdx = 0;

  return (
    <div className="demo" aria-label="snapvault backup and restore demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Dedup, replicate, survive, verify</h3>
      <p className="demo__lede">
        Run the pipeline: files chunk into content-hashed blocks that dedup on
        identical content, a one-file edit adds exactly one new chunk, the
        chunks replicate across {pipeline.nodes.length} nodes, then a node
        fails and the restore re-hashes every chunk from the survivors before
        the integrity verdict.
      </p>

      <div className="sv__phase mono" aria-live="polite">
        <span className="sv__phase-dot" data-live={phase !== 'idle'} />
        {PHASE_LABEL[phase]}
      </div>

      <div className="sv__stage">
        <div className="sv__panel">
          <div className="sv__panel-head">
            <span className="sv__panel-title">
              {phase === 'chunk' || phase === 'idle' ? 'snapshot v1' : 'snapshot v2'}
            </span>
            <span className="sv__panel-meta">
              {phase === 'idle' && 'content-addressed store'}
              {phase === 'chunk' &&
                `${Math.min(blocksShown, totalBlocks)}/${pipeline.v1.refs} refs, dedup ${pipeline.dedupRatio}x`}
              {phase !== 'idle' &&
                phase !== 'chunk' &&
                `${pipeline.v2.refs} refs, ${pipeline.v2.newChunks} new chunk, ${pipeline.v2.deduped} deduped`}
            </span>
          </div>
          <div className="sv__files">
            {files.map((f) => (
              <div className="sv__file" key={f.name}>
                <span className="sv__file-name">{f.name}</span>
                <span className="sv__blocks">
                  {f.refs.map((r, i) => {
                    const idx = blockIdx++;
                    const visible = phase !== 'idle' && (phase !== 'chunk' || idx < blocksShown);
                    return (
                      <motion.span
                        key={f.name + i}
                        className={
                          'sv__block' +
                          (r.dedup ? ' sv__block--dup' : '') +
                          (r.fresh && phase !== 'chunk' ? ' sv__block--fresh' : '')
                        }
                        initial={false}
                        animate={{ opacity: visible ? 1 : 0, scale: visible ? 1 : 0.8 }}
                        transition={{ duration: 0.22, ease }}
                      >
                        {r.hash}
                        {r.dedup && <em>dup</em>}
                        {r.fresh && phase !== 'chunk' && <em>new</em>}
                      </motion.span>
                    );
                  })}
                </span>
              </div>
            ))}
          </div>
          <p className="sv__store-line mono">
            {phase === 'idle'
              ? 'identical chunks are stored once'
              : phase === 'chunk'
                ? `${pipeline.v1.newChunks} chunks stored for ${pipeline.v1.refs} refs, ${pipeline.v1.deduped} deduped`
                : `the one edited file adds exactly ${pipeline.v2.newChunks} new chunk`}
          </p>
        </div>

        <div className="sv__panel">
          <div className="sv__panel-head">
            <span className="sv__panel-title">node grid</span>
            <span className="sv__panel-meta">
              {nodesShown > 0
                ? `${pipeline.uniqueChunks.length} chunks × ${pipeline.replicas} replicas = ${copies} copies`
                : `replication ${pipeline.replicas}, placement by content hash`}
            </span>
          </div>
          <div className="sv__nodes">
            {pipeline.nodes.map((n) => {
              const down = failed && n.id === pipeline.failNode;
              const visible = n.id < nodesShown;
              return (
                <motion.div
                  key={n.id}
                  className={'sv__node' + (down ? ' sv__node--down' : '')}
                  initial={false}
                  animate={{ opacity: visible ? 1 : 0.15, y: visible ? 0 : 6 }}
                  transition={{ duration: 0.3, ease }}
                >
                  <span className="sv__node-name">
                    node {n.id}
                    <b>{down ? 'DOWN' : 'up'}</b>
                  </span>
                  <span className="sv__node-chunks">
                    {n.chunks.map((h, i) => (
                      <span className="sv__chip" key={h + i}>
                        {h.slice(0, 4)}
                      </span>
                    ))}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </div>

        <div className="sv__panel">
          <div className="sv__panel-head">
            <span className="sv__panel-title">verified restore</span>
            <span className="sv__panel-meta">
              {restored > 0
                ? `${restored}/${pipeline.restore.length} chunks re-hashed`
                : 'fetch from survivors, hash on arrival'}
            </span>
          </div>
          <ul className="sv__restore">
            {pipeline.restore.slice(0, restored).map((s) => (
              <motion.li
                key={s.hash}
                className="sv__step"
                initial={reduce ? false : { opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.22, ease }}
              >
                <span className="sv__step-hash">{s.hash}</span>
                <span className="sv__step-from">from node {s.fromNode}</span>
                <span className="sv__step-ok">hash ok ✓</span>
              </motion.li>
            ))}
            {restored === 0 && (
              <li className="sv__step sv__step--empty">
                {failed ? 'restoring…' : 'runs after the node failure'}
              </li>
            )}
          </ul>
        </div>

        <AnimatePresence>
          {phase === 'done' && (
            <motion.div
              className="sv__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="sv__verdict-head">
                node failure survived, integrity verified
              </span>
              <span className="sv__verdict-text">
                All {pipeline.restore.length} chunks were fetched from surviving
                replicas and re-hashed against their content addresses, so the
                restored tree matches the original byte-for-byte even with node{' '}
                {pipeline.failNode} down.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={run}
          disabled={phase !== 'idle' && phase !== 'done'}
        >
          {phase === 'idle' || phase === 'done' ? 'Run pipeline' : 'Running…'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={phase === 'idle'}
        >
          Reset
        </button>
        <span className="demo__hint">
          {phase === 'done'
            ? 'same contents, same hashes, same result'
            : `${pipeline.v1.refs} chunk refs, ${pipeline.v1.newChunks} unique`}
        </span>
      </div>
    </div>
  );
}
