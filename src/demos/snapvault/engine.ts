// Pure pipeline builder mirroring the real snapvault flow: chunk a dataset
// into content-addressed blocks, dedup identical content, take an incremental
// snapshot that adds exactly one new chunk, place replicated copies across
// simulated nodes deterministically by content hash, fail a node, and plan a
// verified restore from the survivors. Everything is a function of the fixed
// chunk contents; no randomness and no wall clock anywhere.

import { fnv1a32, shortHex } from './hash';
import type {
  ChunkRef,
  FileRow,
  NodeState,
  Pipeline,
  RestoreStep,
  SnapshotStats,
} from './types';

const NODES = 5;
const REPLICAS = 3;
const FAIL_NODE = 2;

// The mock dataset as (file, chunk contents). copy.bin duplicates data.bin
// byte-for-byte and logs.txt shares its first chunk with notes.md, which is
// what gives the first snapshot its dedup collapse.
const V1: [string, string[]][] = [
  ['notes.md', ['notes-part-1', 'notes-part-2', 'notes-part-3']],
  ['data.bin', ['data-block-1', 'data-block-2', 'data-block-3', 'data-block-4']],
  ['copy.bin', ['data-block-1', 'data-block-2', 'data-block-3', 'data-block-4']],
  ['logs.txt', ['notes-part-1', 'log-seg-1', 'log-seg-2']],
];

// v2 edits one chunk of notes.md; every other content is unchanged, so the
// incremental snapshot stores exactly one new chunk.
const V2: [string, string[]][] = V1.map(([name, chunks]) =>
  name === 'notes.md'
    ? [name, ['notes-part-1', 'notes-part-2-edited', 'notes-part-3']]
    : [name, [...chunks]],
);

function snapshot(
  spec: [string, string[]][],
  store: Set<string>,
  name: string,
): { files: FileRow[]; stats: SnapshotStats; unique: string[] } {
  const files: FileRow[] = [];
  const unique: string[] = [];
  let refs = 0;
  let fresh = 0;
  for (const [file, contents] of spec) {
    const rows: ChunkRef[] = [];
    for (const content of contents) {
      refs += 1;
      const seen = store.has(content);
      if (!seen) {
        store.add(content);
        fresh += 1;
      }
      rows.push({ file, hash: shortHex(content), dedup: seen, fresh: false });
    }
    files.push({ name: file, refs: rows });
  }
  for (const content of store) unique.push(shortHex(content));
  return {
    files,
    stats: { name, refs, newChunks: fresh, deduped: refs - fresh },
    unique,
  };
}

// Deterministic placement: replica offsets from the content hash, all nodes
// distinct. Offsets 0, 1, 3 are pairwise distinct mod 5.
function placement(hash: string): number[] {
  const h = fnv1a32(hash);
  const start = h % NODES;
  return [start, (start + 1) % NODES, (start + 3) % NODES].slice(0, REPLICAS);
}

export function buildPipeline(): Pipeline {
  const store = new Set<string>();
  const v1 = snapshot(V1, store, 'v1');

  // Incremental: same store, so unchanged content dedups against v1.
  const v2 = snapshot(V2, store, 'v2');
  // Mark the single fresh chunk in the v2 view.
  for (const f of v2.files) {
    for (const r of f.refs) {
      if (r.hash === shortHex('notes-part-2-edited')) r.fresh = true;
    }
  }

  // v2's manifest addresses every chunk it references, old and new.
  const manifest = Array.from(
    new Set(v2.files.flatMap((f) => f.refs.map((r) => r.hash))),
  );

  const nodes: NodeState[] = Array.from({ length: NODES }, (_, id) => ({
    id,
    up: true,
    chunks: [],
  }));
  for (const hash of manifest) {
    for (const n of placement(hash)) nodes[n].chunks.push(hash);
  }

  // Restore after FAIL_NODE goes down: each chunk is fetched from its first
  // surviving replica and re-hashed on arrival.
  const restore: RestoreStep[] = manifest.map((hash) => {
    const fromNode = placement(hash).find((n) => n !== FAIL_NODE);
    return { hash, fromNode: fromNode ?? -1, verified: true };
  });

  const dedupRatio =
    Math.round((v1.stats.refs / Math.max(1, v1.stats.newChunks)) * 100) / 100;

  return {
    v1Files: v1.files,
    v1: v1.stats,
    v2Files: v2.files,
    v2: v2.stats,
    dedupRatio,
    uniqueChunks: manifest,
    nodes,
    replicas: REPLICAS,
    failNode: FAIL_NODE,
    restore,
  };
}
