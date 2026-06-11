import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './setup-agents.css';

// Real behavior from the project: one command scans a project for detection
// signals, preselects matching role profiles out of 11 (Developer, Architect,
// BA, PM, MuleSoft, UX, CGCloud, DevOps, QA, CRMA, Data Cloud), and generates
// per-tool rule files plus a sub-agent routing manifest. Profiles are
// combinable, so rules from several roles stack in one project.

type Signal = {
  id: string;
  file: string;
  detects: string; // human label of what it means
  profiles: string[]; // profiles this signal preselects
  on: boolean;
};

const initialSignals: Signal[] = [
  { id: 'sfdx', file: 'sfdx-project.json', detects: 'Salesforce DX project', profiles: ['Developer'], on: true },
  { id: 'cgcloud', file: 'cgcloud__*', detects: 'Consumer Goods Cloud objects', profiles: ['CGCloud'], on: true },
  { id: 'wave', file: 'WaveDashboard', detects: 'CRM Analytics assets', profiles: ['CRMA'], on: false },
  { id: 'datastream', file: 'DataStream', detects: 'Data Cloud streams', profiles: ['Data Cloud'], on: false },
  { id: 'pw', file: 'playwright.config.ts', detects: 'Playwright test config', profiles: ['QA'], on: true },
];

// The 11 combinable role profiles. Order kept stable for the matrix columns.
const allProfiles = [
  'Developer',
  'Architect',
  'BA',
  'PM',
  'MuleSoft',
  'UX',
  'CGCloud',
  'DevOps',
  'QA',
  'CRMA',
  'Data Cloud',
];

// The routing manifest: each task type maps to the role profile that owns it.
const routing: { task: string; role: string }[] = [
  { task: 'apex.service', role: 'Developer' },
  { task: 'solution.design', role: 'Architect' },
  { task: 'requirement.spec', role: 'BA' },
  { task: 'retail.execution', role: 'CGCloud' },
  { task: 'e2e.test', role: 'QA' },
  { task: 'analytics.dashboard', role: 'CRMA' },
  { task: 'data.stream', role: 'Data Cloud' },
];

// The developer tools that each receive a scaffolded rule file.
const tools = ['editor', 'cli', 'ide', 'linter', 'runner', 'shell'];

export default function SetupAgentsDemo() {
  const reduce = useReducedMotion();
  const [signals, setSignals] = useState<Signal[]>(initialSignals);
  const [generated, setGenerated] = useState(false);

  const active = signals.filter((s) => s.on);
  // Selected profiles: union of every active signal's profiles, stacked.
  const selected = Array.from(
    new Set(active.flatMap((s) => s.profiles)),
  );
  // Routing rows that resolve to a selected profile are wired; others fall back.
  const routedRows = routing.filter((r) => selected.includes(r.role));

  function toggle(id: string) {
    setSignals((prev) => prev.map((s) => (s.id === id ? { ...s, on: !s.on } : s)));
    setGenerated(false);
  }

  return (
    <div className="demo" aria-label="setup-agents project scan demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Scan, preselect, generate</h3>
      <p className="demo__lede">
        One command scans the project for detection signals and preselects role
        profiles from the 11 available. Toggle a signal to see profiles stack,
        then generate the per-tool rule files and the routing manifest.
      </p>

      <div className="sa__grid">
        <section className="sa__signals" aria-label="detection signals">
          <div className="sa__panel-head">Project scan</div>
          <ul className="sa__sig-list">
            {signals.map((s) => (
              <li key={s.id}>
                <button
                  className={'sa__sig' + (s.on ? ' sa__sig--on' : '')}
                  onClick={() => toggle(s.id)}
                  aria-pressed={s.on}
                >
                  <span className="sa__sig-check" aria-hidden="true">
                    {s.on ? '✓' : ''}
                  </span>
                  <span className="sa__sig-body">
                    <span className="sa__sig-file">{s.file}</span>
                    <span className="sa__sig-detects">{s.detects}</span>
                  </span>
                  <span className="sa__sig-profiles">
                    {s.profiles.map((p) => (
                      <span key={p} className="sa__sig-pill">
                        {p}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="sa__profiles" aria-label="role profiles">
          <div className="sa__panel-head">
            <span>Role profiles</span>
            <span className="sa__panel-meta">
              {selected.length} of {allProfiles.length} stacked
            </span>
          </div>
          <div className="sa__chips">
            {allProfiles.map((p) => {
              const on = selected.includes(p);
              return (
                <motion.span
                  key={p}
                  className={'sa__profile' + (on ? ' sa__profile--on' : '')}
                  animate={{ scale: on && !reduce ? 1 : 1 }}
                  layout={!reduce}
                >
                  {p}
                </motion.span>
              );
            })}
          </div>
          <p className="sa__stack-note">
            Profiles are combinable, so their rules stack in one project.
          </p>
        </section>
      </div>

      <div className="sa__cta">
        <button
          className="demo__btn"
          onClick={() => setGenerated(true)}
          disabled={selected.length === 0}
        >
          Generate config
        </button>
        <span className="demo__hint">
          {selected.length === 0
            ? 'enable at least one signal to generate'
            : `${tools.length} tool files + 1 routing manifest`}
        </span>
      </div>

      <AnimatePresence>
        {generated && (
          <motion.div
            className="sa__out"
            initial={{ opacity: 0, y: reduce ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          >
            <div className="sa__out-cols">
              <div className="sa__files" aria-label="scaffolded rule files">
                <div className="sa__panel-head">Per-tool rule files</div>
                <ul className="sa__file-list">
                  {tools.map((t, i) => (
                    <motion.li
                      key={t}
                      className="sa__file"
                      initial={{ opacity: reduce ? 1 : 0, x: reduce ? 0 : -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: reduce ? 0 : 0.25, delay: reduce ? 0 : i * 0.05 }}
                    >
                      <span className="sa__file-icon" aria-hidden="true" />
                      {t}.rules.md
                    </motion.li>
                  ))}
                </ul>
              </div>

              <div className="sa__matrix" aria-label="routing manifest">
                <div className="sa__panel-head">Routing manifest</div>
                <table className="sa__table">
                  <thead>
                    <tr>
                      <th>task type</th>
                      <th>role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routing.map((r, i) => {
                      const wired = selected.includes(r.role);
                      return (
                        <motion.tr
                          key={r.task}
                          className={wired ? 'sa__row--wired' : 'sa__row--fallback'}
                          initial={{ opacity: reduce ? 1 : 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: reduce ? 0 : 0.25, delay: reduce ? 0 : i * 0.05 }}
                        >
                          <td>{r.task}</td>
                          <td>
                            {wired ? r.role : <span className="sa__fallback">Developer (fallback)</span>}
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="sa__matrix-note">
                  {routedRows.length} task types routed to the stacked profiles.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
