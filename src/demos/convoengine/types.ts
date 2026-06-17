// Data model for the in-browser conversation flow builder. A flow is a set of
// nodes plus a designated start node. There is no code execution anywhere: a
// flow is plain data, and the runner only ever follows option targets that
// reference other node ids. This keeps the whole thing a pure, safe walk over a
// directed graph (no eval, no dynamic dispatch).

// Every node carries an id, a kind, and a human label used in lists and the
// validation panel.
export type NodeKind = 'message' | 'choice' | 'end';

// A message node shows text, then advances to a single next node (or ends the
// script when `next` is null and the node is not an end node, which the
// validator flags as a dead end).
export interface MessageNode {
  id: string;
  kind: 'message';
  label: string;
  text: string;
  next: string | null;
}

// One labelled branch out of a choice node. `to` is the id of the node the
// runner moves to when this option is selected.
export interface ChoiceOption {
  id: string;
  label: string;
  to: string | null;
}

// A choice node shows a prompt and a set of labelled options, each pointing at
// a next node.
export interface ChoiceNode {
  id: string;
  kind: 'choice';
  label: string;
  text: string;
  options: ChoiceOption[];
}

// A terminal node. Reaching it ends the script.
export interface EndNode {
  id: string;
  kind: 'end';
  label: string;
  text: string;
}

export type FlowNode = MessageNode | ChoiceNode | EndNode;

export interface Flow {
  nodes: FlowNode[];
  start: string | null;
}

// ---------- validation result shapes ----------

// A reference from a node (or one of its options) to a node id that does not
// exist in the flow.
export interface BrokenRef {
  nodeId: string;
  // For choice nodes this names the offending option; for message nodes it is
  // null because the bad reference is the node's own `next`.
  optionId: string | null;
  missingId: string;
}

export interface ValidationReport {
  // Non-start nodes that nothing points to: the runner can never reach them.
  unreachable: string[];
  // Non-end nodes with no usable outgoing edge: the walk stops with nowhere to
  // go.
  deadEnds: string[];
  // Edges that point at a node id not present in the flow.
  brokenRefs: BrokenRef[];
  // Whether the directed graph contains a cycle (reported for authoring
  // awareness; cycles are legal in a flow).
  hasCycle: boolean;
  // True when there are no unreachable nodes, dead ends, or broken refs and a
  // start node is set.
  ok: boolean;
}
