import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence, LayoutGroup } from 'framer-motion';
import '../styles/demo.css';
import './Tenure.css';

// Tenure is described in its repository only as a hiring platform, with no
// documented mechanism. This demo illustrates the one concept the description
// supports: candidates advancing through hiring stages. It invents no metrics
// and claims no benchmarks; it is a small interactive model of a pipeline
// board you can step, advance, or reject through.
const STAGES = [
  { id: 'applied', label: 'Applied' },
  { id: 'screen', label: 'Screen' },
  { id: 'interview', label: 'Interview' },
  { id: 'offer', label: 'Offer' },
  { id: 'hired', label: 'Hired' },
] as const;

type StageId = (typeof STAGES)[number]['id'] | 'rejected';

type Candidate = {
  id: string;
  name: string;
  role: string;
  stage: StageId;
};

const ROLES = ['Backend', 'Design', 'Data', 'Platform', 'Mobile'];

const SEED: Candidate[] = [
  { id: 'c1', name: 'A. Rivera', role: 'Backend', stage: 'applied' },
  { id: 'c2', name: 'M. Okafor', role: 'Design', stage: 'applied' },
  { id: 'c3', name: 'L. Tanaka', role: 'Data', stage: 'screen' },
  { id: 'c4', name: 'S. Bauer', role: 'Platform', stage: 'screen' },
  { id: 'c5', name: 'R. Costa', role: 'Mobile', stage: 'interview' },
  { id: 'c6', name: 'J. Park', role: 'Backend', stage: 'interview' },
  { id: 'c7', name: 'D. Mwangi', role: 'Design', stage: 'offer' },
];

const ease = [0.22, 1, 0.36, 1] as const;
const FORWARD: StageId[] = ['applied', 'screen', 'interview', 'offer', 'hired'];

function nextStage(s: StageId): StageId | null {
  const i = FORWARD.indexOf(s);
  if (i < 0 || i >= FORWARD.length - 1) return null;
  return FORWARD[i + 1];
}

let idCounter = 100;

export default function TenureDemo() {
  const reduce = useReducedMotion();
  const [cands, setCands] = useState<Candidate[]>(SEED);
  const [selected, setSelected] = useState<string | null>('c5');
  const [autorun, setAutorun] = useState(false);
  const tickRef = useRef<number | null>(null);

  function stop() {
    if (tickRef.current !== null) clearInterval(tickRef.current);
    tickRef.current = null;
  }
  useEffect(() => stop, []);

  const selectedCand = cands.find((c) => c.id === selected) ?? null;

  function advance(id: string) {
    setCands((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const n = nextStage(c.stage);
        return n ? { ...c, stage: n } : c;
      }),
    );
  }

  function reject(id: string) {
    setCands((prev) =>
      prev.map((c) => (c.id === id ? { ...c, stage: 'rejected' } : c)),
    );
  }

  function addCandidate() {
    const n = idCounter++;
    const role = ROLES[n % ROLES.length];
    setCands((prev) => [
      ...prev,
      {
        id: `c${n}`,
        name: `New ${String.fromCharCode(65 + (n % 26))}.`,
        role,
        stage: 'applied',
      },
    ]);
  }

  function reset() {
    stop();
    setAutorun(false);
    setCands(SEED);
    setSelected('c5');
  }

  // auto-advance: move one in-flight candidate forward each tick
  function step() {
    setCands((prev) => {
      const movable = prev.filter(
        (c) => c.stage !== 'hired' && c.stage !== 'rejected',
      );
      if (movable.length === 0) return prev;
      // advance the one furthest along to keep the board flowing
      const pick = [...movable].sort(
        (a, b) => FORWARD.indexOf(b.stage) - FORWARD.indexOf(a.stage),
      )[0];
      const n = nextStage(pick.stage);
      if (!n) return prev;
      return prev.map((c) => (c.id === pick.id ? { ...c, stage: n } : c));
    });
  }

  function toggleAutorun() {
    if (autorun) {
      stop();
      setAutorun(false);
      return;
    }
    setAutorun(true);
    if (reduce) {
      // collapse to instant: run several steps at once
      for (let i = 0; i < 8; i++) step();
      setAutorun(false);
      return;
    }
    tickRef.current = window.setInterval(step, 900);
  }

  const inFlight = cands.filter(
    (c) => c.stage !== 'hired' && c.stage !== 'rejected',
  ).length;
  const hired = cands.filter((c) => c.stage === 'hired').length;
  const rejected = cands.filter((c) => c.stage === 'rejected').length;

  return (
    <div className="demo" aria-label="Tenure candidate pipeline demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Candidate pipeline</h3>
      <p className="demo__lede">
        Tenure is described as a hiring platform. This board models the one idea
        that description supports: candidates moving through stages. Advance or
        reject a candidate, add a new applicant, or play the pipeline and watch
        the columns rebalance. No metrics are claimed.
      </p>

      <LayoutGroup>
        <div className="tn__board" role="list" aria-label="hiring stages">
          {STAGES.map((stage) => {
            const inStage = cands.filter((c) => c.stage === stage.id);
            return (
              <div
                key={stage.id}
                className={
                  'tn__col' + (stage.id === 'hired' ? ' tn__col--final' : '')
                }
                role="listitem"
              >
                <div className="tn__col-head">
                  <span className="tn__col-name">{stage.label}</span>
                  <span className="tn__col-count">{inStage.length}</span>
                </div>
                <div className="tn__col-body">
                  <AnimatePresence mode="popLayout">
                    {inStage.map((c) => {
                      const isSel = c.id === selected;
                      const canAdvance = !!nextStage(c.stage);
                      return (
                        <motion.button
                          key={c.id}
                          layout={!reduce}
                          type="button"
                          className={'tn__card' + (isSel ? ' tn__card--sel' : '')}
                          onClick={() => setSelected(c.id)}
                          initial={{ opacity: 0, scale: reduce ? 1 : 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: reduce ? 1 : 0.9 }}
                          transition={{ duration: reduce ? 0 : 0.28, ease }}
                          aria-pressed={isSel}
                          aria-label={`${c.name}, ${c.role}, stage ${stage.label}`}
                        >
                          <span className="tn__card-name">{c.name}</span>
                          <span className="tn__card-role">{c.role}</span>
                          {isSel && (
                            <span className="tn__card-actions">
                              <span
                                className="tn__mini"
                                role="button"
                                tabIndex={0}
                                aria-label={`Reject ${c.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  reject(c.id);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    reject(c.id);
                                  }
                                }}
                              >
                                reject
                              </span>
                              {canAdvance && (
                                <span
                                  className="tn__mini tn__mini--go"
                                  role="button"
                                  tabIndex={0}
                                  aria-label={`Advance ${c.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    advance(c.id);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      advance(c.id);
                                    }
                                  }}
                                >
                                  advance
                                </span>
                              )}
                            </span>
                          )}
                        </motion.button>
                      );
                    })}
                  </AnimatePresence>
                  {inStage.length === 0 && (
                    <span className="tn__empty">empty</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </LayoutGroup>

      <div className="tn__stats">
        <div className="tn__stat">
          <span className="tn__stat-v">{inFlight}</span>
          <span className="tn__stat-k">in flight</span>
        </div>
        <div className="tn__stat tn__stat--hired">
          <span className="tn__stat-v">{hired}</span>
          <span className="tn__stat-k">hired</span>
        </div>
        <div className="tn__stat tn__stat--rej">
          <span className="tn__stat-v">{rejected}</span>
          <span className="tn__stat-k">rejected</span>
        </div>
      </div>

      {selectedCand && (
        <p className="tn__sel-note">
          Selected: <b>{selectedCand.name}</b> ({selectedCand.role}) in{' '}
          {selectedCand.stage === 'rejected'
            ? 'rejected'
            : STAGES.find((s) => s.id === selectedCand.stage)?.label ??
              selectedCand.stage}
          . Use advance or reject on the card.
        </p>
      )}

      <div className="demo__controls">
        <button className="demo__btn" onClick={toggleAutorun}>
          {autorun ? 'Pause' : 'Play pipeline'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={addCandidate}>
          Add applicant
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset
        </button>
        <span className="demo__hint">
          {cands.length} candidates across the board
        </span>
      </div>
    </div>
  );
}
