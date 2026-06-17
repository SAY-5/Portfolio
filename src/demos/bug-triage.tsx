import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './bug-triage.css';
import { useBugs } from './bug-triage/state';
import {
  createBug,
  markDuplicate,
  resetAll,
  setAssignee,
  setComponent,
  setStatus,
} from './bug-triage/store';
import {
  completeness,
  computeSeverity,
  duplicateClusters,
  findDuplicates,
  priorityCompare,
  severityOf,
} from './bug-triage/engine';
import {
  COMPONENTS,
  IMPACTS,
  REPRO,
  SEVERITIES,
  STATUSES,
  type Bug,
  type Component,
  type Reproducibility,
  type Severity,
  type Status,
  type UserImpact,
} from './bug-triage/types';

// In-browser bug-triage board. Bugs persist in localStorage and run through a
// pure, deterministic engine: severity is computed from impact, reproducibility
// and regression; columns order their cards by computed priority; the detail
// view surfaces likely duplicates by title token similarity. Nothing here talks
// to a server, and the engine never reads the clock or evaluates strings.

const STATUS_LABEL: Record<Status, string> = {
  new: 'New',
  triaged: 'Triaged',
  'in-progress': 'In progress',
  closed: 'Closed',
};

const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: 'Blocker',
  critical: 'Critical',
  major: 'Major',
  minor: 'Minor',
};

type View = 'board' | 'intake' | 'dashboard';

export default function BugTriageDemo() {
  const bugs = useBugs();
  const [view, setView] = useState<View>('board');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = selectedId ? (bugs.find((b) => b.id === selectedId) ?? null) : null;

  return (
    <div className="demo bt">
      <span className="demo__tag">bug triage</span>
      <h3 className="demo__title">Bug triage board</h3>
      <p className="demo__lede">
        File a bug and watch its severity computed live from user impact,
        reproducibility and whether it is a regression. Triage it onto the board,
        where each column orders cards by priority and flags likely duplicates.
      </p>

      <div className="bt__tabs" role="tablist" aria-label="Bug triage views">
        <TabButton active={view === 'board'} onClick={() => setView('board')}>
          Board
        </TabButton>
        <TabButton active={view === 'intake'} onClick={() => setView('intake')}>
          File a bug
        </TabButton>
        <TabButton active={view === 'dashboard'} onClick={() => setView('dashboard')}>
          Dashboard
        </TabButton>
      </div>

      {view === 'intake' && <IntakeForm onFiled={() => setView('board')} />}
      {view === 'board' && <Board bugs={bugs} onSelect={setSelectedId} />}
      {view === 'dashboard' && <Dashboard bugs={bugs} onSelect={setSelectedId} />}

      {selected && (
        <BugDetail bug={selected} bugs={bugs} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`bt__tab${active ? ' bt__tab--on' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// ---------- intake ----------

function IntakeForm({ onFiled }: { onFiled: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [component, setComponent] = useState<Component>('api');
  const [reproducibility, setReproducibility] = useState<Reproducibility>('always');
  const [userImpact, setUserImpact] = useState<UserImpact>('broken');
  const [regression, setRegression] = useState(false);
  const [assignee, setAssignee] = useState('');

  // Live severity preview recomputes from the picked factors on every change.
  const preview = useMemo(
    () => computeSeverity(userImpact, reproducibility, regression),
    [userImpact, reproducibility, regression],
  );

  const canSubmit = title.trim().length > 2;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    createBug({
      title,
      description,
      component,
      reproducibility,
      userImpact,
      regression,
      assignee: assignee.trim() || null,
    });
    setTitle('');
    setDescription('');
    setAssignee('');
    onFiled();
  }

  return (
    <form className="bt__intake glass" onSubmit={submit} aria-label="File a new bug">
      <div className="bt__field">
        <label htmlFor="bt-title">Title</label>
        <input
          id="bt-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Short summary of the bug"
          autoComplete="off"
        />
      </div>

      <div className="bt__field">
        <label htmlFor="bt-desc">Description</label>
        <textarea
          id="bt-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Steps, expected vs actual, anything useful"
          rows={3}
        />
      </div>

      <div className="bt__row">
        <SelectField
          id="bt-component"
          label="Component"
          value={component}
          options={COMPONENTS}
          onChange={(v) => setComponent(v as Component)}
        />
        <SelectField
          id="bt-impact"
          label="User impact"
          value={userImpact}
          options={IMPACTS}
          onChange={(v) => setUserImpact(v as UserImpact)}
        />
        <SelectField
          id="bt-repro"
          label="Reproducibility"
          value={reproducibility}
          options={REPRO}
          onChange={(v) => setReproducibility(v as Reproducibility)}
        />
      </div>

      <div className="bt__row bt__row--mid">
        <div className="bt__field">
          <label htmlFor="bt-assignee">Assignee (optional)</label>
          <input
            id="bt-assignee"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            placeholder="who owns it"
            autoComplete="off"
          />
        </div>
        <label className="bt__check">
          <input
            type="checkbox"
            checked={regression}
            onChange={(e) => setRegression(e.target.checked)}
          />
          <span>Regression (used to work)</span>
        </label>
      </div>

      <SeverityPreview severity={preview.severity} score={preview.score} />

      <div className="demo__controls">
        <button type="submit" className="demo__btn" disabled={!canSubmit}>
          File bug
        </button>
        <span className="demo__hint">
          Severity is computed, not chosen. Title needs three characters.
        </span>
      </div>
    </form>
  );
}

function SelectField({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="bt__field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function SeverityPreview({ severity, score }: { severity: Severity; score: number }) {
  return (
    <div
      className={`bt__preview bt__sev--${severity}`}
      role="status"
      aria-live="polite"
    >
      <span className="bt__preview-label">Computed severity</span>
      <span className="bt__preview-value">
        {SEVERITY_LABEL[severity]} <span className="bt__preview-score">({score} pts)</span>
      </span>
    </div>
  );
}

// ---------- board ----------

function Board({ bugs, onSelect }: { bugs: Bug[]; onSelect: (id: string) => void }) {
  const reduce = useReducedMotion();
  const columns = useMemo(() => {
    const byStatus: Record<Status, Bug[]> = {
      new: [],
      triaged: [],
      'in-progress': [],
      closed: [],
    };
    for (const b of bugs) byStatus[b.status].push(b);
    for (const s of STATUSES) byStatus[s].sort(priorityCompare);
    return byStatus;
  }, [bugs]);

  return (
    <div className="bt__board" aria-label="Bug board by status">
      {STATUSES.map((status) => (
        <section key={status} className="bt__col glass" aria-label={STATUS_LABEL[status]}>
          <header className="bt__col-head">
            <h4>{STATUS_LABEL[status]}</h4>
            <span className="bt__count">{columns[status].length}</span>
          </header>
          <ul className="bt__cards">
            {columns[status].map((bug) => (
              <li key={bug.id}>
                <BugCard bug={bug} animate={!reduce} onSelect={onSelect} />
              </li>
            ))}
            {columns[status].length === 0 && <li className="bt__empty">No bugs</li>}
          </ul>
        </section>
      ))}
    </div>
  );
}

function BugCard({
  bug,
  animate,
  onSelect,
}: {
  bug: Bug;
  animate: boolean;
  onSelect: (id: string) => void;
}) {
  const sev = severityOf(bug).severity;
  return (
    <button
      type="button"
      className={`bt__card bt__sev--${sev}${animate ? ' bt__card--anim' : ''}`}
      onClick={() => onSelect(bug.id)}
      aria-label={`Open ${bug.id}: ${bug.title}`}
    >
      <span className="bt__card-top">
        <span className="bt__id mono">{bug.id}</span>
        <span className={`bt__chip bt__chip--${sev}`}>{SEVERITY_LABEL[sev]}</span>
      </span>
      <span className="bt__card-title">{bug.title}</span>
      <span className="bt__card-meta">
        <span>{bug.component ?? 'unassigned component'}</span>
        <span>{bug.assignee ?? 'unassigned'}</span>
      </span>
    </button>
  );
}

// ---------- detail ----------

function BugDetail({
  bug,
  bugs,
  onClose,
}: {
  bug: Bug;
  bugs: Bug[];
  onClose: () => void;
}) {
  const result = severityOf(bug);
  const ready = completeness(bug);
  const dupes = useMemo(() => findDuplicates(bug, bugs), [bug, bugs]);
  const [statusError, setStatusError] = useState<string[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  // Move focus to the panel when it opens and let Escape dismiss it, so the
  // detail is keyboard-reachable without trapping the user.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function tryStatus(status: Status) {
    const r = setStatus(bug.id, status);
    setStatusError(r.ok ? [] : r.missing);
  }

  const dupTarget = bug.duplicateOf
    ? (bugs.find((b) => b.id === bug.duplicateOf) ?? null)
    : null;

  return (
    <div
      ref={panelRef}
      className="bt__detail glass"
      role="dialog"
      aria-modal="false"
      aria-label={`Bug ${bug.id} detail`}
      tabIndex={-1}
    >
      <header className="bt__detail-head">
        <div>
          <span className="bt__id mono">{bug.id}</span>
          <h4 className="bt__detail-title">{bug.title}</h4>
        </div>
        <button type="button" className="bt__close" onClick={onClose} aria-label="Close detail">
          Close
        </button>
      </header>

      {bug.description && <p className="bt__detail-desc">{bug.description}</p>}

      <dl className="bt__facts">
        <Fact label="Component" value={bug.component ?? 'unset'} />
        <Fact label="Impact" value={bug.userImpact} />
        <Fact label="Reproducibility" value={bug.reproducibility} />
        <Fact label="Regression" value={bug.regression ? 'yes' : 'no'} />
        <Fact label="Assignee" value={bug.assignee ?? 'unset'} />
        <Fact label="Status" value={STATUS_LABEL[bug.status]} />
      </dl>

      <div className={`bt__sevbox bt__sev--${result.severity}`}>
        <div className="bt__sevbox-head">
          <span className="bt__preview-label">Computed severity</span>
          <span className="bt__preview-value">
            {SEVERITY_LABEL[result.severity]}{' '}
            <span className="bt__preview-score">({result.score} pts)</span>
          </span>
        </div>
        <ul className="bt__factors">
          {result.factors.map((f) => (
            <li key={f.label}>
              <span>{f.label}</span>
              <span className="mono">
                {f.points >= 0 ? '+' : ''}
                {f.points}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {dupTarget && (
        <p className="bt__dup-note">
          Marked duplicate of <span className="mono">{dupTarget.id}</span>.{' '}
          <button
            type="button"
            className="bt__link"
            onClick={() => markDuplicate(bug.id, null)}
          >
            Unmark
          </button>
        </p>
      )}

      {!dupTarget && dupes.length > 0 && (
        <section className="bt__dupes" aria-label="Likely duplicates">
          <h5>Likely duplicates</h5>
          <ul>
            {dupes.map((d) => (
              <li key={d.bug.id}>
                <span className="bt__dup-title">
                  <span className="mono">{d.bug.id}</span> {d.bug.title}
                </span>
                <span className="bt__dup-score mono">
                  {Math.round(d.similarity * 100)}% match
                </span>
                <button
                  type="button"
                  className="bt__link"
                  onClick={() => markDuplicate(bug.id, d.bug.id)}
                >
                  Mark duplicate
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bt__triage" aria-label="Triage actions">
        <h5>Triage</h5>
        <div className="bt__row">
          <div className="bt__field">
            <label htmlFor="bt-d-component">Component</label>
            <select
              id="bt-d-component"
              value={bug.component ?? ''}
              onChange={(e) =>
                setComponent(bug.id, (e.target.value || null) as Component | null)
              }
            >
              <option value="">unset</option>
              {COMPONENTS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="bt__field">
            <label htmlFor="bt-d-assignee">Assignee</label>
            <input
              id="bt-d-assignee"
              value={bug.assignee ?? ''}
              onChange={(e) => setAssignee(bug.id, e.target.value)}
              placeholder="who owns it"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="bt__statusrow" role="group" aria-label="Set status">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={`bt__statusbtn${bug.status === s ? ' bt__statusbtn--on' : ''}`}
              aria-pressed={bug.status === s}
              onClick={() => tryStatus(s)}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        {!ready.ready && (
          <p className="bt__warn" role="alert">
            Needs {ready.missing.join(' and ')} before it can leave New.
          </p>
        )}
        {statusError.length > 0 && (
          <p className="bt__warn" role="alert">
            Cannot move: missing {statusError.join(' and ')}.
          </p>
        )}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bt__fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

// ---------- dashboard ----------

function Dashboard({ bugs, onSelect }: { bugs: Bug[]; onSelect: (id: string) => void }) {
  const stats = useMemo(() => {
    const bySeverity: Record<Severity, number> = {
      blocker: 0,
      critical: 0,
      major: 0,
      minor: 0,
    };
    const byStatus: Record<Status, number> = {
      new: 0,
      triaged: 0,
      'in-progress': 0,
      closed: 0,
    };
    for (const b of bugs) {
      if (b.duplicateOf !== null) continue;
      bySeverity[severityOf(b).severity] += 1;
      byStatus[b.status] += 1;
    }
    return { bySeverity, byStatus };
  }, [bugs]);

  // Untriaged queue: bugs still in New that fail the completeness gate, ordered
  // by computed priority so the most urgent gaps surface first.
  const untriaged = useMemo(
    () =>
      bugs
        .filter((b) => b.status === 'new' && b.duplicateOf === null && !completeness(b).ready)
        .sort(priorityCompare),
    [bugs],
  );

  const clusters = useMemo(() => duplicateClusters(bugs), [bugs]);

  function reset() {
    resetAll();
  }

  return (
    <div className="bt__dash">
      <div className="bt__statgrid">
        <StatPanel title="By severity">
          {SEVERITIES.map((s) => (
            <StatRow key={s} className={`bt__sev--${s}`} label={SEVERITY_LABEL[s]} value={stats.bySeverity[s]} dot />
          ))}
        </StatPanel>
        <StatPanel title="By status">
          {STATUSES.map((s) => (
            <StatRow key={s} label={STATUS_LABEL[s]} value={stats.byStatus[s]} />
          ))}
        </StatPanel>
      </div>

      <section className="bt__queue glass" aria-label="Untriaged queue">
        <h5>Untriaged queue ({untriaged.length})</h5>
        {untriaged.length === 0 ? (
          <p className="bt__empty">Every new bug has a component and assignee.</p>
        ) : (
          <ul>
            {untriaged.map((b) => (
              <li key={b.id}>
                <button type="button" className="bt__queue-item" onClick={() => onSelect(b.id)}>
                  <span className="mono">{b.id}</span>
                  <span className="bt__queue-title">{b.title}</span>
                  <span className="bt__queue-missing">
                    needs {completeness(b).missing.join(' + ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bt__clusters glass" aria-label="Duplicate clusters">
        <h5>Duplicate clusters ({clusters.length})</h5>
        {clusters.length === 0 ? (
          <p className="bt__empty">No likely duplicate groups detected.</p>
        ) : (
          <ul>
            {clusters.map((group) => (
              <li key={group.map((g) => g.id).join('-')} className="bt__cluster">
                {group.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className="bt__cluster-chip"
                    onClick={() => onSelect(g.id)}
                  >
                    <span className="mono">{g.id}</span> {g.title}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="demo__controls">
        <button type="button" className="demo__btn demo__btn--ghost" onClick={reset}>
          Reset board
        </button>
        <span className="demo__hint">Clears localStorage and restores the seed bugs.</span>
      </div>
    </div>
  );
}

function StatPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bt__stat glass" aria-label={title}>
      <h5>{title}</h5>
      <dl>{children}</dl>
    </section>
  );
}

function StatRow({
  label,
  value,
  className,
  dot,
}: {
  label: string;
  value: number;
  className?: string;
  dot?: boolean;
}) {
  return (
    <div className={`bt__statrow${className ? ' ' + className : ''}`}>
      <dt>
        {dot && <span className="bt__dot" aria-hidden="true" />}
        {label}
      </dt>
      <dd className="mono">{value}</dd>
    </div>
  );
}
