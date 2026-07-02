// Shared types for the snapvault demo. The whole pipeline is derived from
// fixed chunk contents through a content hash, so every shape here is data,
// not state: no clocks, no randomness.

export type ChunkRef = {
  file: string;
  // content-address of the chunk, short hex for display
  hash: string;
  // true when this reference's content was already in the store, so the chunk
  // is not stored again (the dedup collapse)
  dedup: boolean;
  // true when this chunk is the single new chunk of the incremental snapshot
  fresh: boolean;
};

export type FileRow = {
  name: string;
  refs: ChunkRef[];
};

export type SnapshotStats = {
  name: string;
  refs: number;
  newChunks: number;
  deduped: number;
};

export type NodeState = {
  id: number;
  up: boolean;
  // hashes of the chunk copies placed on this node
  chunks: string[];
};

export type RestoreStep = {
  hash: string;
  // node the chunk is fetched from once the failed node is skipped
  fromNode: number;
  verified: boolean;
};

export type Pipeline = {
  // v1 snapshot view of the dataset, dedup flags set
  v1Files: FileRow[];
  v1: SnapshotStats;
  // v2 after editing one file: exactly one fresh chunk
  v2Files: FileRow[];
  v2: SnapshotStats;
  dedupRatio: number;
  uniqueChunks: string[];
  nodes: NodeState[];
  replicas: number;
  failNode: number;
  restore: RestoreStep[];
};
