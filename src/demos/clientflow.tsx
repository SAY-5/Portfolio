import { useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './clientflow.css';

// Real behavior from the project: a rule is a typed tree of comparisons and
// AND/OR groups, evaluated by an interpreter that never calls eval or exec and
// returns false for any node it cannot safely perform. Every save creates a new
// retained version with an atomic active pointer, and a dry-run tests a
// candidate version against sample inputs without changing what is live.

type Payload = { amount: number; country: string; verified: boolean };

type Leaf = {
  kind: 'cmp';
  id: string;
  field: keyof Payload;
  op: string;
  value: string | number | boolean;
  label: string;
  test: (p: Payload) => boolean;
};
type Group = {
  kind: 'group';
  id: string;
  op: 'AND' | 'OR';
  children: RuleNode[];
};
type RuleNode = Leaf | Group;

// Live (active) rule and a candidate version used by the dry-run.
const liveRule: Group = {
  kind: 'group',
  id: 'root',
  op: 'AND',
  children: [
    {
      kind: 'cmp',
      id: 'c1',
      field: 'amount',
      op: '>=',
      value: 500,
      label: 'amount >= 500',
      test: (p) => p.amount >= 500,
    },
    {
      kind: 'group',
      id: 'g1',
      op: 'OR',
      children: [
        {
          kind: 'cmp',
          id: 'c2',
          field: 'country',
          op: '==',
          value: 'US',
          label: "country == 'US'",
          test: (p) => p.country === 'US',
        },
        {
          kind: 'cmp',
          id: 'c3',
          field: 'verified',
          op: '==',
          value: true,
          label: 'verified == true',
          test: (p) => p.verified === true,
        },
      ],
    },
  ],
};

// Candidate (dry-run) version raises the threshold to 1000.
const candidateRule: Group = {
  ...liveRule,
  children: [
    {
      kind: 'cmp',
      id: 'c1',
      field: 'amount',
      op: '>=',
      value: 1000,
      label: 'amount >= 1000',
      test: (p) => p.amount >= 1000,
    },
    liveRule.children[1],
  ],
};

function evalNode(node: RuleNode, p: Payload): boolean {
  if (node.kind === 'cmp') return node.test(p);
  if (node.op === 'AND') return node.children.every((c) => evalNode(c, p));
  return node.children.some((c) => evalNode(c, p));
}

const ease = [0.22, 1, 0.36, 1] as const;

function NodeView({
  node,
  payload,
  depth,
}: {
  node: RuleNode;
  payload: Payload;
  depth: number;
}) {
  const result = evalNode(node, payload);
  if (node.kind === 'cmp') {
    return (
      <div className="cf__node">
        <div className="cf__node-self" data-result={String(result)}>
          <span className="cf__node-text">{node.label}</span>
          <span className="cf__node-result" data-result={String(result)}>
            {result ? 'true' : 'false'}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="cf__node" style={depth === 0 ? { borderLeft: 'none', marginLeft: 0, paddingLeft: 0 } : undefined}>
      <div className="cf__node-self" data-result={String(result)}>
        <span className="cf__node-op">{node.op}</span>
        <span className="cf__node-result" data-result={String(result)}>
          {result ? 'true' : 'false'}
        </span>
      </div>
      {node.children.map((c) => (
        <NodeView key={c.id} node={c} payload={payload} depth={depth + 1} />
      ))}
    </div>
  );
}

export default function ClientflowDemo() {
  const reduce = useReducedMotion();
  const [amount, setAmount] = useState(750);
  const [country, setCountry] = useState('US');
  const [verified, setVerified] = useState(false);
  const [dryRun, setDryRun] = useState(false);

  const payload: Payload = { amount, country, verified };
  const rule = dryRun ? candidateRule : liveRule;
  const fired = evalNode(rule, payload);

  function toggleCountry() {
    setCountry((c) => (c === 'US' ? 'CA' : 'US'));
  }

  function reset() {
    setAmount(750);
    setCountry('US');
    setVerified(false);
    setDryRun(false);
  }

  return (
    <div className="demo" aria-label="clientflow rule evaluator demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Walk a rule tree on a live payload</h3>
      <p className="demo__lede">
        A rule is a typed tree of comparisons and AND/OR groups. Edit the sample
        payload and the interpreter walks the tree, lighting each node true or
        false down to the action it fires. No node ever runs a user string as
        code. Toggle dry-run to test a candidate version without changing what is
        live.
      </p>

      <div className="cf__stage">
        <div className="cf__top">
          <div className="cf__payload">
            <div className="cf__payload-head">Sample payload</div>
            <div className="cf__field">
              <span className="cf__field-key">amount</span>
              <input
                className="cf__field-input"
                type="number"
                value={amount}
                aria-label="amount"
                onChange={(e) => setAmount(Number(e.target.value) || 0)}
              />
            </div>
            <div className="cf__field">
              <span className="cf__field-key">country</span>
              <button
                type="button"
                className="cf__field-toggle"
                data-on={country === 'US'}
                onClick={toggleCountry}
                aria-label={`country is ${country}, toggle`}
              >
                {country}
              </button>
            </div>
            <div className="cf__field">
              <span className="cf__field-key">verified</span>
              <button
                type="button"
                className="cf__field-toggle"
                data-on={verified}
                onClick={() => setVerified((v) => !v)}
                aria-pressed={verified}
                aria-label="verified flag"
              >
                {verified ? 'true' : 'false'}
              </button>
            </div>
          </div>

          <div className="cf__tree" style={{ flex: '2 1 280px' }}>
            <div className="cf__payload-head">Condition tree</div>
            <NodeView node={rule} payload={payload} depth={0} />
          </div>
        </div>

        <div className="cf__actions">
          <div className="cf__actions-head">Actions</div>
          <div className="cf__action" data-fired={String(fired)}>
            <span className="cf__action-dot" />
            apply discount tier and flag for review
            <span
              className="cf__node-result"
              data-result={String(fired)}
              style={{ marginLeft: 'auto' }}
            >
              {fired ? 'fires' : 'skipped'}
            </span>
          </div>
        </div>

        <div className="cf__timeline">
          <span className={`cf__ver${!dryRun ? ' cf__ver--active' : ''}`}>
            v3 active
          </span>
          <span className="cf__ver-arrow">to</span>
          <span className={`cf__ver${dryRun ? ' cf__ver--dry' : ''}`}>
            v4 candidate
          </span>
          <span className="cf__dry" style={{ marginLeft: 'auto' }}>
            dry-run
            <button
              type="button"
              className="cf__dry-switch"
              data-on={dryRun}
              onClick={() => setDryRun((d) => !d)}
              aria-pressed={dryRun}
            >
              {dryRun ? 'on (v4)' : 'off (v3)'}
            </button>
          </span>
        </div>

        <AnimatePresence>
          {dryRun && (
            <motion.div
              className="cf__verdict"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="cf__verdict-head">Dry-run on the candidate</span>
              <span className="cf__verdict-text">
                v4 raises the amount threshold to 1000. The interpreter runs the
                same payload against the candidate tree while v3 stays the active
                version, so nothing live changes until v4 is promoted.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button
          type="button"
          className="demo__btn"
          onClick={() => setDryRun((d) => !d)}
        >
          {dryRun ? 'Back to live (v3)' : 'Dry-run v4'}
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={reset}
        >
          Reset
        </button>
        <span className="demo__hint">
          evaluating {dryRun ? 'v4 candidate' : 'v3 active'}
        </span>
      </div>
    </div>
  );
}
