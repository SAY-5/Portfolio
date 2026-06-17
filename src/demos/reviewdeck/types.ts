// Changeset model for the reviewdeck code-review board.

export type HunkLine = {
  kind: 'added' | 'removed' | 'context';
  text: string;
};

export type FilePatch = {
  path: string;
  added: number;
  removed: number;
  hunks: HunkLine[][];
};

export type Changeset = {
  id: string;
  title: string;
  author: string;
  createdAt: number;
  rawDiff: string;
  patches: FilePatch[];
  status: 'open' | 'merged';
};

export type VerdictKind = 'approve' | 'request-changes';

export type Verdict = {
  id: string;
  changesetId: string;
  reviewer: string;
  kind: VerdictKind;
  comment: string;
  createdAt: number;
};

export type ReviewState = {
  changesets: Changeset[];
  verdicts: Verdict[];
};
