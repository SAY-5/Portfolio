import { useReducedMotion } from 'framer-motion';
import { useRef, useState } from 'react';
import '../styles/demo.css';
import './reviewdeck.css';
import { SAMPLE_DIFF, diffStats } from './reviewdeck/diff';
import {
  addChangeset,
  addVerdict,
  evaluatePolicy,
  mergeChangeset,
  resetStore,
  useReviewStore,
} from './reviewdeck/store';
import type { Changeset, FilePatch, HunkLine } from './reviewdeck/types';

// ---- Queue view ----

type QueueViewProps = {
  onSelect: (id: string) => void;
};

function QueueView({ onSelect }: QueueViewProps) {
  const { changesets, verdicts } = useReviewStore();
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [diffText, setDiffText] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!title.trim()) { setError('Title is required.'); return; }
    if (!author.trim()) { setError('Author is required.'); return; }
    if (!diffText.trim()) { setError('Diff text is required.'); return; }
    addChangeset(title, author, diffText);
    setTitle('');
    setAuthor('');
    setDiffText('');
    setCreating(false);
  }

  function loadSample() {
    setDiffText(SAMPLE_DIFF);
  }

  const open = changesets.filter((c) => c.status === 'open');
  const merged = changesets.filter((c) => c.status === 'merged');

  return (
    <div className="rq__root">
      <div className="rq__header">
        <h4 className="rq__h4">Review queue</h4>
        <button
          type="button"
          className="demo__btn rq__new-btn"
          onClick={() => { setCreating((v) => !v); setError(''); }}
          aria-expanded={creating}
        >
          {creating ? 'Cancel' : '+ New changeset'}
        </button>
      </div>

      {creating && (
        <form className="rq__form glass" onSubmit={handleCreate} noValidate>
          <div className="rq__field">
            <label className="rq__label" htmlFor="rd-title">Title</label>
            <input
              id="rd-title"
              className="rq__input"
              type="text"
              placeholder="e.g. refactor: session management"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div className="rq__field">
            <label className="rq__label" htmlFor="rd-author">Author</label>
            <input
              id="rd-author"
              className="rq__input"
              type="text"
              placeholder="e.g. alice"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </div>
          <div className="rq__field">
            <label className="rq__label" htmlFor="rd-diff">
              Diff (unified format)
              <button
                type="button"
                className="rq__sample-btn"
                onClick={loadSample}
                tabIndex={0}
              >
                load sample
              </button>
            </label>
            <textarea
              id="rd-diff"
              className="rq__textarea"
              placeholder="Paste a unified diff here..."
              value={diffText}
              onChange={(e) => setDiffText(e.target.value)}
              rows={8}
              spellCheck={false}
            />
          </div>
          {error && <p className="rq__error" role="alert">{error}</p>}
          <div className="rq__form-actions">
            <button type="submit" className="demo__btn">Create</button>
          </div>
        </form>
      )}

      {changesets.length === 0 && !creating && (
        <p className="rq__empty">No changesets yet. Create one above.</p>
      )}

      {open.length > 0 && (
        <section aria-label="Open changesets">
          <h5 className="rq__section-label">Open ({open.length})</h5>
          <ul className="rq__list" role="list">
            {open.map((cs) => (
              <ChangesetRow
                key={cs.id}
                cs={cs}
                verdicts={verdicts}
                onClick={() => onSelect(cs.id)}
              />
            ))}
          </ul>
        </section>
      )}

      {merged.length > 0 && (
        <section aria-label="Merged changesets">
          <h5 className="rq__section-label rq__section-label--merged">Merged ({merged.length})</h5>
          <ul className="rq__list" role="list">
            {merged.map((cs) => (
              <ChangesetRow
                key={cs.id}
                cs={cs}
                verdicts={verdicts}
                onClick={() => onSelect(cs.id)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

type ChangesetRowProps = {
  cs: Changeset;
  verdicts: ReturnType<typeof useReviewStore>['verdicts'];
  onClick: () => void;
};

function ChangesetRow({ cs, verdicts, onClick }: ChangesetRowProps) {
  const stats = diffStats(cs.patches);
  const policy = evaluatePolicy(cs.id, verdicts);

  return (
    <li className="rq__row glass" role="listitem">
      <button
        type="button"
        className="rq__row-btn"
        onClick={onClick}
        aria-label={`Open changeset: ${cs.title}`}
      >
        <span className="rq__row-title">{cs.title}</span>
        <span className="rq__row-meta">
          <span className="rq__row-author">{cs.author}</span>
          <span className="rq__row-files">
            {cs.patches.length} file{cs.patches.length !== 1 ? 's' : ''}
          </span>
          <span className="rq__row-added">+{stats.added}</span>
          <span className="rq__row-removed">-{stats.removed}</span>
          {cs.status === 'merged' ? (
            <span className="rq__badge rq__badge--merged">merged</span>
          ) : policy.eligible ? (
            <span className="rq__badge rq__badge--ready">ready</span>
          ) : (
            <span className="rq__badge rq__badge--pending">
              {policy.approvals}/2
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

// ---- Diff renderer ----

function HunkLineRow({ line }: { line: HunkLine }) {
  return (
    <div className={`rd-diff__line rd-diff__line--${line.kind}`}>
      <span className="rd-diff__sigil">
        {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
      </span>
      <span className="rd-diff__text">{line.text || '\u00a0'}</span>
    </div>
  );
}

function PatchBlock({ patch }: { patch: FilePatch }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rd-diff__file">
      <button
        type="button"
        className="rd-diff__file-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="rd-diff__file-path">{patch.path}</span>
        <span className="rd-diff__file-stats">
          <span className="rd-diff__file-added">+{patch.added}</span>
          <span className="rd-diff__file-removed">-{patch.removed}</span>
        </span>
        <span className="rd-diff__chevron" aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="rd-diff__hunks">
          {patch.hunks.map((hunk, hi) => (
            <div key={hi} className="rd-diff__hunk">
              {hunk.map((line, li) => (
                <HunkLineRow key={li} line={line} />
              ))}
            </div>
          ))}
          {patch.hunks.length === 0 && (
            <div className="rd-diff__empty-hunk">No hunks parsed</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Verdict form ----

type VerdictFormProps = {
  changesetId: string;
  onDone: () => void;
};

function VerdictForm({ changesetId, onDone }: VerdictFormProps) {
  const [reviewer, setReviewer] = useState('');
  const [kind, setKind] = useState<'approve' | 'request-changes'>('approve');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const reviewerRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!reviewer.trim()) { setError('Reviewer name is required.'); return; }
    addVerdict(changesetId, reviewer, kind, comment);
    onDone();
  }

  return (
    <form className="rv__form glass" onSubmit={handleSubmit} noValidate>
      <h5 className="rv__form-title">Add review</h5>
      <div className="rq__field">
        <label className="rq__label" htmlFor="rv-reviewer">Your name</label>
        <input
          id="rv-reviewer"
          ref={reviewerRef}
          className="rq__input"
          type="text"
          placeholder="e.g. bob"
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
          autoFocus
        />
      </div>
      <div className="rv__radios" role="radiogroup" aria-label="Verdict">
        <label className={`rv__radio-label ${kind === 'approve' ? 'rv__radio-label--active' : ''}`}>
          <input
            type="radio"
            name="rv-kind"
            value="approve"
            checked={kind === 'approve'}
            onChange={() => setKind('approve')}
            className="rv__radio-input"
          />
          Approve
        </label>
        <label className={`rv__radio-label rv__radio-label--req ${kind === 'request-changes' ? 'rv__radio-label--active rv__radio-label--req-active' : ''}`}>
          <input
            type="radio"
            name="rv-kind"
            value="request-changes"
            checked={kind === 'request-changes'}
            onChange={() => setKind('request-changes')}
            className="rv__radio-input"
          />
          Request changes
        </label>
      </div>
      <div className="rq__field">
        <label className="rq__label" htmlFor="rv-comment">Comment (optional)</label>
        <textarea
          id="rv-comment"
          className="rq__textarea rq__textarea--sm"
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Looks good! / Please address..."
        />
      </div>
      {error && <p className="rq__error" role="alert">{error}</p>}
      <div className="rq__form-actions">
        <button type="submit" className="demo__btn">Submit review</button>
      </div>
    </form>
  );
}

// ---- Detail view ----

type DetailViewProps = {
  changesetId: string;
  onBack: () => void;
  reduce: boolean | null;
};

function DetailView({ changesetId, onBack, reduce }: DetailViewProps) {
  const { changesets, verdicts } = useReviewStore();
  const cs = changesets.find((c) => c.id === changesetId);
  const [showForm, setShowForm] = useState(false);

  if (!cs) {
    return (
      <div className="rv__missing">
        <p>Changeset not found.</p>
        <button type="button" className="demo__btn demo__btn--ghost" onClick={onBack}>Back</button>
      </div>
    );
  }

  const csVerdicts = verdicts.filter((v) => v.changesetId === cs.id);
  const policy = evaluatePolicy(cs.id, verdicts);
  const stats = diffStats(cs.patches);

  function handleMerge() {
    if (!policy.eligible || cs!.status === 'merged') return;
    mergeChangeset(cs!.id);
    setShowForm(false);
  }

  return (
    <div className="rv__root">
      <div className="rv__topbar">
        <button
          type="button"
          className="demo__btn demo__btn--ghost rv__back"
          onClick={onBack}
          aria-label="Back to queue"
        >
          ← Back
        </button>
        <span className={`rq__badge ${cs.status === 'merged' ? 'rq__badge--merged' : policy.eligible ? 'rq__badge--ready' : 'rq__badge--pending'}`}>
          {cs.status === 'merged' ? 'merged' : cs.status}
        </span>
      </div>

      <div className="rv__hero glass">
        <h4 className="rv__title">{cs.title}</h4>
        <div className="rv__meta">
          <span className="rv__author">{cs.author}</span>
          <span className="rv__stat rv__stat--added">+{stats.added}</span>
          <span className="rv__stat rv__stat--removed">-{stats.removed}</span>
          <span className="rv__files">{cs.patches.length} file{cs.patches.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {cs.patches.length > 0 ? (
        <section className="rv__diff" aria-label="Diff">
          {cs.patches.map((p, i) => (
            <PatchBlock key={i} patch={p} />
          ))}
        </section>
      ) : (
        <p className="rv__no-diff">No parseable hunks in this diff.</p>
      )}

      <section className="rv__verdicts" aria-label="Reviews">
        <h5 className="rv__section-label">
          Reviews ({csVerdicts.length})
        </h5>
        {csVerdicts.length === 0 && (
          <p className="rv__no-reviews">No reviews yet.</p>
        )}
        <ul className="rv__verdict-list">
          {csVerdicts.map((v) => (
            <li
              key={v.id}
              className={`rv__verdict-item glass ${v.kind === 'approve' ? 'rv__verdict-item--approve' : 'rv__verdict-item--request'}`}
            >
              <span className="rv__verdict-reviewer">{v.reviewer}</span>
              <span className={`rv__verdict-kind ${v.kind === 'approve' ? 'rv__verdict-kind--approve' : 'rv__verdict-kind--request'}`}>
                {v.kind === 'approve' ? 'Approved' : 'Requested changes'}
              </span>
              {v.comment && (
                <span className="rv__verdict-comment">{v.comment}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {cs.status === 'open' && (
        <div className="rv__actions">
          {!showForm && (
            <button
              type="button"
              className="demo__btn demo__btn--ghost"
              onClick={() => setShowForm(true)}
            >
              Add review
            </button>
          )}

          {showForm && (
            <VerdictForm
              changesetId={cs.id}
              onDone={() => setShowForm(false)}
            />
          )}

          <div className="rv__merge-gate">
            <button
              type="button"
              className={`demo__btn rv__merge-btn ${policy.eligible ? '' : 'rv__merge-btn--blocked'}`}
              disabled={!policy.eligible}
              onClick={handleMerge}
              aria-disabled={!policy.eligible}
              style={{ transition: reduce ? 'none' : undefined }}
            >
              Merge
            </button>
            {policy.blockedReason && (
              <span className="rv__blocked-reason" role="status">
                Blocked: {policy.blockedReason}
              </span>
            )}
            {policy.eligible && (
              <span className="rv__eligible-msg" role="status">
                {policy.approvals} approvals, no open requests
              </span>
            )}
          </div>
        </div>
      )}

      {cs.status === 'merged' && (
        <div className="rv__merged-banner" role="status">
          This changeset was merged.
        </div>
      )}
    </div>
  );
}

// ---- Root component ----

export default function ReviewdeckDemo() {
  const reduce = useReducedMotion();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="demo" aria-label="reviewdeck code-review board">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Code review board</h3>
      <p className="demo__lede">
        Create a changeset by pasting a unified diff, then add reviewer verdicts.
        The merge button enables only when 2 approvals exist and there are no
        open change requests. State persists in localStorage.
      </p>

      <div className="rq__stage">
        {selectedId === null ? (
          <QueueView onSelect={setSelectedId} />
        ) : (
          <DetailView
            changesetId={selectedId}
            onBack={() => setSelectedId(null)}
            reduce={reduce}
          />
        )}
      </div>

      <div className="demo__controls">
        <button
          type="button"
          className="demo__btn demo__btn--ghost"
          onClick={() => { resetStore(); setSelectedId(null); }}
        >
          Reset all data
        </button>
        <span className="demo__hint">
          data saved to localStorage; reload to persist
        </span>
      </div>
    </div>
  );
}
