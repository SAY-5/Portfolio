// FlowDeck: a working multi-step approval workflow engine that runs entirely in
// the browser. Submit a request, watch it advance through manager, finance, and
// security gates, approve or reject the current step with a note, and see where
// every item is stuck. The workflow definition, items, and audit trail live in
// localStorage; the pure engine decides every transition.

import { useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import './flowdeck.css';

import { useFlowStore } from './flowdeck/state';
import {
  ROLES,
  approveItem,
  rejectItem,
  resetAll,
  setActingAs,
  submitItem,
} from './flowdeck/store';
import {
  awaitingCounts,
  bucketByStep,
  canDecide,
  currentStep,
  stepApplies,
} from './flowdeck/engine';
import { age, clock, fieldText } from './flowdeck/format';
import type { HistoryEntry, Item, Role } from './flowdeck/types';

const ease = [0.22, 1, 0.36, 1] as const;

// A re-rendering clock so relative ages stay fresh without calling Date.now
// during render. Initialised lazily, then ticked once a minute.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function FlowdeckDemo() {
  const { workflow, items, actingAs } = useFlowStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const now = useNow();

  const { buckets, completed } = useMemo(
    () => bucketByStep(workflow, items),
    [workflow, items],
  );

  return (
    <div className="demo fd2" aria-label="flowdeck approval workflow">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Run an approval workflow end to end</h3>
      <p className="demo__lede">
        Submit a request and it enters the pipeline at the first gate that
        applies. Pick the role you are acting as, then approve or reject the
        step in front of you. Finance only sees larger requests, security only
        sees access changes, and a rejection sends the item back.
      </p>

      <RoleBar actingAs={actingAs} />

      <SubmitForm />

      <p className="fd2__sr-only" aria-live="polite">
        {items.filter((i) => i.stage !== 'approved').length} requests in flight,{' '}
        {completed.length} approved.
      </p>

      <section className="fd2__pipeline" aria-label="workflow pipeline">
        {buckets.map((bucket) => (
          <PipelineColumn
            key={bucket.step.id}
            heading={bucket.step.name}
            sub={bucket.step.approver}
            items={bucket.items}
            now={now}
            selectedId={selectedId}
            onSelect={setSelectedId}
            active={bucket.step.approver === actingAs}
          />
        ))}
        <PipelineColumn
          heading="Approved"
          sub="done"
          items={completed}
          now={now}
          selectedId={selectedId}
          onSelect={setSelectedId}
          terminal
        />
      </section>

      <ItemDetail
        item={items.find((i) => i.id === selectedId) ?? null}
        now={now}
        onClose={() => setSelectedId(null)}
      />

      <WorkflowPanel />
    </div>
  );
}

function WorkflowPanel() {
  const { workflow, items, actingAs } = useFlowStore();

  const counts = useMemo(
    () => awaitingCounts(workflow, items),
    [workflow, items],
  );

  // Items in flight that the viewer's current role cannot act on are "blocked"
  // from their seat, waiting on another role.
  const blockedForMe = useMemo(() => {
    let n = 0;
    for (const item of items) {
      const step = currentStep(workflow, item);
      if (step && step.approver !== actingAs) n += 1;
    }
    return n;
  }, [workflow, items, actingAs]);

  function onReset() {
    resetAll();
  }

  return (
    <section className="fd2__panel" aria-label="workflow definition and stats">
      <div className="fd2__panel-grid">
        <div className="fd2__def">
          <h5 className="fd2__sub-head">{workflow.name} steps</h5>
          <ol className="fd2__def-list">
            {workflow.steps.map((step, i) => (
              <li className="fd2__def-row" key={step.id}>
                <span className="fd2__def-num">{i + 1}</span>
                <div className="fd2__def-body">
                  <span className="fd2__def-name">
                    {step.name}
                    <span className="fd2__def-role">{step.approver}</span>
                  </span>
                  <span className="fd2__def-desc">{step.description}</span>
                  <span className="fd2__def-rule">
                    {step.condition
                      ? `applies when ${step.condition.field} ${step.condition.op} ${String(
                          step.condition.value,
                        )}`
                      : 'always applies'}
                    {' · '}
                    reject sends to {step.onReject}
                  </span>
                </div>
                <span className="fd2__def-count" aria-label="awaiting at this step">
                  {counts.perStep[step.id] ?? 0}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="fd2__stats">
          <h5 className="fd2__sub-head">summary</h5>
          <dl className="fd2__stat-grid">
            <Stat label="in flight" value={counts.inFlight} />
            <Stat label="approved" value={counts.completed} />
            <Stat label="total" value={items.length} />
            <Stat label="not on you" value={blockedForMe} tone="warn" />
          </dl>
          <button
            type="button"
            className="demo__btn demo__btn--ghost fd2__reset"
            onClick={onReset}
          >
            Reset workflow
          </button>
          <p className="fd2__reset-note">
            clears stored items and audit and restores the seed set
          </p>
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'warn';
}) {
  return (
    <div className="fd2__stat" data-tone={tone}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ItemDetail({
  item,
  now,
  onClose,
}: {
  item: Item | null;
  now: number;
  onClose: () => void;
}) {
  const { workflow, actingAs } = useFlowStore();
  const [note, setNote] = useState('');

  if (!item) {
    return (
      <p className="fd2__detail-hint">
        Select an item to see its fields, its history, and the actions open to
        you.
      </p>
    );
  }

  const step = currentStep(workflow, item);
  const mayDecide = canDecide(workflow, item, actingAs);
  const fieldRows = Object.entries(item.fields);

  function decide(action: 'approve' | 'reject') {
    if (!item) return;
    if (action === 'approve') approveItem(item.id, note);
    else rejectItem(item.id, note);
    setNote('');
  }

  return (
    <section className="fd2__detail glass" aria-label={`detail for ${item.title}`}>
      <header className="fd2__detail-head">
        <div>
          <h4 className="fd2__detail-title">{item.title}</h4>
          <span className="fd2__detail-id">{item.id}</span>
        </div>
        <button
          type="button"
          className="fd2__detail-close"
          onClick={onClose}
          aria-label="close detail"
        >
          ✕
        </button>
      </header>

      <dl className="fd2__fields">
        {fieldRows.map(([key, value]) => (
          <div className="fd2__field-row" key={key}>
            <dt>{key}</dt>
            <dd>{fieldText(value)}</dd>
          </div>
        ))}
        <div className="fd2__field-row">
          <dt>stage</dt>
          <dd>
            {item.stage === 'approved'
              ? 'approved'
              : step
                ? `awaiting ${step.approver}`
                : 'pending'}
          </dd>
        </div>
      </dl>

      <div className="fd2__detail-grid">
        <div className="fd2__timeline-wrap">
          <h5 className="fd2__sub-head">history</h5>
          <ol className="fd2__timeline">
            {item.history.map((h) => (
              <TimelineRow key={h.id} entry={h} now={now} />
            ))}
          </ol>
        </div>

        <div className="fd2__actions">
          <h5 className="fd2__sub-head">
            {step ? `current step: ${step.name}` : 'no open step'}
          </h5>
          {step && (
            <>
              <label className="fd2__note-label" htmlFor="fd2-note">
                note (optional)
              </label>
              <textarea
                id="fd2-note"
                className="fd2__note"
                value={note}
                rows={2}
                placeholder={
                  mayDecide
                    ? 'Why are you approving or sending this back?'
                    : `Switch to the ${step.approver} role to act here.`
                }
                onChange={(e) => setNote(e.target.value)}
                disabled={!mayDecide}
              />
              <div className="fd2__action-btns">
                <button
                  type="button"
                  className="demo__btn"
                  onClick={() => decide('approve')}
                  disabled={!mayDecide}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="demo__btn demo__btn--ghost"
                  onClick={() => decide('reject')}
                  disabled={!mayDecide}
                >
                  Send back
                </button>
              </div>
              {!mayDecide && (
                <p className="fd2__locked" role="status">
                  This step is approved by {step.approver}. You are acting as{' '}
                  {actingAs}.
                </p>
              )}
            </>
          )}
          {!step && (
            <p className="fd2__locked" role="status">
              This request has cleared every applicable gate.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function TimelineRow({ entry, now }: { entry: HistoryEntry; now: number }) {
  return (
    <li className="fd2__tl-row" data-kind={entry.kind}>
      <span className="fd2__tl-dot" aria-hidden="true" />
      <div className="fd2__tl-body">
        <span className="fd2__tl-head">
          <strong>{entry.kind}</strong>
          {entry.stepName && <span className="fd2__tl-step">{entry.stepName}</span>}
          <span className="fd2__tl-actor">{entry.actor}</span>
        </span>
        {entry.note && <span className="fd2__tl-note">{entry.note}</span>}
        <span className="fd2__tl-time">
          {clock(entry.at)} · {age(entry.at, now)}
        </span>
      </div>
    </li>
  );
}

function RoleBar({ actingAs }: { actingAs: Role }) {
  return (
    <div className="fd2__roles" role="radiogroup" aria-label="acting as role">
      <span className="fd2__roles-label">acting as</span>
      {ROLES.map((r) => (
        <button
          key={r.id}
          type="button"
          role="radio"
          aria-checked={actingAs === r.id}
          className="fd2__role"
          data-on={actingAs === r.id}
          onClick={() => setActingAs(r.id)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

function SubmitForm() {
  const { workflow } = useFlowStore();
  const reduce = useReducedMotion();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('250');
  const [accessChange, setAccessChange] = useState(false);

  const preview = useMemo(() => {
    const fields = { amount: Number(amount) || 0, accessChange };
    return workflow.steps.filter((s) => stepApplies(s, fields)).map((s) => s.name);
  }, [workflow, amount, accessChange]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = submitItem(title, { amount: Number(amount) || 0, accessChange });
    if (ok) {
      setTitle('');
      setAmount('250');
      setAccessChange(false);
    }
  }

  return (
    <form className="fd2__submit glass" onSubmit={onSubmit} aria-label="submit a request">
      <div className="fd2__field fd2__field--grow">
        <label htmlFor="fd2-title">Request</label>
        <input
          id="fd2-title"
          type="text"
          value={title}
          placeholder="What needs approval?"
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>
      <div className="fd2__field">
        <label htmlFor="fd2-amount">Amount</label>
        <input
          id="fd2-amount"
          type="number"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <div className="fd2__field fd2__field--check">
        <label htmlFor="fd2-access">
          <input
            id="fd2-access"
            type="checkbox"
            checked={accessChange}
            onChange={(e) => setAccessChange(e.target.checked)}
          />
          Access change
        </label>
      </div>
      <button type="submit" className="demo__btn">
        Submit
      </button>
      <motion.p
        className="fd2__route"
        key={preview.join('>')}
        initial={{ opacity: reduce ? 1 : 0.4 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reduce ? 0 : 0.25, ease }}
      >
        route: {preview.length ? preview.join(' → ') : 'no gates, auto-approved'}
      </motion.p>
    </form>
  );
}

function PipelineColumn({
  heading,
  sub,
  items,
  now,
  selectedId,
  onSelect,
  active = false,
  terminal = false,
}: {
  heading: string;
  sub: string;
  items: Item[];
  now: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  active?: boolean;
  terminal?: boolean;
}) {
  return (
    <div className="fd2__col" data-active={active} data-terminal={terminal}>
      <header className="fd2__col-head">
        <span className="fd2__col-name">{heading}</span>
        <span className="fd2__col-sub">{sub}</span>
        <span className="fd2__col-count" aria-label={`${items.length} items`}>
          {items.length}
        </span>
      </header>
      <ul className="fd2__col-list">
        {items.length === 0 && <li className="fd2__col-empty">empty</li>}
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="fd2__card"
              data-selected={selectedId === item.id}
              onClick={() => onSelect(item.id)}
            >
              <span className="fd2__card-title">{item.title}</span>
              <span className="fd2__card-meta">
                <span className="fd2__card-id">{item.id}</span>
                <span className="fd2__card-age">{age(item.submittedAt, now)}</span>
              </span>
              <span className="fd2__card-amount">
                {fieldText(item.fields.amount ?? 0)}
                {item.fields.accessChange ? ' · access' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
