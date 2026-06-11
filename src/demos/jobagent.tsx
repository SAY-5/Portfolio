import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './jobagent.css';

// Each Easy Apply field is classified into one of about 17 ResumeSection slots.
// A layered classifier runs a regex prefilter and a cache before any model
// call, and a separate policy engine decides fill, review, or skip from
// confidence, field kind, and whether the field is required. Default mode is
// shadow: fill, screenshot, never submit.

type Layer = 'regex' | 'cache' | 'model';
type Decision = 'fill' | 'review' | 'skip';

type Field = {
  id: string;
  label: string;
  kind: 'text' | 'select' | 'file' | 'required';
  slot: string; // ResumeSection slot, or UNMAPPED
  resolvedBy: Layer;
  confidence: number; // 0..1
  required: boolean;
};

// Policy thresholds: fill needs high confidence; the rest go to review or skip.
const FILL_THRESHOLD = 0.85;
const REVIEW_THRESHOLD = 0.6;

const FIELDS: Field[] = [
  { id: 'f1', label: 'First name', kind: 'text', slot: 'identity.first_name', resolvedBy: 'regex', confidence: 0.98, required: true },
  { id: 'f2', label: 'Email address', kind: 'text', slot: 'contact.email', resolvedBy: 'regex', confidence: 0.97, required: true },
  { id: 'f3', label: 'Years of Python experience', kind: 'text', slot: 'skills.python_years', resolvedBy: 'cache', confidence: 0.91, required: true },
  { id: 'f4', label: 'Most recent job title', kind: 'text', slot: 'experience.title', resolvedBy: 'model', confidence: 0.88, required: true },
  { id: 'f5', label: 'Why are you a good fit for this team?', kind: 'text', slot: 'UNMAPPED', resolvedBy: 'model', confidence: 0.41, required: false },
  { id: 'f6', label: 'Preferred pronouns', kind: 'select', slot: 'identity.pronouns', resolvedBy: 'model', confidence: 0.72, required: false },
  { id: 'f7', label: 'Upload resume', kind: 'file', slot: 'document.resume', resolvedBy: 'regex', confidence: 0.99, required: true },
];

const LAYER_META: Record<Layer, { name: string; sub: string }> = {
  regex: { name: 'Regex prefilter', sub: 'pattern match on the label, no model call' },
  cache: { name: 'Cache', sub: 'keyed on label_hash and options_hash' },
  model: { name: 'Model classify', sub: 'structured output, closed-set schema' },
};

const ease = [0.22, 1, 0.36, 1] as const;

function decide(f: Field): { decision: Decision; why: string } {
  if (f.kind === 'file') {
    return { decision: 'review', why: 'file uploads never auto-fill regardless of confidence' };
  }
  if (f.slot === 'UNMAPPED') {
    return { decision: 'skip', why: 'label falls outside the closed schema, opted out as UNMAPPED' };
  }
  if (f.confidence >= FILL_THRESHOLD) {
    return { decision: 'fill', why: `confidence ${(f.confidence * 100).toFixed(0)}% clears the fill bar` };
  }
  if (f.confidence >= REVIEW_THRESHOLD) {
    return {
      decision: 'review',
      why: f.required
        ? 'required field below the fill bar, sent to review'
        : 'mid confidence, sent to review',
    };
  }
  return { decision: 'skip', why: 'confidence below the review bar' };
}

export default function JobagentDemo() {
  const reduce = useReducedMotion();
  const [results, setResults] = useState<Record<string, Decision>>({});
  const [current, setCurrent] = useState<string | null>(null);
  const [activeLayer, setActiveLayer] = useState<Layer | null>(null);
  const [running, setRunning] = useState(false);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function wait(ms: number) {
    return new Promise<void>((resolve) => {
      const id = window.setTimeout(resolve, reduce ? 0 : ms);
      timers.current.push(id);
    });
  }

  function reset() {
    clearTimers();
    setResults({});
    setCurrent(null);
    setActiveLayer(null);
    setRunning(false);
  }

  // Walk a field through the layers up to the one that resolves it.
  async function classify(f: Field) {
    setCurrent(f.id);
    const order: Layer[] = ['regex', 'cache', 'model'];
    const stopAt = order.indexOf(f.resolvedBy);
    for (let i = 0; i <= stopAt; i += 1) {
      setActiveLayer(order[i]);
      await wait(360);
    }
    const { decision } = decide(f);
    setResults((r) => ({ ...r, [f.id]: decision }));
    setActiveLayer(null);
  }

  async function runAll() {
    if (running) return;
    setRunning(true);
    setResults({});
    for (const f of FIELDS) {
      await classify(f);
      await wait(180);
    }
    setCurrent(null);
    setRunning(false);
  }

  async function runOne(f: Field) {
    if (running) return;
    setRunning(true);
    await classify(f);
    setRunning(false);
  }

  const currentField = FIELDS.find((f) => f.id === current) ?? null;
  const currentDecision = currentField ? decide(currentField) : null;

  const filled = Object.values(results).filter((d) => d === 'fill').length;
  const reviewed = Object.values(results).filter((d) => d === 'review').length;
  const noModel = FIELDS.filter(
    (f) => results[f.id] !== undefined && f.resolvedBy !== 'model',
  ).length;
  const decidedCount = Object.keys(results).length;

  return (
    <div className="demo" aria-label="jobagent form-filling demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Layered field classification</h3>
      <p className="demo__lede">
        Each form label flows through a regex prefilter and a cache before any
        model call, then a policy engine decides fill, review, or skip from
        confidence, field kind, and whether the field is required. Default mode
        is shadow: fill, screenshot, never submit.
      </p>

      <div className="ja__stage">
        <div className="ja__layers">
          {(['regex', 'cache', 'model'] as Layer[]).map((layer) => {
            const isActive = activeLayer === layer;
            const isHit =
              currentField !== null && currentField.resolvedBy === layer && activeLayer === null && results[currentField.id] !== undefined;
            let badge: 'hit' | 'miss' | 'call' | null = null;
            if (currentField) {
              const order: Layer[] = ['regex', 'cache', 'model'];
              const stopAt = order.indexOf(currentField.resolvedBy);
              const thisIdx = order.indexOf(layer);
              if (results[currentField.id] !== undefined || isActive) {
                if (thisIdx < stopAt) badge = 'miss';
                else if (thisIdx === stopAt) badge = layer === 'model' ? 'call' : 'hit';
              }
            }
            return (
              <div
                key={layer}
                className={`ja__layer${isActive ? ' ja__layer--active' : ''}${isHit ? ' ja__layer--hit' : ''}`}
              >
                <div className="ja__layer-name">{LAYER_META[layer].name}</div>
                <div className="ja__layer-sub">{LAYER_META[layer].sub}</div>
                {badge === 'hit' && <span className="ja__layer-badge ja__layer-badge--hit">resolved</span>}
                {badge === 'call' && <span className="ja__layer-badge ja__layer-badge--call">model call</span>}
                {badge === 'miss' && <span className="ja__layer-badge ja__layer-badge--miss">miss</span>}
              </div>
            );
          })}
        </div>

        <div className="ja__form" role="list" aria-label="form fields">
          {FIELDS.map((f) => {
            const decision = results[f.id];
            const isCurrent = current === f.id && running;
            const cls = [
              'ja__field',
              isCurrent ? 'ja__field--current' : '',
              decision ? `ja__field--${decision}` : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <button
                key={f.id}
                type="button"
                role="listitem"
                className={cls}
                onClick={() => runOne(f)}
                disabled={running}
                aria-label={`Classify field ${f.label}`}
              >
                <span>
                  <span className="ja__field-label">{f.label}</span>{' '}
                  <span className="ja__field-kind">
                    {f.kind}
                    {f.required ? ' / required' : ''}
                  </span>
                </span>
                <span className="ja__field-state">
                  {decision ? decision : isCurrent ? '...' : 'queued'}
                </span>
              </button>
            );
          })}
        </div>

        <div className="ja__readout" aria-live="polite">
          <div className="ja__readout-head">Classification readout</div>
          <AnimatePresence mode="wait">
            {currentField && currentDecision ? (
              <motion.div
                key={currentField.id}
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.25, ease }}
                style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
              >
                <div className="ja__slot">
                  <span className="ja__slot-label">slot</span>
                  <span className="ja__slot-name">{currentField.slot}</span>
                </div>
                <div className="ja__conf-row">
                  <div className="ja__conf-label">
                    <span>confidence</span>
                    <b>{(currentField.confidence * 100).toFixed(0)}%</b>
                  </div>
                  <div className="ja__conf-track">
                    <motion.div
                      className="ja__conf-fill"
                      style={{
                        background:
                          currentDecision.decision === 'fill'
                            ? '#4fd08a'
                            : currentDecision.decision === 'review'
                              ? 'var(--accent)'
                              : 'var(--paper-faint)',
                      }}
                      initial={{ width: 0 }}
                      animate={{ width: `${currentField.confidence * 100}%` }}
                      transition={{ duration: reduce ? 0 : 0.5, ease }}
                    />
                    <span className="ja__conf-threshold" style={{ left: `${FILL_THRESHOLD * 100}%` }} />
                  </div>
                </div>
                <span className={`ja__decision ja__decision--${currentDecision.decision}`}>
                  {currentDecision.decision}
                </span>
                <span className="ja__decision-why">{currentDecision.why}</span>
              </motion.div>
            ) : (
              <p key="empty" className="ja__readout-empty">
                Run all fields or pick one to classify it through the layers.
              </p>
            )}
          </AnimatePresence>
          <div className="ja__shadow">
            mode <b>shadow</b> fill, screenshot, never submit
          </div>
        </div>

        <div className="ja__stats">
          <div className="ja__stat">
            <span className="ja__stat-val">{decidedCount === 0 ? 0 : noModel}</span>
            <span className="ja__stat-label">resolved without a model call</span>
          </div>
          <div className="ja__stat">
            <span className="ja__stat-val">{filled}</span>
            <span className="ja__stat-label">auto-filled</span>
          </div>
          <div className="ja__stat">
            <span className="ja__stat-val">{reviewed}</span>
            <span className="ja__stat-label">sent to review</span>
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={runAll} disabled={running}>
          {running ? 'Classifying...' : 'Run all fields'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={running}>
          Reset
        </button>
        <span className="demo__hint">17 ResumeSection slots plus an UNMAPPED opt-out</span>
      </div>
    </div>
  );
}
