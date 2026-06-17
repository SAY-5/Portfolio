import { useMemo, useState } from 'react';
import '../styles/demo.css';
import './convoengine.css';
import type { ChoiceNode, Flow, FlowNode, MessageNode } from './convoengine/types';
import { advance, getNode, validate } from './convoengine/engine';
import {
  addNode,
  addOption,
  deleteNode,
  deleteOption,
  resetFlow,
  setMessageNext,
  setNodeLabel,
  setNodeText,
  setOptionLabel,
  setOptionTarget,
  setStart,
  useFlow,
} from './convoengine/store';

// A target picker shared by message `next` and choice option targets. It lists
// every node in the flow plus an explicit "ends here" entry (null target).
function TargetSelect({
  value,
  nodes,
  selfId,
  onChange,
  label,
}: {
  value: string | null;
  nodes: FlowNode[];
  selfId: string;
  onChange: (to: string | null) => void;
  label: string;
}) {
  return (
    <label className="ceb__target">
      <span className="ceb__target-label">{label}</span>
      <select
        className="ceb__select"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">ends here</option>
        {nodes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.label} ({n.id}){n.id === selfId ? ' [self]' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

function MessageEditor({ node, nodes }: { node: MessageNode; nodes: FlowNode[] }) {
  return (
    <div className="ceb__body">
      <label className="ceb__field">
        <span className="ceb__field-label">Message text</span>
        <textarea
          className="ceb__textarea"
          value={node.text}
          rows={2}
          placeholder="What this step says"
          onChange={(e) => setNodeText(node.id, e.target.value)}
        />
      </label>
      <TargetSelect
        label="Then go to"
        value={node.next}
        nodes={nodes}
        selfId={node.id}
        onChange={(to) => setMessageNext(node.id, to)}
      />
    </div>
  );
}

function ChoiceEditor({ node, nodes }: { node: ChoiceNode; nodes: FlowNode[] }) {
  return (
    <div className="ceb__body">
      <label className="ceb__field">
        <span className="ceb__field-label">Prompt text</span>
        <textarea
          className="ceb__textarea"
          value={node.text}
          rows={2}
          placeholder="What this step asks"
          onChange={(e) => setNodeText(node.id, e.target.value)}
        />
      </label>
      <div className="ceb__options" role="group" aria-label="Choice options">
        {node.options.map((opt) => (
          <div className="ceb__option" key={opt.id}>
            <label className="ceb__field ceb__field--grow">
              <span className="ceb__field-label">Option label</span>
              <input
                className="ceb__input"
                value={opt.label}
                placeholder="Option label"
                onChange={(e) => setOptionLabel(node.id, opt.id, e.target.value)}
              />
            </label>
            <TargetSelect
              label="Leads to"
              value={opt.to}
              nodes={nodes}
              selfId={node.id}
              onChange={(to) => setOptionTarget(node.id, opt.id, to)}
            />
            <button
              type="button"
              className="ceb__icon-btn"
              aria-label={`Delete option ${opt.label}`}
              onClick={() => deleteOption(node.id, opt.id)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="demo__btn demo__btn--ghost"
        onClick={() => addOption(node.id)}
      >
        Add option
      </button>
    </div>
  );
}

function NodeCard({
  node,
  nodes,
  isStart,
}: {
  node: FlowNode;
  nodes: FlowNode[];
  isStart: boolean;
}) {
  return (
    <li className="ceb__node" data-kind={node.kind} data-start={isStart}>
      <div className="ceb__node-head">
        <span className="ceb__kind" data-kind={node.kind}>
          {node.kind}
        </span>
        <input
          className="ceb__input ceb__node-label"
          value={node.label}
          aria-label={`Label for node ${node.id}`}
          onChange={(e) => setNodeLabel(node.id, e.target.value)}
        />
        <code className="ceb__id">{node.id}</code>
        <div className="ceb__node-actions">
          <button
            type="button"
            className="ceb__pill"
            data-on={isStart}
            aria-pressed={isStart}
            onClick={() => setStart(node.id)}
          >
            {isStart ? 'Start node' : 'Set start'}
          </button>
          <button
            type="button"
            className="ceb__icon-btn"
            aria-label={`Delete node ${node.label}`}
            onClick={() => deleteNode(node.id)}
          >
            Delete
          </button>
        </div>
      </div>
      {node.kind === 'message' && <MessageEditor node={node} nodes={nodes} />}
      {node.kind === 'choice' && <ChoiceEditor node={node} nodes={nodes} />}
      {node.kind === 'end' && (
        <div className="ceb__body">
          <label className="ceb__field">
            <span className="ceb__field-label">Closing text</span>
            <textarea
              className="ceb__textarea"
              value={node.text}
              rows={2}
              placeholder="Final message"
              onChange={(e) => setNodeText(node.id, e.target.value)}
            />
          </label>
        </div>
      )}
    </li>
  );
}

// Live validation summary. Re-derives from the flow on every change and lists
// the offending node ids for each problem class so the author can fix them.
function ValidationPanel({ nodes }: { nodes: FlowNode[] }) {
  const flow = useFlow();
  const report = useMemo(() => validate(flow), [flow]);
  const labelOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of nodes) map.set(n.id, n.label);
    return (id: string) => map.get(id) ?? id;
  }, [nodes]);

  const clean =
    report.unreachable.length === 0 &&
    report.deadEnds.length === 0 &&
    report.brokenRefs.length === 0 &&
    flow.start !== null;

  return (
    <section className="ceb__validation" aria-label="Validation issues">
      <div className="ceb__val-head">
        <h4 className="ceb__val-title">Validation</h4>
        <span
          className="ceb__val-status"
          data-ok={report.ok}
          role="status"
          aria-live="polite"
        >
          {clean ? 'No issues' : 'Issues found'}
          {report.hasCycle && <em className="ceb__val-cycle">contains a loop</em>}
        </span>
      </div>

      {clean ? (
        <p className="ceb__val-clean">
          Every node is reachable, no node is a dead end, and all targets
          resolve. The flow is ready to play.
        </p>
      ) : (
        <ul className="ceb__val-list">
          {flow.start === null && (
            <li className="ceb__val-item" data-kind="start">
              <span className="ceb__val-kind">no start</span>
              <span>Pick a node to start the script from.</span>
            </li>
          )}
          {report.unreachable.map((id) => (
            <li className="ceb__val-item" data-kind="unreachable" key={`u-${id}`}>
              <span className="ceb__val-kind">unreachable</span>
              <span>
                {labelOf(id)} <code className="ceb__id">{id}</code> cannot be
                reached from the start node.
              </span>
            </li>
          ))}
          {report.deadEnds.map((id) => (
            <li className="ceb__val-item" data-kind="deadend" key={`d-${id}`}>
              <span className="ceb__val-kind">dead end</span>
              <span>
                {labelOf(id)} <code className="ceb__id">{id}</code> has no way
                out and is not an end node.
              </span>
            </li>
          ))}
          {report.brokenRefs.map((ref) => (
            <li
              className="ceb__val-item"
              data-kind="broken"
              key={`b-${ref.nodeId}-${ref.optionId ?? 'next'}-${ref.missingId}`}
            >
              <span className="ceb__val-kind">broken link</span>
              <span>
                {labelOf(ref.nodeId)} <code className="ceb__id">{ref.nodeId}</code>
                {ref.optionId ? ' has an option that points' : ' points'} at a
                missing node <code className="ceb__id">{ref.missingId}</code>.
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// One entry in the path the player has walked: the node visited and, for a
// choice, the option label they picked to leave it.
interface PathEntry {
  nodeId: string;
  label: string;
  text: string;
  choice: string | null;
}

// The play view. It walks the flow from the start node using the same pure
// engine the validator uses: message nodes advance on Continue, choice nodes
// advance on the selected option, and the walk ends at an end node or a null
// target. The path taken is shown so the player can see the branch they made.
function Runner({ flow }: { flow: Flow }) {
  const [currentId, setCurrentId] = useState<string | null>(flow.start);
  const [path, setPath] = useState<PathEntry[]>([]);
  const [done, setDone] = useState(false);

  const current = getNode(flow, currentId);

  function restart() {
    setCurrentId(flow.start);
    setPath([]);
    setDone(false);
  }

  function step(node: FlowNode, optionId: string | null, choiceLabel: string | null) {
    const entry: PathEntry = {
      nodeId: node.id,
      label: node.label,
      text: node.text,
      choice: choiceLabel,
    };
    const nextId = advance(node, optionId);
    setPath((p) => [...p, entry]);
    if (nextId === null || getNode(flow, nextId) === undefined) {
      setCurrentId(null);
      setDone(true);
      return;
    }
    // Land on the next node. If it is an end node its closing text shows and
    // the Finish button completes the walk.
    setCurrentId(nextId);
  }

  const noStart = flow.start === null || getNode(flow, flow.start) === undefined;

  return (
    <section className="ceb__runner glass" aria-label="Play the flow">
      <div className="ceb__runner-head">
        <h4 className="ceb__val-title ceb__runner-title">Play through</h4>
        <button type="button" className="demo__btn demo__btn--ghost" onClick={restart}>
          Restart
        </button>
      </div>

      {noStart ? (
        <p className="ceb__runner-empty">
          Set a start node above to play the flow.
        </p>
      ) : (
        <>
          {current && (
            <div className="ceb__bubble" data-kind={current.kind}>
              <span className="ceb__bubble-kind">{current.kind}</span>
              <p className="ceb__bubble-text">
                {current.text || <em className="ceb__muted">No text yet.</em>}
              </p>

              {current.kind === 'message' && (
                <button
                  type="button"
                  className="demo__btn"
                  onClick={() => step(current, null, null)}
                >
                  Continue
                </button>
              )}

              {current.kind === 'choice' && (
                <div className="ceb__choices" role="group" aria-label="Choices">
                  {current.options.length === 0 && (
                    <span className="ceb__muted">This choice has no options.</span>
                  )}
                  {current.options.map((opt) => (
                    <button
                      type="button"
                      key={opt.id}
                      className="demo__btn"
                      onClick={() => step(current, opt.id, opt.label)}
                    >
                      {opt.label || 'Untitled option'}
                    </button>
                  ))}
                </div>
              )}

              {current.kind === 'end' && (
                <button
                  type="button"
                  className="demo__btn demo__btn--ghost"
                  onClick={() => {
                    setPath((p) => [
                      ...p,
                      {
                        nodeId: current.id,
                        label: current.label,
                        text: current.text,
                        choice: null,
                      },
                    ]);
                    setCurrentId(null);
                    setDone(true);
                  }}
                >
                  Finish
                </button>
              )}
            </div>
          )}

          {done && (
            <p className="ceb__runner-done" role="status">
              The script ended here. Restart to play it again.
            </p>
          )}

          {path.length > 0 && (
            <ol className="ceb__path" aria-label="Path taken">
              {path.map((entry, i) => (
                <li className="ceb__path-step" key={`${entry.nodeId}-${i}`}>
                  <code className="ceb__id">{entry.nodeId}</code>
                  <span className="ceb__path-label">{entry.label}</span>
                  {entry.choice && (
                    <span className="ceb__path-choice">chose: {entry.choice}</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

export default function ConvoengineDemo() {
  const flow = useFlow();
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="demo ceb" aria-label="conversation flow builder">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Build a branching conversation flow</h3>
      <p className="demo__lede">
        Author a scripted support flow as a graph of nodes. Add message, choice,
        and end nodes, wire each option to the node it leads to, and pick the
        node the script starts from. Everything is saved in your browser.
      </p>

      <div className="ceb__toolbar" role="group" aria-label="Add nodes">
        <button
          type="button"
          className="demo__btn"
          onClick={() => addNode('message')}
        >
          Add message
        </button>
        <button
          type="button"
          className="demo__btn"
          onClick={() => addNode('choice')}
        >
          Add choice
        </button>
        <button
          type="button"
          className="demo__btn"
          onClick={() => addNode('end')}
        >
          Add end
        </button>
        <span className="demo__hint">
          start: <code className="ceb__id">{flow.start ?? 'none'}</code>
        </span>
        {confirmReset ? (
          <span className="ceb__confirm">
            Reset to the seed flow?
            <button
              type="button"
              className="demo__btn demo__btn--ghost"
              onClick={() => {
                resetFlow();
                setConfirmReset(false);
              }}
            >
              Confirm reset
            </button>
            <button
              type="button"
              className="demo__btn demo__btn--ghost"
              onClick={() => setConfirmReset(false)}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="demo__btn demo__btn--ghost"
            onClick={() => setConfirmReset(true)}
          >
            Reset flow
          </button>
        )}
      </div>

      <ValidationPanel nodes={flow.nodes} />

      <Runner key={flow.start ?? 'no-start'} flow={flow} />

      <section aria-label="Flow nodes">
        <h4 className="ceb__section-title">
          Nodes <span className="demo__hint">{flow.nodes.length} total</span>
        </h4>
        <ol className="ceb__nodes">
          {flow.nodes.length === 0 && (
            <li className="ceb__empty">
              No nodes yet. Add a message, choice, or end node to begin.
            </li>
          )}
          {flow.nodes.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              nodes={flow.nodes}
              isStart={node.id === flow.start}
            />
          ))}
        </ol>
      </section>
    </div>
  );
}
