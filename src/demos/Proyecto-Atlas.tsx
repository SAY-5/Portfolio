import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './Proyecto-Atlas.css';

// Real numbers from the project: CONTENIDO mode targets >=95% PDF coverage
// with 4 parallel extractors plus synthesis; ESTUDIO mode targets >=80%
// temario competences with a 3-layer curricular mapper. The resilience layer
// includes a 3-state circuit breaker and a retry-with-feedback synthesis loop.
// A write-gate validates output with Pydantic plus flow rules before insertion.
const CONTENIDO_TARGET = 95; // % PDF coverage
const ESTUDIO_TARGET = 80; // % temario competences

type Mode = 'contenido' | 'estudio';

type Extractor = { id: string; name: string };

const extractorsByMode: Record<Mode, Extractor[]> = {
  contenido: [
    { id: 'concepts', name: 'concept extractor' },
    { id: 'figures', name: 'figure extractor' },
    { id: 'relations', name: 'relation extractor' },
    { id: 'glossary', name: 'glossary extractor' },
  ],
  estudio: [{ id: 'curricular', name: 'curricular extractor' }],
};

const mapperLayers = ['temario', 'competence', 'item'];

type ExtState = 'idle' | 'run' | 'done' | 'fail';
type Breaker = 'closed' | 'half' | 'open';

const ease = [0.22, 1, 0.36, 1] as const;

export default function ProyectoAtlasDemo() {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<Mode>('contenido');
  const [injectFail, setInjectFail] = useState(false);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<'idle' | 'extract' | 'synth' | 'gate' | 'done'>(
    'idle',
  );
  const [extStates, setExtStates] = useState<Record<string, ExtState>>({});
  const [breaker, setBreaker] = useState<Breaker>('closed');
  const [coverage, setCoverage] = useState(0);
  const [retries, setRetries] = useState(0);
  const [passed, setPassed] = useState<boolean | null>(null);
  const timers = useRef<number[]>([]);

  const extractors = extractorsByMode[mode];
  const target = mode === 'contenido' ? CONTENIDO_TARGET : ESTUDIO_TARGET;

  function clearTimers() {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  function reset() {
    clearTimers();
    setRunning(false);
    setStage('idle');
    setExtStates({});
    setBreaker('closed');
    setCoverage(0);
    setRetries(0);
    setPassed(null);
  }

  function pickMode(m: Mode) {
    if (running) return;
    setMode(m);
    reset();
  }

  function schedule(fn: () => void, ms: number) {
    const id = window.setTimeout(fn, reduce ? 0 : ms);
    timers.current.push(id);
  }

  function run() {
    if (running) return;
    reset();
    setRunning(true);
    setStage('extract');

    // Extractors start in parallel.
    extractors.forEach((e) => {
      setExtStates((p) => ({ ...p, [e.id]: 'run' }));
    });

    // In the failure path one extractor trips the breaker; the retry-with-
    // feedback loop reruns synthesis and the breaker recovers half-open then
    // closed before the write-gate passes.
    const failId = extractors[0].id;

    let t = 700;
    extractors.forEach((e, i) => {
      schedule(() => {
        if (injectFail && e.id === failId) {
          setExtStates((p) => ({ ...p, [e.id]: 'fail' }));
          setBreaker('open');
        } else {
          setExtStates((p) => ({ ...p, [e.id]: 'done' }));
        }
      }, t + i * 260);
    });
    t += extractors.length * 260 + 500;

    if (injectFail) {
      // breaker open -> retry-with-feedback -> half-open probe -> closed
      schedule(() => {
        setBreaker('half');
        setRetries(1);
        setExtStates((p) => ({ ...p, [failId]: 'run' }));
      }, t);
      t += 900;
      schedule(() => {
        setExtStates((p) => ({ ...p, [failId]: 'done' }));
        setBreaker('closed');
      }, t);
      t += 700;
    }

    // Synthesis merges extractor output.
    schedule(() => setStage('synth'), t);
    t += 900;

    // Coverage climbs as synthesis consolidates blocks.
    const settle = injectFail ? target + 1 : target + 3;
    schedule(() => {
      const start = performance.now();
      const dur = 800;
      const climb = () => {
        const p = Math.min(1, (performance.now() - start) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        setCoverage(Math.round(settle * e));
        if (p < 1) {
          const id = window.setTimeout(climb, 16);
          timers.current.push(id as unknown as number);
        }
      };
      if (reduce) setCoverage(settle);
      else climb();
    }, t);
    t += 900;

    // Write-gate validates and decides insertion.
    schedule(() => {
      setStage('gate');
      const ok = settle >= target;
      setPassed(ok);
    }, t);
    t += 700;

    schedule(() => {
      setStage('done');
      setRunning(false);
    }, t);
  }

  function extClass(id: string) {
    const s = extStates[id];
    if (s === 'run') return 'pa__ext pa__ext--run';
    if (s === 'done') return 'pa__ext pa__ext--done';
    if (s === 'fail') return 'pa__ext pa__ext--fail';
    return 'pa__ext';
  }
  function extLabel(id: string) {
    const s = extStates[id];
    if (s === 'run') return 'running';
    if (s === 'done') return 'done';
    if (s === 'fail') return 'tripped';
    return 'queued';
  }

  const synthActive = stage === 'synth' || stage === 'gate' || stage === 'done';
  const gateShown = stage === 'gate' || stage === 'done';

  return (
    <div className="demo" aria-label="Proyecto Atlas extraction pipeline demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">PDF to structured blocks, two modes</h3>
      <p className="demo__lede">
        A biology PDF is triaged into a mode, then extractors run in parallel
        and merge into a synthesized summary that must clear the write-gate
        before it lands. Inject a failure to watch the circuit breaker trip and
        the retry-with-feedback loop recover before insertion.
      </p>

      <div className="pa__stage">
        <div className="pa__modes" role="tablist" aria-label="extraction mode">
          <button
            role="tab"
            aria-selected={mode === 'contenido'}
            className={`pa__mode${mode === 'contenido' ? ' pa__mode--on' : ''}`}
            onClick={() => pickMode('contenido')}
          >
            CONTENIDO
            <span className="pa__mode-tag">4 extractors, &gt;={CONTENIDO_TARGET}% coverage</span>
          </button>
          <button
            role="tab"
            aria-selected={mode === 'estudio'}
            className={`pa__mode${mode === 'estudio' ? ' pa__mode--on' : ''}`}
            onClick={() => pickMode('estudio')}
          >
            ESTUDIO
            <span className="pa__mode-tag">3-layer mapper, &gt;={ESTUDIO_TARGET}% temario</span>
          </button>
        </div>

        <div className="pa__flow">
          <div className="pa__col">
            <div className="pa__col-head">Source</div>
            <div className="pa__pdf">
              <div className="pa__pdf-name">biologia_tema_07.pdf</div>
              <div className="pa__pdf-lines">
                {[80, 95, 70, 88, 60].map((w, i) => (
                  <div
                    key={i}
                    className="pa__pdf-line"
                    style={{ width: `${w}%` }}
                  />
                ))}
              </div>
            </div>
            <div className="pa__triage">
              Triaged to{' '}
              <b>{mode === 'contenido' ? 'CONTENIDO' : 'ESTUDIO'}</b>:{' '}
              {mode === 'contenido'
                ? 'exhaustive extraction across the whole document.'
                : 'competence-first extraction against a target exam temario.'}
            </div>
          </div>

          <div className="pa__col">
            <div className="pa__col-head">
              {mode === 'contenido'
                ? 'Parallel extractors'
                : 'Curricular extractor + 3-layer mapper'}
            </div>
            <div className="pa__extractors">
              {extractors.map((e) => (
                <motion.div
                  key={e.id}
                  className={extClass(e.id)}
                  initial={false}
                  animate={
                    reduce
                      ? {}
                      : { scale: extStates[e.id] === 'done' ? [1, 1.02, 1] : 1 }
                  }
                  transition={{ duration: 0.3, ease }}
                >
                  <span className="pa__ext-dot" />
                  <span className="pa__ext-name">{e.name}</span>
                  <span className="pa__ext-state">{extLabel(e.id)}</span>
                </motion.div>
              ))}
              {mode === 'estudio' &&
                mapperLayers.map((l) => (
                  <div key={l} className="pa__ext" style={{ opacity: 0.85 }}>
                    <span className="pa__ext-dot" />
                    <span className="pa__ext-name">map: {l}</span>
                    <span className="pa__ext-state">
                      {synthActive ? 'mapped' : 'layer'}
                    </span>
                  </div>
                ))}
            </div>
            <div className={`pa__breaker pa__breaker--${breaker}`}>
              <span className="pa__breaker-label">circuit breaker</span>
              <span className="pa__breaker-state">{breaker}</span>
              <span className="pa__breaker-meta">
                {retries > 0 ? `retry ${retries} with feedback` : '3-state'}
              </span>
            </div>
          </div>

          <div className="pa__col">
            <div className="pa__col-head">Write-gate</div>
            <div className="pa__gate">
              <div className="pa__blocks">
                <AnimatePresence>
                  {synthActive ? (
                    ['heading', 'concept', 'figure'].map((b, i) => (
                      <motion.div
                        key={b}
                        className="pa__block"
                        initial={{ opacity: 0, x: reduce ? 0 : -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, delay: reduce ? 0 : i * 0.1, ease }}
                      >
                        <span className="pa__block-tag">{b}</span>
                        block synthesized
                      </motion.div>
                    ))
                  ) : (
                    <div className="pa__triage" style={{ border: 'none', padding: 0 }}>
                      Awaiting synthesis output.
                    </div>
                  )}
                </AnimatePresence>
              </div>
              {gateShown && passed !== null && (
                <motion.div
                  className={`pa__gate-bar ${passed ? 'pa__gate-bar--pass' : 'pa__gate-bar--fail'}`}
                  initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease }}
                >
                  <div className="pa__gate-name">
                    {mode === 'contenido' ? 'PDF coverage' : 'temario competences'}
                  </div>
                  <div className="pa__gate-line">
                    <span className="pa__gate-val">{coverage}%</span>
                    <span className="pa__gate-target">target &gt;={target}%</span>
                  </div>
                  <div className="pa__track">
                    <div
                      className="pa__track-fill"
                      style={{ width: `${Math.min(100, coverage)}%` }}
                    />
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </div>

        <AnimatePresence>
          {stage === 'done' && passed !== null && (
            <motion.div
              className={`pa__verdict${passed ? '' : ' pa__verdict--block'}`}
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <span className="pa__verdict-head">
                {passed
                  ? 'Write-gate passed, inserted to Axon'
                  : 'Write-gate blocked insertion'}
              </span>
              <span className="pa__verdict-text">
                {injectFail
                  ? `An extractor failed and tripped the breaker open. The retry-with-feedback loop reran synthesis, the breaker recovered half-open then closed, and the Pydantic plus flow-rule write-gate cleared ${coverage}% against the ${target}% target. Ten post-insertion checks then run against Supabase.`
                  : `Synthesis merged the ${mode === 'contenido' ? 'four extractors' : 'mapped layers'} into structured blocks that cleared ${coverage}% against the ${target}% target, so the write-gate validated with Pydantic plus flow rules and inserted the blocks.`}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Running…' : 'Run pipeline'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <label className="demo__hint" style={{ cursor: running ? 'default' : 'pointer' }}>
          <input
            type="checkbox"
            checked={injectFail}
            disabled={running}
            onChange={(e) => setInjectFail(e.target.checked)}
            style={{ marginRight: 6, accentColor: 'var(--accent)' }}
          />
          inject extractor failure
        </label>
      </div>
    </div>
  );
}
