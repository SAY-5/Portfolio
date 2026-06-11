import { useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './talentagent.css';

// The role the agent matches against. Each requirement names the skill that
// satisfies it, so evidence can only ever be a skill the candidate lists.
const ROLE_REQS = [
  { id: 'r1', label: 'Python', skill: 'Python' },
  { id: 'r2', label: 'FastAPI services', skill: 'FastAPI' },
  { id: 'r3', label: 'Embedding retrieval', skill: 'Embeddings' },
  { id: 'r4', label: 'React frontend', skill: 'React' },
  { id: 'r5', label: 'Docker / CI', skill: 'Docker' },
] as const;

type Candidate = {
  id: string;
  name: string;
  title: string;
  skills: string[]; // the only source of evidence
  experienceFit: number; // 0..1
  similarity: number; // 0..1
};

// Two pools. "clear" has a strong top match and a wide margin to the runner-up
// so the gate returns confidently. "ambiguous" packs three near-equal profiles
// so the top-to-runner-up margin is thin and the gate trips to review.
const POOLS: Record<'clear' | 'ambiguous', Candidate[]> = {
  clear: [
    {
      id: 'c1',
      name: 'A. Okafor',
      title: 'Backend / ML engineer',
      skills: ['Python', 'FastAPI', 'Embeddings', 'React', 'Docker'],
      experienceFit: 0.91,
      similarity: 0.88,
    },
    {
      id: 'c2',
      name: 'M. Beck',
      title: 'Platform engineer',
      skills: ['Python', 'Docker'],
      experienceFit: 0.58,
      similarity: 0.52,
    },
    {
      id: 'c3',
      name: 'L. Haddad',
      title: 'Frontend engineer',
      skills: ['React'],
      experienceFit: 0.4,
      similarity: 0.36,
    },
  ],
  ambiguous: [
    {
      id: 'd1',
      name: 'R. Silva',
      title: 'Full-stack engineer',
      skills: ['Python', 'FastAPI', 'React'],
      experienceFit: 0.66,
      similarity: 0.64,
    },
    {
      id: 'd2',
      name: 'T. Nguyen',
      title: 'ML engineer',
      skills: ['Python', 'Embeddings', 'Docker'],
      experienceFit: 0.68,
      similarity: 0.62,
    },
    {
      id: 'd3',
      name: 'K. Adeyemi',
      title: 'Backend engineer',
      skills: ['Python', 'FastAPI', 'Docker'],
      experienceFit: 0.63,
      similarity: 0.6,
    },
  ],
};

// Score weighting: skill coverage, experience fit, semantic similarity.
const W_COVERAGE = 0.5;
const W_EXPERIENCE = 0.25;
const W_SIMILARITY = 0.25;
// Below this top-to-runner-up margin the result set is flagged for review.
const MARGIN_THRESHOLD = 0.06;

type Scored = Candidate & {
  coverage: number;
  met: string[]; // requirement ids satisfied
  missed: string[]; // requirement ids not satisfied
  score: number;
};

function scoreCandidate(c: Candidate): Scored {
  const met: string[] = [];
  const missed: string[] = [];
  for (const r of ROLE_REQS) {
    if (c.skills.includes(r.skill)) met.push(r.id);
    else missed.push(r.id);
  }
  const coverage = met.length / ROLE_REQS.length;
  const score =
    coverage * W_COVERAGE +
    c.experienceFit * W_EXPERIENCE +
    c.similarity * W_SIMILARITY;
  return { ...c, coverage, met, missed, score };
}

const pct = (v: number) => Math.round(v * 100);
const ease = [0.22, 1, 0.36, 1] as const;

export default function TalentAgentDemo() {
  const reduce = useReducedMotion();
  const [pool, setPool] = useState<'clear' | 'ambiguous'>('clear');
  const [open, setOpen] = useState<string | null>(null);

  const ranked = useMemo(() => {
    const scored = POOLS[pool].map(scoreCandidate);
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }, [pool]);

  const top = ranked[0];
  const runnerUp = ranked[1];
  const margin = top && runnerUp ? top.score - runnerUp.score : 1;
  const flagged = margin < MARGIN_THRESHOLD;

  function pick(next: 'clear' | 'ambiguous') {
    setPool(next);
    setOpen(null);
  }

  const reqLabel = (id: string) =>
    ROLE_REQS.find((r) => r.id === id)?.label ?? id;
  const reqSkill = (id: string) =>
    ROLE_REQS.find((r) => r.id === id)?.skill ?? id;

  return (
    <div className="demo" aria-label="talentagent ranked matching demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Ranked matches with a confidence gate</h3>
      <p className="demo__lede">
        The agent scores each candidate on skill coverage, experience fit, and
        semantic similarity, then ranks them. Expand a match to see the bar
        breakdown and the requirements it satisfies, with the matched skill as
        evidence. Switch the field to ambiguous and the top-to-runner-up margin
        narrows until the gate flags the set for human review.
      </p>

      <div className="ta__stage">
        <div className="ta__role">
          <span className="ta__role-label">Role requires</span>
          {ROLE_REQS.map((r) => (
            <span key={r.id} className="ta__req">
              {r.label}
            </span>
          ))}
        </div>

        <ol className="ta__board" aria-label="ranked candidates">
          {ranked.map((c, i) => {
            const isOpen = open === c.id;
            const isTop = i === 0;
            return (
              <li
                key={c.id}
                className={`ta__card${isTop && flagged ? ' ta__card--gated' : ''}`}
              >
                <button
                  className="ta__card-head"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : c.id)}
                >
                  <span className="ta__rank" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="ta__who">
                    <span className="ta__name">{c.name}</span>
                    <span className="ta__title">{c.title}</span>
                  </span>
                  {isTop && flagged ? (
                    <span className="ta__flag">review</span>
                  ) : (
                    <span aria-hidden="true" />
                  )}
                  <span className="ta__score">
                    {pct(c.score)}
                    <span className="ta__score-label">
                      score{' '}
                      <span aria-hidden="true" className="ta__chev">
                        {isOpen ? '-' : '+'}
                      </span>
                    </span>
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      className="ta__body"
                      initial={{ height: reduce ? 'auto' : 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: reduce ? 'auto' : 0, opacity: 0 }}
                      transition={{ duration: reduce ? 0 : 0.32, ease }}
                    >
                      <div className="ta__body-inner">
                        <div className="ta__bars">
                          <Bar
                            name="Skill coverage"
                            value={c.coverage}
                            reduce={reduce}
                          />
                          <Bar
                            name="Experience fit"
                            value={c.experienceFit}
                            reduce={reduce}
                          />
                          <Bar
                            name="Similarity"
                            value={c.similarity}
                            reduce={reduce}
                          />
                        </div>

                        <div className="ta__reqs">
                          <div>
                            <div className="ta__reqcol-head">
                              Satisfied ({c.met.length})
                            </div>
                            <ul className="ta__reqlist">
                              {c.met.map((rid) => (
                                <li
                                  key={rid}
                                  className="ta__reqitem ta__reqitem--met"
                                >
                                  <span>{reqLabel(rid)}</span>
                                  <span className="ta__evidence">
                                    evidence: <b>{reqSkill(rid)}</b> listed
                                  </span>
                                </li>
                              ))}
                              {c.met.length === 0 && (
                                <li className="ta__reqitem ta__reqitem--miss">
                                  none
                                </li>
                              )}
                            </ul>
                          </div>
                          <div>
                            <div className="ta__reqcol-head">
                              Missing ({c.missed.length})
                            </div>
                            <ul className="ta__reqlist">
                              {c.missed.map((rid) => (
                                <li
                                  key={rid}
                                  className="ta__reqitem ta__reqitem--miss"
                                >
                                  <span>{reqLabel(rid)}</span>
                                  <span className="ta__evidence">
                                    no matching skill listed
                                  </span>
                                </li>
                              ))}
                              {c.missed.length === 0 && (
                                <li className="ta__reqitem ta__reqitem--met">
                                  <span>all requirements met</span>
                                </li>
                              )}
                            </ul>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ol>

        <motion.div
          key={flagged ? 'review' : 'confident'}
          className={`ta__gate ${flagged ? 'ta__gate--review' : 'ta__gate--confident'}`}
          initial={{ opacity: 0, y: reduce ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0 : 0.3, ease }}
        >
          <div className="ta__gate-head">
            <span className="ta__gate-title">
              {flagged ? 'Flagged for review' : 'Confident match'}
            </span>
            <span className="ta__gate-margin">
              margin {pct(margin)} pts vs threshold {pct(MARGIN_THRESHOLD)}
            </span>
          </div>
          <p className="ta__gate-text">
            {flagged
              ? `The top score sits only ${pct(margin)} points above the runner-up, below the ${pct(MARGIN_THRESHOLD)}-point gate, so the agent declines to assert a winner and hands the set to a reviewer.`
              : `${top?.name} leads the runner-up by ${pct(margin)} points, clearing the ${pct(MARGIN_THRESHOLD)}-point gate, so the agent returns the ranking with confidence.`}
          </p>
        </motion.div>
      </div>

      <div className="demo__controls" role="group" aria-label="field scenario">
        <button
          className={`demo__btn${pool === 'clear' ? '' : ' demo__btn--ghost'}`}
          aria-pressed={pool === 'clear'}
          onClick={() => pick('clear')}
        >
          Clear field
        </button>
        <button
          className={`demo__btn${pool === 'ambiguous' ? '' : ' demo__btn--ghost'}`}
          aria-pressed={pool === 'ambiguous'}
          onClick={() => pick('ambiguous')}
        >
          Ambiguous field
        </button>
        <span className="demo__hint">
          top {pct(top?.score ?? 0)} / runner-up {pct(runnerUp?.score ?? 0)}
        </span>
      </div>
    </div>
  );
}

function Bar({
  name,
  value,
  reduce,
}: {
  name: string;
  value: number;
  reduce: boolean | null;
}) {
  return (
    <div className="ta__bar-row">
      <span className="ta__bar-name">{name}</span>
      <div
        className="ta__bar-track"
        role="meter"
        aria-label={name}
        aria-valuenow={Math.round(value * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <motion.div
          className="ta__bar-fill"
          initial={{ width: reduce ? `${value * 100}%` : 0 }}
          animate={{ width: `${value * 100}%` }}
          transition={{ duration: reduce ? 0 : 0.5, ease }}
        />
      </div>
      <span className="ta__bar-val">{Math.round(value * 100)}</span>
    </div>
  );
}
