import { useMemo, useState } from 'react';
import '../styles/demo.css';
import './JobApplier.css';
import { useJobStore } from './JobApplier/state';
import {
  addApplication,
  advanceApplication,
  deleteApplication,
  rejectApplication,
  resetAll,
  setNextAction,
  setStage,
  setToday,
  updateApplication,
} from './JobApplier/store';
import {
  canAdvance,
  canReject,
  filterAndSort,
  followUpsDue,
  funnelCounts,
  isOnOrBefore,
  nextStageOf,
  responseRate,
  type SortKey,
  type StageFilter,
} from './JobApplier/engine';
import {
  ADVANCE_PATH,
  STAGE_LABEL,
  STAGES,
  type Application,
  type Stage,
} from './JobApplier/types';

type View = 'board' | 'list' | 'dashboard';

// Board columns are every stage in pipeline order, so the funnel reads left to
// right and the terminal outcomes sit at the end.
const COLUMN_STAGES: Stage[] = [...STAGES];

const fmtSalary = (s: number | null): string =>
  s === null ? 'Not set' : `$${s.toLocaleString('en-US')}`;

export default function JobApplierDemo() {
  const { applications, today } = useJobStore();
  const [view, setView] = useState<View>('board');
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const [sort, setSort] = useState<SortKey>('nextAction');

  const filtered = useMemo(
    () => filterAndSort(applications, { stage: stageFilter, query, sort }),
    [applications, stageFilter, query, sort],
  );
  const counts = useMemo(() => funnelCounts(applications), [applications]);
  const rate = useMemo(() => responseRate(applications), [applications]);
  const due = useMemo(
    () => followUpsDue(applications, today),
    [applications, today],
  );

  const open = openId
    ? applications.find((a) => a.id === openId) ?? null
    : null;

  return (
    <div className="demo" aria-label="JobApplier job application tracker">
      <span className="demo__tag">Interactive app</span>
      <h3 className="demo__title">JobApplier application tracker</h3>
      <p className="demo__lede">
        Track your own job search end to end. Add applications, move them along
        the pipeline from wishlist through applied, screen, interview, and a
        final offer or rejection, and schedule a follow-up on each. The funnel,
        the follow-ups due, and your response rate are all the arithmetic of the
        applications you entered.
      </p>

      <div className="ja__nav" role="tablist" aria-label="JobApplier view">
        {(['board', 'list', 'dashboard'] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            className={`ja__navbtn${view === v ? ' ja__navbtn--on' : ''}`}
            onClick={() => setView(v)}
          >
            {v === 'board' ? 'Board' : v === 'list' ? 'List' : 'Dashboard'}
          </button>
        ))}
        <span className="ja__spacer" />
        <label className="ja__today">
          <span className="ja__today-label">Today</span>
          <input
            type="date"
            className="ja__date"
            value={today}
            onChange={(e) => setToday(e.target.value)}
            aria-label="Set the date follow-ups are reckoned against"
          />
        </label>
      </div>

      {view === 'board' && (
        <Board applications={applications} today={today} onOpen={setOpenId} />
      )}

      {view === 'list' && (
        <ListView
          rows={filtered}
          today={today}
          query={query}
          stageFilter={stageFilter}
          sort={sort}
          onQuery={setQuery}
          onStageFilter={setStageFilter}
          onSort={setSort}
          onOpen={setOpenId}
        />
      )}

      {view === 'dashboard' && (
        <Dashboard counts={counts} rate={rate} due={due} onOpen={setOpenId} />
      )}

      <AddForm />

      {open && (
        <Detail app={open} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

// ---------- board ----------

function Board({
  applications,
  today,
  onOpen,
}: {
  applications: Application[];
  today: string;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="ja__board" role="list" aria-label="Pipeline board">
      {COLUMN_STAGES.map((stage) => {
        const cards = applications.filter((a) => a.stage === stage);
        return (
          <section
            key={stage}
            className="ja__col glass"
            role="listitem"
            aria-label={`${STAGE_LABEL[stage]} column, ${cards.length} applications`}
          >
            <header className="ja__col-head">
              <span className="ja__col-name">{STAGE_LABEL[stage]}</span>
              <span className="ja__col-count">{cards.length}</span>
            </header>
            <ul className="ja__cards">
              {cards.length === 0 && (
                <li className="ja__empty">Nothing here yet.</li>
              )}
              {cards.map((a) => (
                <li key={a.id}>
                  <Card app={a} today={today} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Card({
  app,
  today,
  onOpen,
}: {
  app: Application;
  today: string;
  onOpen: (id: string) => void;
}) {
  const overdue =
    app.stage !== 'rejected' && isOnOrBefore(app.nextActionDate, today);
  return (
    <button
      type="button"
      className="ja__card"
      onClick={() => onOpen(app.id)}
      aria-label={`Open ${app.company}, ${app.role}`}
    >
      <span className="ja__card-co">{app.company}</span>
      <span className="ja__card-role">{app.role}</span>
      <span className="ja__card-meta">
        <span className="ja__card-salary">{fmtSalary(app.salary)}</span>
        {app.nextActionDate && (
          <span className={`ja__card-next${overdue ? ' ja__card-next--due' : ''}`}>
            {overdue ? 'Due ' : 'Next '}
            {app.nextActionDate}
          </span>
        )}
      </span>
    </button>
  );
}

// ---------- list ----------

function ListView({
  rows,
  today,
  query,
  stageFilter,
  sort,
  onQuery,
  onStageFilter,
  onSort,
  onOpen,
}: {
  rows: Application[];
  today: string;
  query: string;
  stageFilter: StageFilter;
  sort: SortKey;
  onQuery: (v: string) => void;
  onStageFilter: (v: StageFilter) => void;
  onSort: (v: SortKey) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="ja__list-wrap">
      <div className="ja__filters">
        <label className="ja__field">
          <span className="ja__field-label">Search</span>
          <input
            type="search"
            className="ja__input"
            placeholder="Company or role"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        </label>
        <label className="ja__field">
          <span className="ja__field-label">Stage</span>
          <select
            className="ja__select"
            value={stageFilter}
            onChange={(e) => onStageFilter(e.target.value as StageFilter)}
          >
            <option value="all">All stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="ja__field">
          <span className="ja__field-label">Sort</span>
          <select
            className="ja__select"
            value={sort}
            onChange={(e) => onSort(e.target.value as SortKey)}
          >
            <option value="nextAction">Next action</option>
            <option value="company">Company</option>
            <option value="role">Role</option>
            <option value="stage">Stage</option>
            <option value="salary">Salary</option>
          </select>
        </label>
      </div>

      <table className="ja__table">
        <caption className="ja__sr">Tracked applications</caption>
        <thead>
          <tr>
            <th scope="col">Company</th>
            <th scope="col">Role</th>
            <th scope="col">Stage</th>
            <th scope="col">Next action</th>
            <th scope="col">Salary</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="ja__table-empty">
                No applications match.
              </td>
            </tr>
          )}
          {rows.map((a) => {
            const overdue =
              a.stage !== 'rejected' && isOnOrBefore(a.nextActionDate, today);
            return (
              <tr key={a.id}>
                <th scope="row" className="ja__th-row">
                  <button
                    type="button"
                    className="ja__rowbtn"
                    onClick={() => onOpen(a.id)}
                  >
                    {a.company}
                  </button>
                </th>
                <td>{a.role}</td>
                <td>
                  <span className={`ja__chip ja__chip--${a.stage}`}>
                    {STAGE_LABEL[a.stage]}
                  </span>
                </td>
                <td className={overdue ? 'ja__td-due' : undefined}>
                  {a.nextActionDate ?? 'None'}
                </td>
                <td>{fmtSalary(a.salary)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- detail ----------

function Detail({
  app,
  onClose,
}: {
  app: Application;
  onClose: () => void;
}) {
  const next = nextStageOf(app.stage);
  return (
    <div
      className="ja__detail glass"
      role="region"
      aria-label={`${app.company} application detail`}
    >
      <header className="ja__detail-head">
        <div className="ja__detail-id">
          <input
            className="ja__detail-co"
            value={app.company}
            onChange={(e) => updateApplication(app.id, { company: e.target.value })}
            aria-label="Company"
          />
          <input
            className="ja__detail-role"
            value={app.role}
            onChange={(e) => updateApplication(app.id, { role: e.target.value })}
            aria-label="Role"
          />
        </div>
        <button
          type="button"
          className="ja__close"
          onClick={onClose}
          aria-label="Close detail"
        >
          Close
        </button>
      </header>

      <div className="ja__detail-grid">
        <label className="ja__field">
          <span className="ja__field-label">Stage</span>
          <select
            className="ja__select"
            value={app.stage}
            onChange={(e) => setStage(app.id, e.target.value as Stage)}
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="ja__field">
          <span className="ja__field-label">Applied date</span>
          <input
            type="date"
            className="ja__date"
            value={app.appliedDate ?? ''}
            onChange={(e) =>
              updateApplication(app.id, { appliedDate: e.target.value || null })
            }
          />
        </label>
        <label className="ja__field">
          <span className="ja__field-label">Next action</span>
          <input
            type="date"
            className="ja__date"
            value={app.nextActionDate ?? ''}
            onChange={(e) => setNextAction(app.id, e.target.value || null)}
          />
        </label>
        <label className="ja__field">
          <span className="ja__field-label">Salary</span>
          <input
            type="number"
            className="ja__input"
            min={0}
            step={1000}
            value={app.salary ?? ''}
            placeholder="Annual"
            onChange={(e) => {
              const raw = e.target.value;
              updateApplication(app.id, {
                salary: raw === '' ? null : Math.max(0, Math.floor(Number(raw))),
              });
            }}
          />
        </label>
      </div>

      <label className="ja__field ja__field--wide">
        <span className="ja__field-label">Notes</span>
        <textarea
          className="ja__textarea"
          rows={3}
          value={app.notes}
          onChange={(e) => updateApplication(app.id, { notes: e.target.value })}
        />
      </label>

      <div className="demo__controls ja__detail-actions">
        <button
          type="button"
          className="demo__btn"
          disabled={!canAdvance(app)}
          onClick={() => advanceApplication(app.id)}
        >
          {next ? `Advance to ${STAGE_LABEL[next]}` : 'No next stage'}
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          disabled={!canReject(app)}
          onClick={() => rejectApplication(app.id)}
        >
          Mark rejected
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={() => {
            deleteApplication(app.id);
            onClose();
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ---------- add form ----------

function AddForm() {
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (company.trim() === '' && role.trim() === '') return;
    addApplication({
      company,
      role,
      appliedDate: null,
      nextActionDate: null,
      salary: null,
      notes: '',
    });
    setCompany('');
    setRole('');
  }

  return (
    <form className="ja__add" onSubmit={submit} aria-label="Add an application">
      <label className="ja__field">
        <span className="ja__field-label">Company</span>
        <input
          className="ja__input"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Company"
        />
      </label>
      <label className="ja__field">
        <span className="ja__field-label">Role</span>
        <input
          className="ja__input"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="Role"
        />
      </label>
      <button type="submit" className="demo__btn">
        Add to wishlist
      </button>
    </form>
  );
}

// ---------- dashboard ----------

function Dashboard({
  counts,
  rate,
  due,
  onOpen,
}: {
  counts: Record<Stage, number>;
  rate: ReturnType<typeof responseRate>;
  due: Application[];
  onOpen: (id: string) => void;
}) {
  const total = STAGES.reduce((acc, s) => acc + counts[s], 0);
  const maxCount = Math.max(1, ...ADVANCE_PATH.map((s) => counts[s]));

  return (
    <div className="ja__dash">
      <section className="ja__panel glass" aria-label="Pipeline funnel">
        <h4 className="ja__panel-title">Funnel</h4>
        <ul className="ja__funnel">
          {ADVANCE_PATH.map((s) => (
            <li key={s} className="ja__funnel-row">
              <span className="ja__funnel-label">{STAGE_LABEL[s]}</span>
              <span className="ja__funnel-bar">
                <span
                  className="ja__funnel-fill"
                  style={{ width: `${(counts[s] / maxCount) * 100}%` }}
                />
              </span>
              <span className="ja__funnel-num">{counts[s]}</span>
            </li>
          ))}
          <li className="ja__funnel-row ja__funnel-row--rej">
            <span className="ja__funnel-label">{STAGE_LABEL.rejected}</span>
            <span className="ja__funnel-bar" aria-hidden="true" />
            <span className="ja__funnel-num">{counts.rejected}</span>
          </li>
        </ul>
        <p className="ja__panel-foot">{total} applications tracked</p>
      </section>

      <section className="ja__panel glass" aria-label="Response rate">
        <h4 className="ja__panel-title">Response rate</h4>
        <p className="ja__rate-big">{rate.rate}%</p>
        <p className="ja__panel-foot">
          {rate.responded} of {rate.submitted} submitted applications reached a
          screen or beyond.
        </p>
      </section>

      <section
        className="ja__panel glass ja__panel--wide"
        aria-label="Follow-ups due"
      >
        <h4 className="ja__panel-title">Follow-ups due</h4>
        {due.length === 0 ? (
          <p className="ja__panel-foot">Nothing is due as of the date set.</p>
        ) : (
          <ul className="ja__due">
            {due.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="ja__due-row"
                  onClick={() => onOpen(a.id)}
                >
                  <span className="ja__due-when">{a.nextActionDate}</span>
                  <span className="ja__due-co">{a.company}</span>
                  <span className="ja__due-role">{a.role}</span>
                  <span className={`ja__chip ja__chip--${a.stage}`}>
                    {STAGE_LABEL[a.stage]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="demo__controls ja__dash-reset">
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={resetAll}
        >
          Reset to seed data
        </button>
      </div>
    </div>
  );
}
