import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './colref.css';

// Real facts from the project:
// - colref reads the ORM schema (Django models.py) to get the field list,
//   then parses each project file into an AST and reports attribute-access
//   references to the target column.
// - AST parsing skips comments, string literals, and migration history that
//   plain grep would surface as false positives.
// - v0.1 detects attribute-access references only; string-based ORM calls
//   like .values('email') or .defer('email') are explicitly not covered.
// - Scans skip .git, __pycache__, venv, migrations, and node_modules.

type Hit = {
  file: string;
  line: number;
  text: string;
  // why grep would match this line
  grep: boolean;
  // why colref's AST counts (or skips) it
  kind: 'attr' | 'comment' | 'string' | 'migration' | 'ormstring';
};

// Two columns from a Django User model; pick one to scan for.
const COLUMNS = ['email', 'last_login'] as const;
type Column = (typeof COLUMNS)[number];

const SAMPLES: Record<Column, Hit[]> = {
  email: [
    { file: 'accounts/views.py', line: 42, text: 'send_to(user.email)', grep: true, kind: 'attr' },
    { file: 'accounts/views.py', line: 88, text: '# fall back to user.email here', grep: true, kind: 'comment' },
    { file: 'billing/tasks.py', line: 17, text: 'invoice.email = customer.email', grep: true, kind: 'attr' },
    { file: 'billing/tasks.py', line: 31, text: 'log.info("missing email field")', grep: true, kind: 'string' },
    { file: 'core/serializers.py', line: 9, text: ".values('email', 'id')", grep: true, kind: 'ormstring' },
    { file: 'migrations/0007_email.py', line: 12, text: "AddField('email', ...)", grep: true, kind: 'migration' },
  ],
  last_login: [
    { file: 'accounts/auth.py', line: 53, text: 'user.last_login = now()', grep: true, kind: 'attr' },
    { file: 'accounts/auth.py', line: 71, text: '# touch last_login on success', grep: true, kind: 'comment' },
    { file: 'reports/stats.py', line: 24, text: 'gap = now() - row.last_login', grep: true, kind: 'attr' },
    { file: 'reports/stats.py', line: 40, text: 'header = "last_login (utc)"', grep: true, kind: 'string' },
    { file: 'migrations/0003_login.py', line: 8, text: "AddField('last_login', ...)", grep: true, kind: 'migration' },
  ],
};

const KIND_LABEL: Record<Hit['kind'], string> = {
  attr: 'attribute access',
  comment: 'comment',
  string: 'string literal',
  migration: 'migration history',
  ormstring: 'string-based ORM call',
};

const SKIPPED_DIRS = ['.git', '__pycache__', 'venv', 'migrations', 'node_modules'];
const ease = [0.22, 1, 0.36, 1] as const;

export default function ColrefDemo() {
  const reduce = useReducedMotion();
  const [column, setColumn] = useState<Column>('email');
  const [scanned, setScanned] = useState(0);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const timer = useRef<number | null>(null);

  const rows = SAMPLES[column];
  const astHits = useMemo(() => rows.filter((r) => r.kind === 'attr').length, [rows]);
  const grepHits = rows.length; // grep matches every textual occurrence
  const falsePositives = grepHits - astHits;

  function clearTimer() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => clearTimer, []);

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column]);

  function reset() {
    clearTimer();
    setScanned(0);
    setDone(false);
    setRunning(false);
  }

  function scan() {
    clearTimer();
    setDone(false);
    setScanned(0);
    if (reduce) {
      setScanned(rows.length);
      setRunning(false);
      setDone(true);
      return;
    }
    setRunning(true);
    let i = 0;
    const step = () => {
      i += 1;
      setScanned(i);
      if (i < rows.length) {
        timer.current = window.setTimeout(step, 300);
      } else {
        setRunning(false);
        setDone(true);
        timer.current = null;
      }
    };
    timer.current = window.setTimeout(step, 320);
  }

  return (
    <div className="demo" aria-label="colref AST column reference scan demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Is this column still referenced?</h3>
      <p className="demo__lede">
        Pick a column from the model schema and scan. colref parses each file
        into an AST and counts only attribute-access references, so comments,
        string literals, and migration history that grep would flag are
        skipped.
      </p>

      <div className="cr__schema">
        <span className="cr__schema-label">class User(models.Model)</span>
        <div className="cr__fields" role="group" aria-label="model columns">
          {COLUMNS.map((col) => (
            <button
              key={col}
              className={`cr__field ${col === column ? 'cr__field--on' : ''}`}
              onClick={() => setColumn(col)}
              disabled={running}
              aria-pressed={col === column}
            >
              {col}
              <span className="cr__field-type">CharField</span>
            </button>
          ))}
        </div>
      </div>

      <div className="cr__stage">
        <ul className="cr__rows" aria-live="polite">
          {rows.map((hit, i) => {
            const revealed = i < scanned;
            const isAttr = hit.kind === 'attr';
            return (
              <motion.li
                key={`${column}-${hit.file}-${hit.line}`}
                className={`cr__row ${
                  revealed ? (isAttr ? 'cr__row--hit' : 'cr__row--skip') : 'cr__row--pending'
                }`}
                initial={false}
                animate={{ opacity: revealed ? 1 : 0.4 }}
                transition={{ duration: reduce ? 0 : 0.2 }}
              >
                <span className="cr__row-loc">
                  {hit.file}:{hit.line}
                </span>
                <code className="cr__row-text">{hit.text}</code>
                <span className="cr__row-tag">
                  {revealed ? (isAttr ? 'reference' : `skip · ${KIND_LABEL[hit.kind]}`) : 'parsing…'}
                </span>
              </motion.li>
            );
          })}
        </ul>

        <div className="cr__panel">
          <div className="cr__counts">
            <div className="cr__count cr__count--grep">
              <div className="cr__count-name">grep matches</div>
              <div className="cr__count-val">{done ? grepHits : scanned}</div>
              <div className="cr__count-meta">every text occurrence</div>
            </div>
            <div className="cr__count cr__count--ast">
              <div className="cr__count-name">colref references</div>
              <div className="cr__count-val">
                {rows.slice(0, scanned).filter((r) => r.kind === 'attr').length}
              </div>
              <div className="cr__count-meta">attribute access only</div>
            </div>
          </div>

          <div className="cr__skipped">
            <div className="cr__skipped-head">Directories skipped</div>
            <div className="cr__skipped-list">
              {SKIPPED_DIRS.map((d) => (
                <span key={d} className="cr__skipped-chip">
                  {d}
                </span>
              ))}
            </div>
          </div>

          <AnimatePresence>
            {done && (
              <motion.div
                className="cr__verdict"
                initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease }}
              >
                <span className="cr__verdict-num">{falsePositives}</span>
                <span className="cr__verdict-text">
                  false positives grep would have surfaced that the AST scan
                  dropped. {astHits} real attribute-access{' '}
                  {astHits === 1 ? 'reference' : 'references'} to{' '}
                  <b>{column}</b>. String-based ORM calls like .values('{column}')
                  are not yet covered in v0.1.
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={scan} disabled={running}>
          {running ? 'Scanning…' : 'Run colref'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <span className="demo__hint">target column: {column}</span>
      </div>
    </div>
  );
}
