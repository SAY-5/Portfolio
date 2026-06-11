import { useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './talentllm.css';

// Retrieval is over a structured talent and learning dataset. Records carry a
// retrieval score against the query; only records at or above the threshold
// are cited, and the answer is composed strictly from cited records.
const RELEVANCE_THRESHOLD = 0.45;

type Record = { id: string; text: string };
type AnswerTok = { t: string; cite?: string }; // cite = record id this token traces to
type Scenario = {
  id: string;
  q: string;
  // record id -> retrieval score for this query
  scores: Record_ScoreMap;
  answer: AnswerTok[] | null; // null means decline
  note: string;
};
type Record_ScoreMap = { [recordId: string]: number };

const RECORDS: Record[] = [
  { id: 'R-114', text: 'Profile P-204 holds an AWS certification, earned 2024.' },
  { id: 'R-271', text: 'Profile P-204 completed the distributed systems track.' },
  { id: 'R-088', text: 'Profile P-061 leads the data platform team in Berlin.' },
  { id: 'R-330', text: 'Course C-12 covers vector retrieval and embeddings.' },
];

const SCENARIOS: Scenario[] = [
  {
    id: 'q1',
    q: 'Which credential does P-204 hold?',
    // "credential" normalizes onto "certification" so R-114 surfaces.
    scores: { 'R-114': 0.91, 'R-271': 0.49, 'R-088': 0.12, 'R-330': 0.08 },
    answer: [
      { t: 'P-204 ' },
      { t: 'holds an AWS certification', cite: 'R-114' },
      { t: ', ' },
      { t: 'earned in 2024', cite: 'R-114' },
      { t: '.' },
    ],
    note: '"credential" is normalized onto "certification", so the certification record clears the bar.',
  },
  {
    id: 'q2',
    q: 'What has P-204 been certified or trained in?',
    // a reworded phrasing surfaces the same supporting records
    scores: { 'R-114': 0.86, 'R-271': 0.71, 'R-088': 0.1, 'R-330': 0.22 },
    answer: [
      { t: 'P-204 ' },
      { t: 'holds an AWS certification', cite: 'R-114' },
      { t: ' and ' },
      { t: 'completed the distributed systems track', cite: 'R-271' },
      { t: '.' },
    ],
    note: 'A different phrasing lands on the same two records; both clear the threshold and are cited.',
  },
  {
    id: 'q3',
    q: 'What is P-061 salary band?',
    // no record covers salary; nothing clears the threshold
    scores: { 'R-114': 0.06, 'R-271': 0.05, 'R-088': 0.31, 'R-330': 0.03 },
    answer: null,
    note: 'No record covers compensation, so nothing clears the threshold and the assistant declines.',
  },
];

const ease = [0.22, 1, 0.36, 1] as const;

export default function TalentLLMDemo() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(SCENARIOS[0].id);
  const scenario = SCENARIOS.find((s) => s.id === active)!;

  // Rank records by retrieval score; those at or above threshold are cited.
  const ranked = useMemo(() => {
    return RECORDS.map((r) => ({
      record: r,
      score: scenario.scores[r.id] ?? 0,
    }))
      .map((x) => ({ ...x, cited: x.score >= RELEVANCE_THRESHOLD }))
      .sort((a, b) => b.score - a.score);
  }, [scenario]);

  const declined = scenario.answer === null;
  const citedIds = ranked.filter((r) => r.cited).map((r) => r.record.id);

  return (
    <div className="demo" aria-label="talentllm grounded answering demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Grounded answers, traced to records</h3>
      <p className="demo__lede">
        Pick a question. Retrieval scores every record against it, and only
        records at or above the relevance threshold are cited. The answer is
        composed strictly from those records, with each content span underlined
        to the citation it traces to. When nothing clears the threshold, the
        grounding guard declines instead of inventing an answer.
      </p>

      <div className="tl__queries" role="group" aria-label="questions">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            className={`tl__query${s.id === active ? ' tl__query--on' : ''}`}
            aria-pressed={s.id === active}
            onClick={() => setActive(s.id)}
          >
            {s.q}
          </button>
        ))}
      </div>

      <div className="tl__stage" style={{ marginTop: 16 }}>
        <div className="tl__col">
          <div className="tl__answer">
            <div className="tl__answer-head">
              <span>Answer</span>
              <span
                className={`tl__answer-state ${declined ? 'tl__answer-state--declined' : 'tl__answer-state--grounded'}`}
              >
                {declined ? 'declined' : 'grounded'}
              </span>
            </div>
            <AnimatePresence mode="wait">
              {declined ? (
                <motion.div
                  key={`decline-${active}`}
                  className="tl__decline"
                  initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.3, ease }}
                >
                  <span className="tl__decline-title">No grounded answer</span>
                  <span className="tl__decline-text">
                    No record cleared the {RELEVANCE_THRESHOLD.toFixed(2)}{' '}
                    relevance threshold, so the assistant returns a no-answer
                    response rather than asserting an ungrounded claim.
                  </span>
                </motion.div>
              ) : (
                <motion.p
                  key={`ans-${active}`}
                  className="tl__answer-body"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.3 }}
                >
                  {scenario.answer!.map((tok, i) =>
                    tok.cite ? (
                      <motion.span
                        key={i}
                        className="tl__tok tl__tok--cited"
                        initial={{ backgroundColor: 'rgba(255,91,41,0)' }}
                        animate={{ backgroundColor: 'rgba(255,91,41,0.16)' }}
                        transition={{
                          duration: reduce ? 0 : 0.4,
                          delay: reduce ? 0 : 0.12 + i * 0.06,
                        }}
                      >
                        {tok.t}
                        <span className="tl__cite">[{tok.cite}]</span>
                      </motion.span>
                    ) : (
                      <span key={i}>{tok.t}</span>
                    ),
                  )}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <div className="tl__stats" aria-label="benchmark figures">
            <div className="tl__stat">
              <div className="tl__stat-val">0.978</div>
              <div className="tl__stat-label">recall@3</div>
            </div>
            <div className="tl__stat">
              <div className="tl__stat-val">
                11.6<span className="tl__stat-unit">ms</span>
              </div>
              <div className="tl__stat-label">mean latency</div>
            </div>
            <div className="tl__stat">
              <div className="tl__stat-val">367</div>
              <div className="tl__stat-label">queries</div>
            </div>
          </div>
        </div>

        <div className="tl__col">
          <div className="tl__records-head">
            <span>Source records</span>
            <span className="tl__records-thr">
              threshold {RELEVANCE_THRESHOLD.toFixed(2)}
            </span>
          </div>
          <div className="tl__records">
            {ranked.map(({ record, score, cited }) => (
              <motion.div
                key={record.id}
                layout={!reduce}
                className={`tl__rec ${cited ? 'tl__rec--cited' : 'tl__rec--dim'}`}
                transition={{ duration: reduce ? 0 : 0.3, ease }}
              >
                <div className="tl__rec-top">
                  <span className="tl__rec-id">{record.id}</span>
                  <span className="tl__rec-score">
                    {cited ? 'cited' : 'below'} {score.toFixed(2)}
                  </span>
                </div>
                <div className="tl__rec-text">{record.text}</div>
                <div className="tl__scorebar" aria-hidden="true">
                  <motion.div
                    className="tl__scorebar-fill"
                    initial={{ width: reduce ? `${score * 100}%` : 0 }}
                    animate={{ width: `${score * 100}%` }}
                    transition={{ duration: reduce ? 0 : 0.45, ease }}
                  />
                  <span
                    className="tl__scorebar-thr"
                    style={{ left: `${RELEVANCE_THRESHOLD * 100}%` }}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <span className="demo__hint">
          {declined
            ? 'guard: 0 records cited, declined'
            : `guard: every content span traces to ${citedIds.join(', ')}`}
        </span>
      </div>
    </div>
  );
}
