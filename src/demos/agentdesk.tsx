import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './agentdesk.css';
import {
  findCustomer,
  findOrder,
  intentLabel,
  type Request,
} from './agentdesk/data';
import { useStore } from './agentdesk/state';
import {
  commitRun,
  findRequest,
  reroutedDecision,
  resetAll,
  reviewRequest,
  runAgent,
  setThreshold,
  type AuditEntry,
  type Processed,
  type RunResult,
  type ToolCall,
} from './agentdesk/store';

// In-browser AgentDesk operations console. An operator picks an inbound request,
// runs the provider agent loop, and watches the tool-calling loop run against the
// mock backend with a live confidence readout. Confidence is the provider signal
// times tool-call completeness (the fraction of planned calls that succeed). At
// or above the threshold the request drops into the Resolved lane; below it, it
// escalates to the human-review queue, where the operator opens the transcript
// and approves the proposal or overrides it. Every decision is written to an
// audit trail. Processed requests, the threshold, and the audit persist in
// localStorage, so the console survives a reload. Local run of the scoring loop
// over 200000 requests: about 96000 requests/sec single threaded.
const REQ_PER_SEC = 96000;
const STEP_MS = 620;
const ease = [0.22, 1, 0.36, 1] as const;

type View = 'queue' | 'review' | 'audit';
type RunPhase = 'idle' | 'running' | 'done';

export default function AgentdeskDemo() {
  const state = useStore();
  const reduce = useReducedMotion();
  const [view, setView] = useState<View>('queue');

  // The request currently loaded into the runner, and the live run state built
  // by replaying the agent's tool calls one at a time.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [shownCalls, setShownCalls] = useState<ToolCall[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const timers = useRef<number[]>([]);

  // The escalated request opened in the human-review panel.
  const [openId, setOpenId] = useState<string | null>(null);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function at(ms: number, fn: () => void) {
    timers.current.push(window.setTimeout(fn, reduce ? 0 : ms));
  }

  const queue: Request[] = useMemo(
    () => state.queueIds.map(findRequest).filter((r): r is Request => Boolean(r)),
    [state.queueIds],
  );

  // Processed requests split into lanes by the current threshold. The stored
  // decision is kept, but the lane is recomputed live so dragging the threshold
  // re-routes requests between the two lanes at once.
  const resolvedLane = useMemo(
    () =>
      state.processed.filter(
        (p) => reroutedDecision(p, state.threshold) === 'resolved',
      ),
    [state.processed, state.threshold],
  );
  const reviewLane = useMemo(
    () =>
      state.processed.filter(
        (p) => reroutedDecision(p, state.threshold) === 'escalated',
      ),
    [state.processed, state.threshold],
  );

  function selectRequest(id: string) {
    clearTimers();
    setActiveId(id);
    setPhase('idle');
    setShownCalls([]);
    setResult(null);
  }

  // Run the agent for the active request, replaying each tool call with a delay
  // so the loop and the rising completeness are visible, then commit the outcome
  // to the store, which routes it into a lane and writes the audit entry.
  function run() {
    if (!activeId || phase === 'running') return;
    clearTimers();
    const res = runAgent(activeId, state.threshold);
    setResult(res);
    setShownCalls([]);
    setPhase('running');

    res.calls.forEach((call, i) => {
      at(i * STEP_MS, () => setShownCalls((prev) => [...prev, call]));
    });

    at(res.calls.length * STEP_MS + 120, () => {
      commitRun(res);
      setPhase('done');
    });
  }

  // The live confidence shown during a run climbs as calls land; once done it
  // matches the committed result.
  const liveCompleteness =
    result && result.calls.length > 0
      ? shownCalls.filter((c) => c.ok).length / result.calls.length
      : 0;
  const liveConfidence = result ? +(result.signal * liveCompleteness).toFixed(3) : 0;
  const settledConfidence =
    phase === 'done' && result ? result.confidence : liveConfidence;
  const resolvesLive = settledConfidence >= state.threshold;

  const active = activeId ? findRequest(activeId) : undefined;
  const opened = openId
    ? state.processed.find((p) => p.requestId === openId)
    : undefined;

  const busy = phase === 'running';

  return (
    <div className="demo" aria-label="AgentDesk operations console">
      <span className="demo__tag">Operations console</span>
      <h3 className="demo__title">AgentDesk</h3>
      <p className="demo__lede">
        Pick an inbound request, run the agent, and watch the tool-calling loop
        run against the backend with a live confidence readout. Confidence is the
        provider signal times tool-call completeness. At or above the threshold a
        request auto-resolves; below it, it escalates to human review, where you
        approve or override. Your work is saved in this browser and survives a
        reload.
      </p>

      <div className="adx__bar">
        <div className="adx__tabs" role="tablist" aria-label="Console view">
          <button
            role="tab"
            id="adx-tab-queue"
            aria-controls="adx-panel-queue"
            aria-selected={view === 'queue'}
            className={`adx__tab ${view === 'queue' ? 'adx__tab--on' : ''}`}
            onClick={() => setView('queue')}
          >
            Queue{queue.length > 0 ? ` (${queue.length})` : ''}
          </button>
          <button
            role="tab"
            id="adx-tab-review"
            aria-controls="adx-panel-review"
            aria-selected={view === 'review'}
            className={`adx__tab ${view === 'review' ? 'adx__tab--on' : ''}`}
            onClick={() => setView('review')}
          >
            Routing{state.processed.length > 0 ? ` (${state.processed.length})` : ''}
          </button>
          <button
            role="tab"
            id="adx-tab-audit"
            aria-controls="adx-panel-audit"
            aria-selected={view === 'audit'}
            className={`adx__tab ${view === 'audit' ? 'adx__tab--on' : ''}`}
            onClick={() => setView('audit')}
          >
            Audit{state.audit.length > 0 ? ` (${state.audit.length})` : ''}
          </button>
        </div>
        <span className="adx__bar-spacer" />
        <ThresholdControl threshold={state.threshold} disabled={busy} />
      </div>

      <p className="adx__sr" role="status" aria-live="polite">
        {phase === 'done' && result
          ? result.decision === 'resolved'
            ? `Request ${result.requestId} auto-resolved.`
            : `Request ${result.requestId} escalated to human review.`
          : ''}
      </p>

      {view === 'queue' && (
        <div
          className="adx__grid"
          role="tabpanel"
          id="adx-panel-queue"
          aria-labelledby="adx-tab-queue"
        >
          <section className="adx__queue" aria-label="Inbound queue">
            <div className="adx__panel-head">
              Inbound queue
              <span className="adx__panel-count">{queue.length} waiting</span>
            </div>
            {queue.length === 0 ? (
              <p className="adx__empty">
                Queue is clear. Every request has been processed. Reset from the
                Audit tab to refill it.
              </p>
            ) : (
              <ul className="adx__list">
                {queue.map((r) => {
                  const c = findCustomer(r.customerId);
                  return (
                    <li key={r.id}>
                      <button
                        className={`adx__qitem ${
                          activeId === r.id ? 'adx__qitem--on' : ''
                        }`}
                        onClick={() => selectRequest(r.id)}
                        aria-pressed={activeId === r.id}
                      >
                        <span className="adx__qitem-top">
                          <span className="adx__qid">{r.id}</span>
                          <span className="adx__qintent">
                            {intentLabel(r.intent)}
                          </span>
                        </span>
                        <span className="adx__qtext">{r.text}</span>
                        <span className="adx__qmeta">
                          {c?.name ?? r.customerId} · signal{' '}
                          {r.signal.toFixed(2)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <Runner
            active={active}
            phase={phase}
            shownCalls={shownCalls}
            result={result}
            threshold={state.threshold}
            settledConfidence={settledConfidence}
            resolvesLive={resolvesLive}
            busy={busy}
            reduce={reduce}
            onRun={run}
            onGoLane={() => setView('review')}
          />
        </div>
      )}

      {view === 'review' && (
        <Routing
          resolvedLane={resolvedLane}
          reviewLane={reviewLane}
          threshold={state.threshold}
          opened={opened}
          reduce={reduce}
          onOpen={setOpenId}
          onApprove={(id) =>
            reviewRequest(
              id,
              'approved',
              'operator approved the agent proposal',
            )
          }
          onOverride={(id) =>
            reviewRequest(
              id,
              'overridden',
              'operator overrode and handled the request manually',
            )
          }
        />
      )}

      {view === 'audit' && (
        <Audit
          audit={state.audit}
          onReset={() => {
            clearTimers();
            resetAll();
            setActiveId(null);
            setOpenId(null);
            setPhase('idle');
            setShownCalls([]);
            setResult(null);
            setView('queue');
          }}
        />
      )}

      <div className="adx__foot">
        <span className="adx__foot-stat">
          <b>{REQ_PER_SEC.toLocaleString('en-US')}</b> requests/sec scored single
          threaded
        </span>
      </div>
    </div>
  );
}

// ---------- threshold control ----------

function ThresholdControl({
  threshold,
  disabled,
}: {
  threshold: number;
  disabled: boolean;
}) {
  return (
    <div className="adx__thresh">
      <label className="adx__thresh-label" htmlFor="adx-threshold">
        threshold <b>{threshold.toFixed(2)}</b>
      </label>
      <input
        id="adx-threshold"
        className="adx__slider"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={threshold}
        disabled={disabled}
        onChange={(e) => setThreshold(+e.target.value)}
        aria-label="Auto-resolve confidence threshold"
        aria-valuetext={threshold.toFixed(2)}
      />
    </div>
  );
}

// ---------- the runner ----------

function Runner({
  active,
  phase,
  shownCalls,
  result,
  threshold,
  settledConfidence,
  resolvesLive,
  busy,
  reduce,
  onRun,
  onGoLane,
}: {
  active: Request | undefined;
  phase: RunPhase;
  shownCalls: ToolCall[];
  result: RunResult | null;
  threshold: number;
  settledConfidence: number;
  resolvesLive: boolean;
  busy: boolean;
  reduce: boolean | null;
  onRun: () => void;
  onGoLane: () => void;
}) {
  const customer = active ? findCustomer(active.customerId) : undefined;
  const order = active ? findOrder(active.orderId) : undefined;
  const passed = shownCalls.filter((c) => c.ok).length;
  const total = result?.calls.length ?? 0;

  return (
    <aside className="adx__runner" aria-label="Agent runner">
      <div className="adx__panel-head">Runner</div>

      {!active ? (
        <p className="adx__empty">
          Select a request from the queue to load it into the runner.
        </p>
      ) : (
        <>
          <div className="adx__req">
            <span className="adx__req-id">{active.id}</span>
            <span className="adx__req-intent">{intentLabel(active.intent)}</span>
            <p className="adx__req-text">{active.text}</p>
            <span className="adx__req-meta">
              {customer?.name ?? active.customerId} · {customer?.tier ?? ''} tier
              {order ? ` · ${order.id} ${order.item}` : ''}
            </span>
          </div>

          <div className="adx__calls" aria-label="Tool calls">
            {shownCalls.length === 0 && phase !== 'running' && (
              <span className="adx__calls-empty">
                Run the agent to execute its tool plan.
              </span>
            )}
            <AnimatePresence initial={false}>
              {shownCalls.map((call, i) => (
                <motion.div
                  key={`${call.tool}-${i}`}
                  className={`adx__call ${
                    call.ok ? 'adx__call--ok' : 'adx__call--err'
                  }`}
                  initial={{ opacity: 0, y: reduce ? 0 : -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduce ? 0 : 0.28, ease }}
                >
                  <span className="adx__call-dot" aria-hidden="true" />
                  <span className="adx__call-name">{call.tool}()</span>
                  <span className="adx__call-detail">{call.detail}</span>
                  <span className="adx__call-state">
                    {call.ok ? 'ok' : 'error'}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <div className="adx__score">
            <div className="adx__formula">
              signal <b>{active.signal.toFixed(2)}</b>{' '}
              <span className="adx__hi">x</span> completeness{' '}
              <b>
                {total > 0 ? `${passed}/${total}` : '0/0'} ={' '}
                {(total > 0 ? passed / total : 0).toFixed(2)}
              </b>{' '}
              <span className="adx__hi">=</span> confidence{' '}
              <b className="adx__hi">{settledConfidence.toFixed(2)}</b>
            </div>
            <div className="adx__meter" aria-hidden="true">
              <div
                className={`adx__meter-fill ${
                  resolvesLive ? 'adx__meter-fill--ok' : 'adx__meter-fill--esc'
                }`}
                style={{ width: `${Math.round(settledConfidence * 100)}%` }}
              />
              <div
                className="adx__meter-mark"
                style={{ left: `${Math.round(threshold * 100)}%` }}
                title={`threshold ${threshold.toFixed(2)}`}
              />
            </div>
            <div className="adx__score-line">
              confidence {settledConfidence.toFixed(2)}{' '}
              {resolvesLive ? '>=' : '<'} threshold {threshold.toFixed(2)}{' '}
              {'->'} {resolvesLive ? 'resolve' : 'escalate'}
            </div>
          </div>

          {phase === 'done' && result && (
            <div
              className={`adx__verdict ${
                result.decision === 'resolved'
                  ? 'adx__verdict--ok'
                  : 'adx__verdict--esc'
              }`}
            >
              <span className="adx__verdict-head">
                {result.decision === 'resolved'
                  ? 'Auto-resolved'
                  : 'Escalated to human'}
              </span>
              <span className="adx__verdict-text">{result.resolution}</span>
            </div>
          )}

          <div className="adx__runner-actions">
            <button
              className="demo__btn"
              onClick={onRun}
              disabled={busy || phase === 'done'}
            >
              {busy ? 'Running...' : phase === 'done' ? 'Processed' : 'Run agent'}
            </button>
            {phase === 'done' && (
              <button className="demo__btn demo__btn--ghost" onClick={onGoLane}>
                View routing
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

// ---------- routing lanes and human review ----------

function Routing({
  resolvedLane,
  reviewLane,
  threshold,
  opened,
  reduce,
  onOpen,
  onApprove,
  onOverride,
}: {
  resolvedLane: Processed[];
  reviewLane: Processed[];
  threshold: number;
  opened: Processed | undefined;
  reduce: boolean | null;
  onOpen: (id: string | null) => void;
  onApprove: (id: string) => void;
  onOverride: (id: string) => void;
}) {
  return (
    <div
      className="adx__routing"
      role="tabpanel"
      id="adx-panel-review"
      aria-labelledby="adx-tab-review"
    >
      <div className="adx__lanes">
        <Lane
          title="Resolved"
          tone="ok"
          items={resolvedLane}
          reduce={reduce}
          onOpen={onOpen}
        />
        <Lane
          title="Human review"
          tone="esc"
          items={reviewLane}
          reduce={reduce}
          onOpen={onOpen}
        />
      </div>
      <p className="adx__lanes-note">
        Lanes are routed live against the threshold {threshold.toFixed(2)}. Drag
        the threshold in the top bar to re-route processed requests between lanes.
      </p>

      <AnimatePresence>
        {opened && (
          <motion.div
            className="adx__detail"
            initial={{ opacity: 0, y: reduce ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.3, ease }}
          >
            <ReviewDetail
              entry={opened}
              onClose={() => onOpen(null)}
              onApprove={onApprove}
              onOverride={onOverride}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Lane({
  title,
  tone,
  items,
  reduce,
  onOpen,
}: {
  title: string;
  tone: 'ok' | 'esc';
  items: Processed[];
  reduce: boolean | null;
  onOpen: (id: string) => void;
}) {
  return (
    <section
      className={`adx__lane adx__lane--${tone}`}
      aria-label={title}
    >
      <div className="adx__lane-head">
        <span className="adx__lane-title">{title}</span>
        <span className="adx__lane-count">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="adx__lane-empty">No requests in this lane.</p>
      ) : (
        <ul className="adx__lane-list">
          <AnimatePresence initial={false}>
            {items.map((p) => (
              <motion.li
                key={p.requestId}
                layout={!reduce}
                initial={{ opacity: 0, scale: reduce ? 1 : 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.3, ease }}
              >
                <button
                  className="adx__lane-card"
                  onClick={() => onOpen(p.requestId)}
                  aria-label={`Open ${p.requestId}`}
                >
                  <span className="adx__lane-card-top">
                    <span className="adx__qid">{p.requestId}</span>
                    <span className="adx__lane-conf">
                      {p.confidence.toFixed(2)}
                    </span>
                  </span>
                  <span className="adx__lane-card-intent">
                    {intentLabel(p.intent)}
                  </span>
                  <span className={`adx__lane-review adx__lane-review--${p.review}`}>
                    {p.review}
                  </span>
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

function ReviewDetail({
  entry,
  onClose,
  onApprove,
  onOverride,
}: {
  entry: Processed;
  onClose: () => void;
  onApprove: (id: string) => void;
  onOverride: (id: string) => void;
}) {
  const req = findRequest(entry.requestId);
  const customer = req ? findCustomer(req.customerId) : undefined;
  const escalated = reroutedDecision(entry, entry.threshold) === 'escalated';
  const pending = entry.review === 'pending';

  return (
    <div className="adx__panel">
      <div className="adx__panel-head">
        Transcript {entry.requestId}
        <button
          className="adx__close"
          onClick={onClose}
          aria-label="Close transcript"
        >
          close
        </button>
      </div>

      <div className="adx__req-meta adx__req-meta--block">
        {customer?.name ?? entry.requestId} · {intentLabel(entry.intent)} ·{' '}
        scored at threshold {entry.threshold.toFixed(2)}
      </div>
      {req && <p className="adx__req-text">{req.text}</p>}

      <ol className="adx__transcript" aria-label="Tool call transcript">
        {entry.calls.map((call, i) => (
          <li
            key={`${call.tool}-${i}`}
            className={`adx__tline ${
              call.ok ? 'adx__tline--ok' : 'adx__tline--err'
            }`}
          >
            <span className="adx__tline-idx">{i + 1}</span>
            <span className="adx__tline-name">{call.tool}()</span>
            <span className="adx__tline-detail">{call.detail}</span>
            <span className="adx__tline-state">{call.ok ? 'ok' : 'error'}</span>
          </li>
        ))}
      </ol>

      <div className="adx__replay">
        <span className="adx__replay-line">
          signal {entry.signal.toFixed(2)} x completeness{' '}
          {entry.completeness.toFixed(2)} = confidence{' '}
          <b>{entry.confidence.toFixed(2)}</b>
        </span>
        <span className="adx__replay-line">
          decision: {entry.confidence.toFixed(2)}{' '}
          {entry.confidence >= entry.threshold ? '>=' : '<'} threshold{' '}
          {entry.threshold.toFixed(2)} {'->'}{' '}
          {entry.confidence >= entry.threshold ? 'resolved' : 'escalated'}
        </span>
        <span className="adx__replay-prop">proposal: {entry.resolution}</span>
      </div>

      {escalated && pending ? (
        <div className="adx__review-actions">
          <button
            className="demo__btn"
            onClick={() => onApprove(entry.requestId)}
          >
            Approve proposal
          </button>
          <button
            className="demo__btn demo__btn--ghost"
            onClick={() => onOverride(entry.requestId)}
          >
            Override
          </button>
        </div>
      ) : (
        <div className={`adx__review-state adx__review-state--${entry.review}`}>
          {entry.review === 'pending'
            ? 'In the resolved lane at the current threshold; no human decision needed.'
            : `Recorded in the audit trail: ${entry.review}.`}
        </div>
      )}
    </div>
  );
}

// ---------- audit trail ----------

function Audit({
  audit,
  onReset,
}: {
  audit: AuditEntry[];
  onReset: () => void;
}) {
  return (
    <div
      className="adx__audit-wrap"
      role="tabpanel"
      id="adx-panel-audit"
      aria-labelledby="adx-tab-audit"
    >
      <div className="adx__panel">
        <div className="adx__panel-head">
          Audit trail
          <span className="adx__panel-count">{audit.length}</span>
        </div>
        {audit.length === 0 ? (
          <p className="adx__empty">
            No decisions yet. Process a request to record the first entry.
          </p>
        ) : (
          <ul className="adx__audit-list">
            {audit.map((a, i) => (
              <li key={`${a.at}-${i}`} className={`adx__audit-line adx__audit-line--${a.action}`}>
                <span className="adx__audit-action">{a.action}</span>
                <span className="adx__audit-req">{a.requestId}</span>
                <span className="adx__audit-note">{a.note}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="adx__runner-actions">
          <button className="demo__btn demo__btn--ghost" onClick={onReset}>
            Reset console
          </button>
        </div>
        <p className="adx__empty" style={{ marginTop: 4 }}>
          Reset clears the saved queue progress, threshold, and audit from this
          browser.
        </p>
      </div>
    </div>
  );
}
