// The flow engine. Everything here is a pure function over a Flow: there is no
// eval and no dynamic code. The runner walks the directed graph from the start
// node, presenting messages and choices and following the selected option's
// target. The validator reports unreachable nodes, dead ends, broken
// references, and whether a cycle exists.

import type {
  BrokenRef,
  ChoiceNode,
  Flow,
  FlowNode,
  ValidationReport,
} from './types';

// Build an id -> node lookup once per walk.
function indexNodes(flow: Flow): Map<string, FlowNode> {
  const map = new Map<string, FlowNode>();
  for (const node of flow.nodes) map.set(node.id, node);
  return map;
}

export function getNode(flow: Flow, id: string | null): FlowNode | undefined {
  if (id === null) return undefined;
  return flow.nodes.find((n) => n.id === id);
}

// The set of node ids a single node points to, ignoring null and itself-only
// semantics. Used by both reachability and cycle detection so the graph is
// described in exactly one place.
export function outgoing(node: FlowNode): string[] {
  if (node.kind === 'message') {
    return node.next === null ? [] : [node.next];
  }
  if (node.kind === 'choice') {
    return node.options
      .map((o) => o.to)
      .filter((to): to is string => to !== null);
  }
  return [];
}

// ---------- the runner ----------

// One presented step of a play-through: the node the runner is currently on.
// The caller advances by choosing an option (for choice nodes) or stepping
// forward (for message nodes).
export interface RunStep {
  node: FlowNode;
  done: boolean;
}

// Resolve where the runner moves to from `node` given an optional option id.
// For a choice node, `optionId` selects the branch; for a message node the
// option id is ignored and `next` is followed. Returns the next node id or null
// when the walk should stop.
export function advance(
  node: FlowNode,
  optionId: string | null,
): string | null {
  if (node.kind === 'message') return node.next;
  if (node.kind === 'choice') {
    const opt = node.options.find((o) => o.id === optionId);
    return opt ? opt.to : null;
  }
  return null;
}

// ---------- validation ----------

// Reachability via breadth-first walk from the start node, following every
// outgoing edge that resolves to a real node.
function reachableFrom(flow: Flow, index: Map<string, FlowNode>): Set<string> {
  const seen = new Set<string>();
  if (flow.start === null || !index.has(flow.start)) return seen;
  const queue: string[] = [flow.start];
  seen.add(flow.start);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const node = index.get(id);
    if (!node) continue;
    for (const to of outgoing(node)) {
      if (index.has(to) && !seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return seen;
}

// Depth-first cycle detection over the resolvable edges of the whole graph.
function detectCycle(flow: Flow, index: Map<string, FlowNode>): boolean {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const node of flow.nodes) color.set(node.id, WHITE);

  // Iterative DFS so deep flows cannot overflow the call stack.
  function visit(startId: string): boolean {
    const stack: { id: string; enter: boolean }[] = [
      { id: startId, enter: true },
    ];
    while (stack.length > 0) {
      const frame = stack.pop() as { id: string; enter: boolean };
      if (!frame.enter) {
        color.set(frame.id, BLACK);
        continue;
      }
      if (color.get(frame.id) === GREY) return true;
      if (color.get(frame.id) === BLACK) continue;
      color.set(frame.id, GREY);
      stack.push({ id: frame.id, enter: false });
      const node = index.get(frame.id);
      if (!node) continue;
      for (const to of outgoing(node)) {
        if (!index.has(to)) continue;
        if (color.get(to) === GREY) return true;
        if (color.get(to) === WHITE) stack.push({ id: to, enter: true });
      }
    }
    return false;
  }

  for (const node of flow.nodes) {
    if (color.get(node.id) === WHITE && visit(node.id)) return true;
  }
  return false;
}

// Collect every edge that points at a node id not present in the flow.
function findBrokenRefs(
  flow: Flow,
  index: Map<string, FlowNode>,
): BrokenRef[] {
  const broken: BrokenRef[] = [];
  for (const node of flow.nodes) {
    if (node.kind === 'message') {
      if (node.next !== null && !index.has(node.next)) {
        broken.push({ nodeId: node.id, optionId: null, missingId: node.next });
      }
    } else if (node.kind === 'choice') {
      const choice = node as ChoiceNode;
      for (const opt of choice.options) {
        if (opt.to !== null && !index.has(opt.to)) {
          broken.push({
            nodeId: node.id,
            optionId: opt.id,
            missingId: opt.to,
          });
        }
      }
    }
  }
  return broken;
}

// A node is a dead end when it is not an end node and has no usable outgoing
// edge that resolves to a real node. A choice node with no options, or whose
// options all point nowhere, is a dead end too.
function findDeadEnds(flow: Flow, index: Map<string, FlowNode>): string[] {
  const dead: string[] = [];
  for (const node of flow.nodes) {
    if (node.kind === 'end') continue;
    const resolvable = outgoing(node).filter((to) => index.has(to));
    if (resolvable.length === 0) dead.push(node.id);
  }
  return dead;
}

export function validate(flow: Flow): ValidationReport {
  const index = indexNodes(flow);
  const reachable = reachableFrom(flow, index);

  const unreachable = flow.nodes
    .filter((n) => !reachable.has(n.id))
    .map((n) => n.id);
  const deadEnds = findDeadEnds(flow, index);
  const brokenRefs = findBrokenRefs(flow, index);
  const hasCycle = detectCycle(flow, index);

  const ok =
    flow.start !== null &&
    index.has(flow.start) &&
    unreachable.length === 0 &&
    deadEnds.length === 0 &&
    brokenRefs.length === 0;

  return { unreachable, deadEnds, brokenRefs, hasCycle, ok };
}
