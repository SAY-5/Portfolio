import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './bug-triage.css';

// Real numbers from the project:
// - Closed-enum classification: severity {critical, high, medium, low},
//   component {api, core, util, tests, build}; Pydantic raises on out-of-enum.
// - Hermetic 20-case eval: top1 and top3 retrieval 1.00, diffs parse 1.00.
// - 200-resolution bench: top-1 0.70, top-3 0.94, p50 latency about 10 ms.
// - Apply-and-test loop git-applies the diff and runs mvn verify.

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
const COMPONENTS = ['api', 'core', 'util', 'tests', 'build'] as const;

type Severity = (typeof SEVERITIES)[number];
type Component = (typeof COMPONENTS)[number];

type Retrieved = { id: string; title: string; score: number };

type Report = {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  component: Component;
  retrieved: Retrieved[];
  diff: string[];
  verify: { passed: boolean; tests: number; failures: number };
};

const REPORTS: Report[] = [
  {
    id: 'BUG-417',
    title: 'NullPointerException parsing empty request body',
    body: 'POST /orders with an empty body throws NPE before validation runs.',
    severity: 'high',
    component: 'api',
    retrieved: [
      { id: 'FIX-208', title: 'Guard null body in OrderController', score: 0.94 },
      { id: 'FIX-051', title: 'Default to empty map on missing payload', score: 0.82 },
      { id: 'FIX-133', title: 'Validate request before deserialize', score: 0.77 },
    ],
    diff: [
      '--- a/src/main/java/app/OrderController.java',
      '+++ b/src/main/java/app/OrderController.java',
      '@@ -42,6 +42,9 @@ public Response create(Request req) {',
      '+    if (req.body() == null || req.body().isEmpty()) {',
      '+        return Response.badRequest("empty body");',
      '+    }',
      '     var order = mapper.read(req.body());',
    ],
    verify: { passed: true, tests: 38, failures: 0 },
  },
  {
    id: 'BUG-902',
    title: 'Off-by-one in pagination offset',
    body: 'Page 2 skips one record because offset is computed as page * size.',
    severity: 'medium',
    component: 'core',
    retrieved: [
      { id: 'FIX-310', title: 'Fix paging offset to (page-1)*size', score: 0.91 },
      { id: 'FIX-076', title: 'Clamp page index to >= 1', score: 0.79 },
      { id: 'FIX-244', title: 'Add boundary test for first page', score: 0.71 },
    ],
    diff: [
      '--- a/src/main/java/app/Pager.java',
      '+++ b/src/main/java/app/Pager.java',
      '@@ -17,7 +17,7 @@ public List<Row> page(int page, int size) {',
      '-    int offset = page * size;',
      '+    int offset = (page - 1) * size;',
      '     return store.slice(offset, size);',
    ],
    verify: { passed: true, tests: 38, failures: 0 },
  },
  {
    id: 'BUG-555',
    title: 'Resource leak: input stream never closed',
    body: 'ConfigLoader opens a stream and returns early on parse error, leaking it.',
    severity: 'low',
    component: 'util',
    retrieved: [
      { id: 'FIX-189', title: 'Wrap stream in try-with-resources', score: 0.88 },
      { id: 'FIX-402', title: 'Close reader in finally block', score: 0.83 },
      { id: 'FIX-021', title: 'Use Files.newBufferedReader', score: 0.69 },
    ],
    diff: [
      '--- a/src/main/java/app/ConfigLoader.java',
      '+++ b/src/main/java/app/ConfigLoader.java',
      '@@ -28,8 +28,7 @@ public Config load(Path path) {',
      '-    InputStream in = Files.newInputStream(path);',
      '-    return parse(in);',
      '+    try (InputStream in = Files.newInputStream(path)) {',
      '+        return parse(in);',
      '+    }',
    ],
    verify: { passed: false, tests: 38, failures: 1 },
  },
];

const STAGES = ['classify', 'retrieve', 'suggest', 'verify'] as const;
type Stage = (typeof STAGES)[number];
const ease = [0.22, 1, 0.36, 1] as const;

export default function BugTriageDemo() {
  const reduce = useReducedMotion();
  const [reportId, setReportId] = useState(REPORTS[0].id);
  const [stage, setStage] = useState(0); // 0 = nothing run yet; 1..4 reveal stages
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const report = REPORTS.find((r) => r.id === reportId)!;

  function clearTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => clearTimer, []);

  function selectReport(id: string) {
    if (running) return;
    clearTimer();
    setReportId(id);
    setStage(0);
  }

  function run() {
    clearTimer();
    if (reduce) {
      setStage(STAGES.length);
      setRunning(false);
      return;
    }
    setRunning(true);
    setStage(0);
    const step = (s: number) => {
      setStage(s);
      if (s < STAGES.length) {
        timer.current = setTimeout(() => step(s + 1), 620);
      } else {
        setRunning(false);
        timer.current = null;
      }
    };
    timer.current = setTimeout(() => step(1), 120);
  }

  function reset() {
    clearTimer();
    setRunning(false);
    setStage(0);
  }

  const reached = (s: Stage) => stage >= STAGES.indexOf(s) + 1;

  return (
    <div className="demo" aria-label="bug-triage pipeline demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Triage a bug report</h3>
      <p className="demo__lede">
        Pick a report and run it through the pipeline: a classifier pins
        severity and component to closed enums, a retriever pulls the top-3
        similar past fixes, and a suggested unified diff is git-applied to the
        Java project before mvn verify gives the verdict.
      </p>

      <div className="bt__picker" role="group" aria-label="Select a bug report">
        {REPORTS.map((r) => {
          const on = r.id === reportId;
          return (
            <button
              key={r.id}
              type="button"
              className={`bt__pick${on ? ' bt__pick--on' : ''}`}
              aria-pressed={on}
              onClick={() => selectReport(r.id)}
            >
              <span className="bt__pick-id">{r.id}</span>
              <span className="bt__pick-title">{r.title}</span>
            </button>
          );
        })}
      </div>

      <div className="bt__stage">
        {/* Stage 1: classifier with closed enums */}
        <section className={`bt__panel${reached('classify') ? ' bt__panel--on' : ''}`}>
          <header className="bt__panel-head">
            <span className="bt__panel-step">1</span>
            <span className="bt__panel-name">Classify</span>
            <span className="bt__panel-note">closed enums, Pydantic-validated</span>
          </header>
          <div className="bt__enum-group">
            <span className="bt__enum-label">severity</span>
            <div className="bt__enum-row">
              {SEVERITIES.map((s) => {
                const picked = reached('classify') && s === report.severity;
                return (
                  <span
                    key={s}
                    className={`bt__enum${picked ? ' bt__enum--picked' : ''}`}
                  >
                    {s}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="bt__enum-group">
            <span className="bt__enum-label">component</span>
            <div className="bt__enum-row">
              {COMPONENTS.map((c) => {
                const picked = reached('classify') && c === report.component;
                return (
                  <span
                    key={c}
                    className={`bt__enum${picked ? ' bt__enum--picked' : ''}`}
                  >
                    {c}
                  </span>
                );
              })}
            </div>
          </div>
        </section>

        {/* Stage 2: retriever top-3 */}
        <section className={`bt__panel${reached('retrieve') ? ' bt__panel--on' : ''}`}>
          <header className="bt__panel-head">
            <span className="bt__panel-step">2</span>
            <span className="bt__panel-name">Retrieve</span>
            <span className="bt__panel-note">top-3 similar past fixes</span>
          </header>
          <ol className="bt__retr">
            <AnimatePresence>
              {reached('retrieve') &&
                report.retrieved.map((r, i) => (
                  <motion.li
                    key={r.id}
                    className="bt__retr-row"
                    initial={{ opacity: 0, x: reduce ? 0 : -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: reduce ? 0 : 0.32, delay: reduce ? 0 : i * 0.09, ease }}
                  >
                    <span className="bt__retr-rank">{i + 1}</span>
                    <span className="bt__retr-id">{r.id}</span>
                    <span className="bt__retr-title">{r.title}</span>
                    <span className="bt__retr-score">{r.score.toFixed(2)}</span>
                  </motion.li>
                ))}
            </AnimatePresence>
          </ol>
        </section>

        {/* Stage 3: suggested diff */}
        <section className={`bt__panel${reached('suggest') ? ' bt__panel--on' : ''}`}>
          <header className="bt__panel-head">
            <span className="bt__panel-step">3</span>
            <span className="bt__panel-name">Suggest</span>
            <span className="bt__panel-note">unified diff, git-applied</span>
          </header>
          <pre className="bt__diff" aria-label="suggested unified diff">
            {reached('suggest')
              ? report.diff.map((line, i) => {
                  const kind = line.startsWith('+++') || line.startsWith('---')
                    ? 'file'
                    : line.startsWith('@@')
                    ? 'hunk'
                    : line.startsWith('+')
                    ? 'add'
                    : line.startsWith('-')
                    ? 'del'
                    : 'ctx';
                  return (
                    <span key={i} className={`bt__diff-line bt__diff-line--${kind}`}>
                      {line}
                    </span>
                  );
                })
              : <span className="bt__diff-line bt__diff-line--ctx">awaiting suggestion</span>}
          </pre>
        </section>

        {/* Stage 4: mvn verify */}
        <section
          className={`bt__panel${reached('verify') ? ' bt__panel--on' : ''}${
            reached('verify') ? (report.verify.passed ? ' bt__panel--pass' : ' bt__panel--fail') : ''
          }`}
        >
          <header className="bt__panel-head">
            <span className="bt__panel-step">4</span>
            <span className="bt__panel-name">Verify</span>
            <span className="bt__panel-note">mvn verify on the patched clone</span>
          </header>
          <AnimatePresence>
            {reached('verify') && (
              <motion.div
                className="bt__verify"
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduce ? 0 : 0.35, ease }}
              >
                <span
                  className={`bt__verdict${report.verify.passed ? ' bt__verdict--pass' : ' bt__verdict--fail'}`}
                >
                  {report.verify.passed ? 'BUILD PASS' : 'BUILD FAIL'}
                </span>
                <span className="bt__surefire">
                  Tests run: {report.verify.tests}, Failures: {report.verify.failures}
                </span>
                <span className="bt__gate">
                  {report.verify.passed
                    ? 'all hard checks hold, a draft PR may be opened'
                    : 'gate holds the patch back, no PR is opened'}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run} disabled={running}>
          {running ? 'Triaging…' : 'Run triage'}
        </button>
        <button className="demo__btn demo__btn--ghost" onClick={reset} disabled={running}>
          Reset
        </button>
        <span className="demo__hint">
          eval: top-3 retrieval 1.00, diffs parse 1.00, p50 about 10 ms
        </span>
      </div>
    </div>
  );
}
