import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './sentinel-rag.css';

// Sentinel RAG sits between the user and the knowledge base. A query is gated
// by document-level role-based access control, then matched passages are run
// through PII sanitization (regex patterns plus spaCy NER) before any context
// reaches the model, and every request is written to an immutable audit log.

type Role = 'analyst' | 'support' | 'auditor';

const ROLES: { id: Role; label: string }[] = [
  { id: 'analyst', label: 'analyst' },
  { id: 'support', label: 'support' },
  { id: 'auditor', label: 'auditor' },
];

type Doc = {
  id: string;
  name: string;
  // Roles allowed to read this document (the per-document ACL).
  acl: Role[];
  // Raw passage with PII spans marked up for the redaction stage.
  passage: Segment[];
};

type Segment = { text: string; pii?: 'EMAIL' | 'PERSON' | 'SSN' | 'PHONE' };

const DOCS: Doc[] = [
  {
    id: 'KB-1042',
    name: 'incident-postmortem.md',
    acl: ['analyst', 'auditor'],
    passage: [
      { text: 'Lead ' },
      { text: 'Dana Whitfield', pii: 'PERSON' },
      { text: ' paged at 02:14 and reached ops on ' },
      { text: '+1 415 555 0181', pii: 'PHONE' },
      { text: '.' },
    ],
  },
  {
    id: 'KB-2087',
    name: 'customer-record.json',
    acl: ['support'],
    passage: [
      { text: 'Account holder ' },
      { text: 'm.alvarez@acme.io', pii: 'EMAIL' },
      { text: ' filed a refund tied to SSN ' },
      { text: '412-55-0199', pii: 'SSN' },
      { text: '.' },
    ],
  },
  {
    id: 'KB-3310',
    name: 'pricing-policy.pdf',
    acl: ['analyst', 'support', 'auditor'],
    passage: [
      { text: 'Tier 2 discounts cap at 18 percent; approvals route to ' },
      { text: 'Priya Nadeem', pii: 'PERSON' },
      { text: '.' },
    ],
  },
  {
    id: 'KB-4521',
    name: 'security-runbook.md',
    acl: ['auditor'],
    passage: [
      { text: 'Break-glass access is logged and reviewed by ' },
      { text: 'compliance@sentinel.dev', pii: 'EMAIL' },
      { text: '.' },
    ],
  },
];

type Stage = 'idle' | 'acl' | 'redact' | 'audit';

type AuditEntry = {
  hash: string;
  role: Role;
  granted: string[];
  redactions: number;
  ts: string;
};

const ease = [0.22, 1, 0.36, 1] as const;

export default function SentinelRagDemo() {
  const reduce = useReducedMotion();
  const [role, setRole] = useState<Role>('analyst');
  const [stage, setStage] = useState<Stage>('idle');
  const [log, setLog] = useState<AuditEntry[]>([]);
  const timers = useRef<number[]>([]);

  const granted = useMemo(
    () => DOCS.filter((d) => d.acl.includes(role)),
    [role],
  );
  const redactionCount = useMemo(
    () =>
      granted.reduce(
        (n, d) => n + d.passage.filter((s) => s.pii).length,
        0,
      ),
    [granted],
  );

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }

  useEffect(() => clearTimers, []);

  function pickRole(r: Role) {
    clearTimers();
    setRole(r);
    setStage('idle');
  }

  function run() {
    clearTimers();
    const grantedNow = DOCS.filter((d) => d.acl.includes(role));
    const reds = grantedNow.reduce(
      (n, d) => n + d.passage.filter((s) => s.pii).length,
      0,
    );

    const commit = () => {
      const entry: AuditEntry = {
        hash: makeHash(role, grantedNow.map((d) => d.id), Date.now()),
        role,
        granted: grantedNow.map((d) => d.id),
        redactions: reds,
        ts: clock(),
      };
      setLog((prev) => [entry, ...prev].slice(0, 6));
    };

    if (reduce) {
      setStage('audit');
      commit();
      return;
    }

    setStage('acl');
    timers.current.push(
      window.setTimeout(() => setStage('redact'), 900),
      window.setTimeout(() => {
        setStage('audit');
        commit();
      }, 1800),
    );
  }

  const showRedacted = stage === 'redact' || stage === 'audit';
  const aclResolved = stage !== 'idle';

  return (
    <div className="demo" aria-label="sentinel rag pipeline demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">A query through the secure proxy</h3>
      <p className="demo__lede">
        Pick the requesting role, then send the query. Document-level access
        control greys out what the role cannot read, PII is scrubbed from the
        retrieved passages before any context reaches the model, and the
        request is appended to an immutable audit log.
      </p>

      <div className="sr__stage">
        <div className="sr__roles" role="group" aria-label="select role">
          <span className="sr__roles-label">requesting role</span>
          {ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`sr__role ${role === r.id ? 'sr__role--on' : ''}`}
              aria-pressed={role === r.id}
              onClick={() => pickRole(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="sr__pipe">
          <section className="sr__panel" aria-label="access control stage">
            <div className="sr__panel-head">
              <span className="sr__panel-step">1</span>
              <span className="sr__panel-title">access control</span>
              <span className="sr__panel-count">
                {aclResolved ? `${granted.length} of ${DOCS.length}` : `${DOCS.length} candidates`}
              </span>
            </div>
            <div className="sr__docs">
              {DOCS.map((d, i) => {
                const ok = d.acl.includes(role);
                const decided = aclResolved;
                return (
                  <motion.div
                    key={d.id}
                    className={`sr__doc ${
                      decided ? (ok ? 'sr__doc--granted' : 'sr__doc--denied') : ''
                    }`}
                    initial={false}
                    animate={{
                      opacity: decided ? (ok ? 1 : 0.4) : 1,
                    }}
                    transition={{ duration: reduce ? 0 : 0.4, delay: reduce ? 0 : i * 0.06, ease }}
                  >
                    <span className="sr__doc-lock" aria-hidden />
                    <span>
                      <span className="sr__doc-name">{d.name}</span>
                      <br />
                      <span className="sr__doc-acl">
                        acl: {d.acl.join(', ')}
                      </span>
                    </span>
                    <span className="sr__doc-verdict">
                      {decided ? (ok ? 'grant' : 'deny') : `${d.id}`}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </section>

          <section className="sr__panel" aria-label="pii redaction stage">
            <div className="sr__panel-head">
              <span className="sr__panel-step">2</span>
              <span className="sr__panel-title">retrieved context</span>
              <span className="sr__panel-count">
                {showRedacted ? `${redactionCount} redacted` : `${redactionCount} PII spans`}
              </span>
            </div>
            {aclResolved ? (
              <div className="sr__context">
                {granted.length === 0 ? (
                  <span className="sr__context-empty">
                    No documents authorized for this role.
                  </span>
                ) : (
                  granted.map((d) => (
                    <p key={d.id} style={{ margin: '0 0 10px' }}>
                      {d.passage.map((seg, si) =>
                        seg.pii ? (
                          <AnimatePresence mode="wait" key={`${d.id}-${si}`}>
                            {showRedacted ? (
                              <motion.span
                                key="red"
                                className="sr__pii sr__pii--red"
                                initial={{ opacity: reduce ? 1 : 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ duration: reduce ? 0 : 0.3 }}
                              >
                                [{seg.pii} REDACTED]
                              </motion.span>
                            ) : (
                              <span key="raw" className="sr__pii sr__pii--raw">
                                {seg.text}
                              </span>
                            )}
                          </AnimatePresence>
                        ) : (
                          <span key={`${d.id}-${si}`}>{seg.text}</span>
                        ),
                      )}
                    </p>
                  ))
                )}
              </div>
            ) : (
              <span className="sr__context-empty">
                Send the query to retrieve and sanitize context.
              </span>
            )}
            <div className="sr__legend">
              <span>
                <i className="raw" /> raw PII
              </span>
              <span>
                <i className="red" /> redacted before model
              </span>
            </div>
          </section>
        </div>

        <section className="sr__audit" aria-label="immutable audit log">
          <div className="sr__audit-head">
            <span>immutable audit log</span>
            <span className="sr__audit-seal">append only</span>
          </div>
          {log.length === 0 ? (
            <span className="sr__audit-empty">
              No requests logged yet. Each query writes one sealed entry.
            </span>
          ) : (
            <ul className="sr__audit-log">
              <AnimatePresence initial={false}>
                {log.map((e) => (
                  <motion.li
                    key={e.hash}
                    className="sr__audit-row"
                    initial={{ opacity: 0, y: reduce ? 0 : -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: reduce ? 0 : 0.3, ease }}
                  >
                    <span className="sr__audit-hash">{e.hash}</span>
                    <span className="sr__audit-body">
                      <b>{e.ts}</b> role=<b>{e.role}</b> granted=
                      <b>[{e.granted.join(', ')}]</b> redactions=
                      <b>{e.redactions}</b>
                    </span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </section>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={run}>
          {stage === 'idle' ? 'Send query' : 'Run again'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => {
            clearTimers();
            setStage('idle');
            setLog([]);
          }}
        >
          Clear log
        </button>
        <span className="demo__hint">
          {granted.length} of {DOCS.length} docs visible to {role}
        </span>
      </div>
    </div>
  );
}

function clock() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

// Short deterministic-looking digest for the audit row. Not cryptographic;
// it stands in for the per-request hash the real log seals each entry with.
function makeHash(role: string, ids: string[], salt: number) {
  let h = 2166136261;
  const src = role + ids.join('') + String(salt);
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}
