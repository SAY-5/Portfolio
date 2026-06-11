import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './datafinder.css';

// Real mechanism from the project: a rule-based router picks one of four
// routes (semantic, metadata, hybrid, preview_only) in about 30 lines running
// in microseconds, the agent sequences tool calls, then a grounding loop
// retries with a refined system message when the answer references no dataset
// id seen in tool results, bounded by max_refinements.

const ROUTES = [
  { id: 'semantic', name: 'semantic', desc: 'conceptual queries' },
  { id: 'metadata', name: 'metadata', desc: 'hard spec filters' },
  { id: 'hybrid', name: 'hybrid', desc: 'mixed / ambiguous' },
  { id: 'preview_only', name: 'preview_only', desc: 'ds_* references' },
] as const;

type RouteId = (typeof ROUTES)[number]['id'];
type Token = { text: string; field?: boolean };

type Scenario = {
  id: string;
  label: string;
  route: RouteId;
  tokens: Token[];
  tools: string[];
  // whether the first grounding pass references a dataset it actually saw
  groundsFirstPass: boolean;
  answer: { text: string; cite: string };
};

const SCENARIOS: Scenario[] = [
  {
    id: 'q1',
    label: 'knee MRI cohort, cartilage thickness, 50+ subjects, age 40+',
    route: 'hybrid',
    tokens: [
      { text: 'anatomy:knee', field: true },
      { text: 'modality:MRI', field: true },
      { text: 'annot:cartilage' },
      { text: 'min_subjects:50', field: true },
      { text: 'age_lower:40', field: true },
    ],
    tools: ['metadata_filter', 'semantic_search', 'dataset_preview'],
    groundsFirstPass: false,
    answer: {
      text: 'Two cohorts match: OAI knee MRI with cartilage thickness maps',
      cite: 'ds_oai_knee_2k',
    },
  },
  {
    id: 'q2',
    label: 'datasets about brain connectivity in aging',
    route: 'semantic',
    tokens: [
      { text: 'brain' },
      { text: 'connectivity' },
      { text: 'aging' },
    ],
    tools: ['semantic_search'],
    groundsFirstPass: true,
    answer: {
      text: 'Closest match is a resting-state fMRI connectome set',
      cite: 'ds_hcp_aging',
    },
  },
  {
    id: 'q3',
    label: 'chest CT, at least 200 subjects, lesion masks',
    route: 'metadata',
    tokens: [
      { text: 'anatomy:chest', field: true },
      { text: 'modality:CT', field: true },
      { text: 'min_subjects:200', field: true },
      { text: 'annot:lesion', field: true },
    ],
    tools: ['metadata_filter'],
    groundsFirstPass: true,
    answer: {
      text: 'One cohort clears the filters with lesion segmentation masks',
      cite: 'ds_lidc_ct',
    },
  },
  {
    id: 'q4',
    label: 'preview ds_oai_knee_2k',
    route: 'preview_only',
    tokens: [{ text: 'ref:ds_oai_knee_2k', field: true }],
    tools: ['dataset_preview'],
    groundsFirstPass: true,
    answer: {
      text: '4796 subjects, knee MRI, cartilage thickness + KL grade labels',
      cite: 'ds_oai_knee_2k',
    },
  },
];

const MAX_REFINEMENTS = 2;
const ROUTER_LINES = 30;

type Step = 'idle' | 'normalize' | 'route' | 'tools' | 'ground' | 'done';

export default function DatafinderDemo() {
  const reduce = useReducedMotion();
  const [activeId, setActiveId] = useState<string>('q1');
  const [step, setStep] = useState<Step>('idle');
  const [toolsShown, setToolsShown] = useState(0);
  const [refinements, setRefinements] = useState(0);
  const [running, setRunning] = useState(false);
  const timers = useRef<number[]>([]);

  const sc = SCENARIOS.find((s) => s.id === activeId)!;

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function pick(id: string) {
    if (running) return;
    clearTimers();
    setActiveId(id);
    setStep('idle');
    setToolsShown(0);
    setRefinements(0);
  }

  function at(ms: number, fn: () => void) {
    timers.current.push(window.setTimeout(fn, reduce ? 0 : ms));
  }

  function run() {
    if (running) return;
    clearTimers();
    setRunning(true);
    setStep('normalize');
    setToolsShown(0);
    setRefinements(0);

    if (reduce) {
      setStep('done');
      setToolsShown(sc.tools.length);
      setRefinements(sc.groundsFirstPass ? 0 : 1);
      setRunning(false);
      return;
    }

    at(520, () => setStep('route'));
    at(1040, () => setStep('tools'));
    sc.tools.forEach((_, i) => {
      at(1300 + i * 460, () => setToolsShown(i + 1));
    });
    const afterTools = 1300 + sc.tools.length * 460 + 200;
    at(afterTools, () => setStep('ground'));
    if (!sc.groundsFirstPass) {
      // ungrounded first pass: refine the system message and retry once
      at(afterTools + 560, () => setRefinements(1));
      at(afterTools + 1320, () => {
        setStep('done');
        setRunning(false);
      });
    } else {
      at(afterTools + 620, () => {
        setStep('done');
        setRunning(false);
      });
    }
  }

  const showNormalize = step !== 'idle';
  const showRoute = step === 'route' || step === 'tools' || step === 'ground' || step === 'done';
  const showTools = step === 'tools' || step === 'ground' || step === 'done';
  const showGround = step === 'ground' || step === 'done';
  const ease = [0.22, 1, 0.36, 1] as const;

  return (
    <div className="demo" aria-label="datafinder routing and grounding demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Route, sequence, ground</h3>
      <p className="demo__lede">
        Pick a dataset-finding question, then run the agent. It normalizes the
        query into filter fields, the rule-based router picks one of four
        paths, the chosen tools fire in sequence, and the grounding loop
        retries with a refined message when the answer cites no dataset it
        actually saw.
      </p>

      <div className="df__stage">
        <div className="df__queries" role="group" aria-label="example queries">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              className={`df__q${s.id === activeId ? ' df__q--on' : ''}`}
              aria-pressed={s.id === activeId}
              onClick={() => pick(s.id)}
            >
              {s.label}
              <span className="df__q-route">{s.route}</span>
            </button>
          ))}
        </div>

        <div className="df__pipe">
          <div>
            <div className="df__stepname">1 normalize</div>
            <div className="df__normalize">
              <AnimatePresence>
                {showNormalize &&
                  sc.tokens.map((t, i) => (
                    <motion.span
                      key={`${sc.id}-${t.text}`}
                      className={`df__token${t.field ? ' df__token--field' : ''}`}
                      initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3, delay: reduce ? 0 : i * 0.07, ease }}
                    >
                      {t.text}
                    </motion.span>
                  ))}
              </AnimatePresence>
              {!showNormalize && (
                <span className="df__tool-empty">run to extract filter fields</span>
              )}
            </div>
          </div>

          <div>
            <div className="df__stepname">2 route ({ROUTER_LINES} lines, microseconds)</div>
            <div className="df__routes">
              {ROUTES.map((r) => {
                const on = showRoute && r.id === sc.route;
                return (
                  <div key={r.id} className={`df__route${on ? ' df__route--on' : ''}`}>
                    <span className="df__route-name">{r.name}</span>
                    <span className="df__route-desc">{r.desc}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="df__stepname">3 sequence tools</div>
            <div className="df__tools">
              <AnimatePresence>
                {showTools &&
                  sc.tools.slice(0, toolsShown).map((tool, i) => (
                    <motion.span
                      key={`${sc.id}-${tool}`}
                      className="df__tool"
                      initial={{ opacity: 0, scale: reduce ? 1 : 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.28, ease }}
                    >
                      <span className="df__tool-seq">{i + 1}</span>
                      {tool}
                    </motion.span>
                  ))}
              </AnimatePresence>
              {(!showTools || toolsShown === 0) && (
                <span className="df__tool-empty">tools dispatched after routing</span>
              )}
            </div>
          </div>

          <div>
            <div className="df__stepname">4 ground answer</div>
            <div className="df__ground">
              <AnimatePresence>
                {showGround && refinements > 0 && (
                  <motion.div
                    className="df__refine"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease }}
                  >
                    answer cited no dataset seen in tool results: refine system
                    message, retry ({refinements} of {MAX_REFINEMENTS})
                  </motion.div>
                )}
              </AnimatePresence>
              {step === 'done' ? (
                <motion.div
                  className="df__answer"
                  initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.36, ease }}
                >
                  <p className="df__answer-text">
                    {sc.answer.text}{' '}
                    <span className="df__cite">[{sc.answer.cite}]</span>
                  </p>
                </motion.div>
              ) : (
                <span className="df__answer-pending">
                  grounded answer carries source citations
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="df__meta">
          <div className="df__stat">
            <div className="df__stat-val">{sc.tools.length}</div>
            <div className="df__stat-unit">tools sequenced</div>
          </div>
          <div className="df__stat">
            <div className="df__stat-val">
              {step === 'done' ? refinements : 0}
              <span style={{ fontSize: '0.5em', color: 'var(--text-faint)' }}>
                {' '}/ {MAX_REFINEMENTS}
              </span>
            </div>
            <div className="df__stat-unit">refinements used</div>
          </div>
          <div className="df__stat">
            <div className="df__stat-val">38</div>
            <div className="df__stat-unit">tests green</div>
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Running…' : 'Run agent'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => pick(activeId)}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">
          route: {sc.route} · {sc.groundsFirstPass ? 'grounds first pass' : 'needs one refinement'}
        </span>
      </div>
    </div>
  );
}
