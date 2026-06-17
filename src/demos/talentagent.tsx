import { useMemo, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './talentagent.css';
import { useTalentStore } from './talentagent/state';
import {
  addCandidate,
  advanceCandidate,
  rejectCandidate,
  resetAll,
  setScore,
  updateRole,
} from './talentagent/store';
import {
  canAdvance,
  canReject,
  funnelCounts,
  nextStageOf,
  rankCandidates,
  rubricValid,
  scoreCandidate,
  weightSum,
} from './talentagent/engine';
import {
  MAX_RATING,
  STAGES,
  type Candidate,
  type Criterion,
  type Role,
  type Stage,
} from './talentagent/types';

const STAGE_LABEL: Record<Stage, string> = {
  applied: 'Applied',
  screen: 'Screen',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
};

const round = (v: number) => Math.round(v);

type View = 'pipeline' | 'rubric';
type RankMap = Map<string, number>;
type Ranked = ReturnType<typeof rankCandidates>;

export default function TalentAgentDemo() {
  const reduce = useReducedMotion();
  const { roles, candidates } = useTalentStore();
  const [roleId, setRoleId] = useState<string>(roles[0]?.id ?? '');
  const [openCandidate, setOpenCandidate] = useState<string | null>(null);
  const [view, setView] = useState<View>('pipeline');

  // The active role falls back to the first role if the selected one is gone.
  const role = useMemo(
    () => roles.find((r) => r.id === roleId) ?? roles[0],
    [roles, roleId],
  );

  const ranked = useMemo(
    () => (role ? rankCandidates(role, candidates) : []),
    [role, candidates],
  );

  const rankOf = useMemo(() => {
    const map: RankMap = new Map();
    ranked.forEach((s, i) => map.set(s.candidate.id, i + 1));
    return map;
  }, [ranked]);

  const counts = useMemo(
    () => (role ? funnelCounts(role, candidates) : null),
    [role, candidates],
  );

  const open = openCandidate
    ? candidates.find((c) => c.id === openCandidate) ?? null
    : null;

  if (!role || !counts) {
    return (
      <div className="demo" aria-label="talentagent applicant tracking">
        <p className="demo__lede">No roles defined.</p>
      </div>
    );
  }

  return (
    <div className="demo" aria-label="talentagent applicant tracking">
      <span className="demo__tag">Interactive app</span>
      <h3 className="demo__title">TalentAgent applicant tracking</h3>
      <p className="demo__lede">
        Define a role rubric whose weighted criteria sum to 100, score each
        candidate against it on a 0 to {MAX_RATING} scale, and watch them rank by
        weighted percent. Move candidates through the funnel: advancing requires
        clearing the score threshold you set, and a rejected candidate can never
        be offered. Every number is the arithmetic of the rubric you defined.
      </p>

      <div className="ta__nav" role="tablist" aria-label="TalentAgent view">
        <button
          role="tab"
          aria-selected={view === 'pipeline'}
          className={`ta__navbtn${view === 'pipeline' ? ' ta__navbtn--on' : ''}`}
          onClick={() => setView('pipeline')}
        >
          Pipeline
        </button>
        <button
          role="tab"
          aria-selected={view === 'rubric'}
          className={`ta__navbtn${view === 'rubric' ? ' ta__navbtn--on' : ''}`}
          onClick={() => setView('rubric')}
        >
          Role and rubric
        </button>

        <label className="ta__rolepick">
          <span className="ta__rolepick-label">Role</span>
          <select
            className="ta__select"
            value={role.id}
            onChange={(e) => {
              setRoleId(e.target.value);
              setOpenCandidate(null);
            }}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      {view === 'pipeline' ? (
        <Pipeline
          counts={counts}
          ranked={ranked}
          rankOf={rankOf}
          onOpen={(id) => setOpenCandidate(id)}
        />
      ) : (
        <RubricEditor role={role} ranked={ranked} rankOf={rankOf} />
      )}

      {open && (
        <CandidateDetail
          role={role}
          candidate={open}
          rank={rankOf.get(open.id) ?? 0}
          reduce={!!reduce}
          onClose={() => setOpenCandidate(null)}
        />
      )}

      <div className="demo__controls" role="group" aria-label="store controls">
        <AddCandidate roleId={role.id} />
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => {
            resetAll();
            setOpenCandidate(null);
          }}
        >
          Reset to seed
        </button>
        <span className="demo__hint">
          {ranked.length} scored / threshold {role.advanceThreshold}%
        </span>
      </div>
    </div>
  );
}

// ---------- pipeline ----------

function Pipeline({
  counts,
  ranked,
  rankOf,
  onOpen,
}: {
  counts: Record<Stage, number>;
  ranked: Ranked;
  rankOf: RankMap;
  onOpen: (id: string) => void;
}) {
  const byStage = useMemo(() => {
    const map = new Map<Stage, Ranked>();
    for (const s of STAGES) map.set(s, []);
    for (const scored of ranked) {
      map.get(scored.candidate.stage)?.push(scored);
    }
    return map;
  }, [ranked]);

  return (
    <div className="ta__stage">
      <div className="ta__funnel" aria-label="stage funnel counts">
        {STAGES.map((s) => (
          <div key={s} className={`ta__funnel-cell ta__funnel-cell--${s}`}>
            <span className="ta__funnel-count">{counts[s]}</span>
            <span className="ta__funnel-stage">{STAGE_LABEL[s]}</span>
          </div>
        ))}
      </div>

      <div className="ta__columns">
        {STAGES.map((s) => {
          const cards = byStage.get(s) ?? [];
          return (
            <section
              key={s}
              className={`ta__col ta__col--${s}`}
              aria-label={`${STAGE_LABEL[s]} stage, ${cards.length} candidates`}
            >
              <header className="ta__col-head">
                <span className="ta__col-name">{STAGE_LABEL[s]}</span>
                <span className="ta__col-count">{cards.length}</span>
              </header>
              <ul className="ta__col-body">
                {cards.map((scored) => {
                  const c = scored.candidate;
                  const rank = rankOf.get(c.id) ?? 0;
                  return (
                    <li key={c.id}>
                      <button
                        className="ta__card"
                        onClick={() => onOpen(c.id)}
                        aria-label={`Open ${c.name}, rank ${rank}, ${round(scored.percent)} percent`}
                      >
                        <span className="ta__card-rank" aria-hidden="true">
                          #{rank}
                        </span>
                        <span className="ta__card-main">
                          <span className="ta__card-name">{c.name}</span>
                          <span className="ta__card-headline">
                            {c.headline}
                          </span>
                        </span>
                        <span className="ta__card-score">
                          {round(scored.percent)}
                          <span className="ta__card-pct">%</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
                {cards.length === 0 && (
                  <li className="ta__col-empty">none</li>
                )}
              </ul>
            </section>
          );
        })}
      </div>

      <p className="ta__legend">
        Cards are ranked across the whole role by weighted percent, so the
        leader carries rank #1 wherever they sit in the funnel. Open a card to
        score the candidate and move them through the stages.
      </p>
    </div>
  );
}

// ---------- candidate detail ----------

function CandidateDetail({
  role,
  candidate,
  rank,
  onClose,
}: {
  role: Role;
  candidate: Candidate;
  rank: number;
  reduce: boolean;
  onClose: () => void;
}) {
  const scored = scoreCandidate(role, candidate);
  const advance = canAdvance(role, candidate);
  const reject = canReject(candidate);
  const target = nextStageOf(candidate.stage);

  return (
    <div
      className="ta__detail glass"
      role="region"
      aria-label={`Scoring ${candidate.name}`}
    >
      <header className="ta__detail-head">
        <div className="ta__detail-id">
          <span className="ta__detail-rank">#{rank}</span>
          <span className="ta__detail-name">{candidate.name}</span>
          <span className="ta__detail-headline">{candidate.headline}</span>
        </div>
        <div className="ta__detail-total" aria-live="polite">
          <span className="ta__detail-total-val">{round(scored.percent)}</span>
          <span className="ta__detail-total-label">
            weighted % / stage {STAGE_LABEL[candidate.stage]}
          </span>
        </div>
        <button
          className="ta__detail-close"
          onClick={onClose}
          aria-label="Close candidate detail"
        >
          Close
        </button>
      </header>

      <div className="ta__criteria">
        {scored.breakdown.map((b) => (
          <div key={b.id} className="ta__crit">
            <div className="ta__crit-top">
              <span className="ta__crit-label">{b.label}</span>
              <span className="ta__crit-weight">weight {b.weight}</span>
              <span className="ta__crit-points">{b.points.toFixed(1)} pts</span>
            </div>
            <div className="ta__crit-row">
              <input
                className="ta__crit-slider"
                type="range"
                min={0}
                max={MAX_RATING}
                step={1}
                value={b.rating}
                aria-label={`${b.label} rating, 0 to ${MAX_RATING}`}
                onChange={(e) =>
                  setScore(candidate.id, b.id, Number(e.target.value))
                }
              />
              <output className="ta__crit-rating">
                {b.rating}/{MAX_RATING}
              </output>
            </div>
          </div>
        ))}
      </div>

      <div className="ta__actions">
        <div className="ta__action-col">
          <button
            className="demo__btn"
            disabled={!advance.ok}
            onClick={() => advanceCandidate(candidate.id)}
          >
            {target ? `Advance to ${STAGE_LABEL[target]}` : 'Advance'}
          </button>
          <p className="ta__action-note">{advance.reason}</p>
        </div>
        <div className="ta__action-col">
          <button
            className="demo__btn demo__btn--ghost"
            disabled={!reject.ok}
            onClick={() => rejectCandidate(candidate.id)}
          >
            Reject
          </button>
          <p className="ta__action-note">{reject.reason}</p>
        </div>
      </div>
    </div>
  );
}

// ---------- add candidate ----------

function AddCandidate({ roleId }: { roleId: string }) {
  const [name, setName] = useState('');
  const [headline, setHeadline] = useState('');

  function submit() {
    const id = addCandidate(roleId, name, headline);
    if (id) {
      setName('');
      setHeadline('');
    }
  }

  return (
    <div className="ta__add">
      <input
        className="ta__input"
        placeholder="Candidate name"
        value={name}
        aria-label="New candidate name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <input
        className="ta__input"
        placeholder="Headline"
        value={headline}
        aria-label="New candidate headline"
        onChange={(e) => setHeadline(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <button className="demo__btn" disabled={!name.trim()} onClick={submit}>
        Add candidate
      </button>
    </div>
  );
}

// ---------- rubric editor + scoreboard ----------

function RubricEditor({
  role,
  ranked,
  rankOf,
}: {
  role: Role;
  ranked: Ranked;
  rankOf: RankMap;
}) {
  // Draft edits live in local state so an invalid in-progress sum does not
  // corrupt the persisted role; the store rejects an invalid rubric anyway.
  const [draft, setDraft] = useState<Criterion[]>(role.criteria);
  const [title, setTitle] = useState(role.title);
  const [threshold, setThreshold] = useState(role.advanceThreshold);
  const [savedAt, setSavedAt] = useState<'saved' | 'rejected' | null>(null);

  // Reset the draft when the selected role changes underneath the editor.
  const [trackedId, setTrackedId] = useState(role.id);
  if (trackedId !== role.id) {
    setTrackedId(role.id);
    setDraft(role.criteria);
    setTitle(role.title);
    setThreshold(role.advanceThreshold);
    setSavedAt(null);
  }

  const sum = weightSum(draft);
  const valid = rubricValid(draft);

  function setWeight(id: string, weight: number) {
    setDraft((d) =>
      d.map((c) =>
        c.id === id
          ? { ...c, weight: Math.max(0, Math.min(100, Math.round(weight) || 0)) }
          : c,
      ),
    );
    setSavedAt(null);
  }

  function setLabel(id: string, label: string) {
    setDraft((d) => d.map((c) => (c.id === id ? { ...c, label } : c)));
    setSavedAt(null);
  }

  function addCriterion() {
    setDraft((d) => [
      ...d,
      {
        id: `cr-${d.length}-${Math.floor(Math.random() * 1e6).toString(36)}`,
        label: 'New criterion',
        weight: 0,
      },
    ]);
    setSavedAt(null);
  }

  function removeCriterion(id: string) {
    setDraft((d) => d.filter((c) => c.id !== id));
    setSavedAt(null);
  }

  function save() {
    const ok = updateRole(role.id, {
      title,
      criteria: draft,
      advanceThreshold: threshold,
    });
    setSavedAt(ok ? 'saved' : 'rejected');
  }

  return (
    <div className="ta__rubric">
      <div className="ta__rubric-grid">
        <label className="ta__field">
          <span className="ta__field-label">Role title</span>
          <input
            className="ta__input"
            value={title}
            aria-label="Role title"
            onChange={(e) => {
              setTitle(e.target.value);
              setSavedAt(null);
            }}
          />
        </label>
        <label className="ta__field">
          <span className="ta__field-label">
            Advance threshold ({threshold}%)
          </span>
          <input
            className="ta__crit-slider"
            type="range"
            min={0}
            max={100}
            step={5}
            value={threshold}
            aria-label="Advance threshold percent"
            onChange={(e) => {
              setThreshold(Number(e.target.value));
              setSavedAt(null);
            }}
          />
        </label>
      </div>

      <ul className="ta__critlist" aria-label="rubric criteria">
        {draft.map((c) => (
          <li key={c.id} className="ta__critedit">
            <input
              className="ta__input ta__input--label"
              value={c.label}
              aria-label="Criterion label"
              onChange={(e) => setLabel(c.id, e.target.value)}
            />
            <input
              className="ta__input ta__input--weight"
              type="number"
              min={0}
              max={100}
              value={c.weight}
              aria-label={`${c.label} weight`}
              onChange={(e) => setWeight(c.id, Number(e.target.value))}
            />
            <button
              className="ta__critdel"
              aria-label={`Remove ${c.label}`}
              onClick={() => removeCriterion(c.id)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <div className="ta__rubric-foot">
        <button className="demo__btn demo__btn--ghost" onClick={addCriterion}>
          Add criterion
        </button>
        <span
          className={`ta__sum${valid ? ' ta__sum--ok' : ' ta__sum--bad'}`}
          aria-live="polite"
        >
          weights sum to {sum} / 100 {valid ? 'ok' : 'must equal 100'}
        </span>
        <button className="demo__btn" disabled={!valid} onClick={save}>
          Save rubric
        </button>
        {savedAt === 'saved' && (
          <span className="ta__saved" role="status">
            saved
          </span>
        )}
        {savedAt === 'rejected' && (
          <span className="ta__saved ta__saved--bad" role="status">
            rejected
          </span>
        )}
      </div>

      <div className="ta__scoreboard">
        <h4 className="ta__scoreboard-head">Scoreboard</h4>
        <ol className="ta__scorelist">
          {ranked.map((scored) => {
            const c = scored.candidate;
            return (
              <li key={c.id} className="ta__scorerow">
                <span className="ta__scorerow-rank">
                  #{rankOf.get(c.id) ?? 0}
                </span>
                <span className="ta__scorerow-name">{c.name}</span>
                <span className="ta__scorerow-stage">
                  {STAGE_LABEL[c.stage]}
                </span>
                <span
                  className="ta__scorerow-bar"
                  role="meter"
                  aria-label={`${c.name} weighted percent`}
                  aria-valuenow={round(scored.percent)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span
                    className="ta__scorerow-fill"
                    style={{ width: `${scored.percent}%` }}
                  />
                </span>
                <span className="ta__scorerow-pct">
                  {round(scored.percent)}%
                </span>
              </li>
            );
          })}
          {ranked.length === 0 && (
            <li className="ta__col-empty">no candidates for this role</li>
          )}
        </ol>
      </div>
    </div>
  );
}
