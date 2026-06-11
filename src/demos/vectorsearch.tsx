import { useMemo, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './vectorsearch.css';

// Real behavior from the project: each query runs a vector cosine top-K
// (pgvector HNSW) and a BM25 top-K (Postgres tsvector + GIN) in parallel, then
// fuses them with Reciprocal Rank Fusion: score = sum(1 / (k + rank)), k = 60.
// Target is sub-90ms p95 across a 2M-document index, enforced by a CI gate.
const RRF_K = 60;
const P95_MS = 90;
const INDEX_DOCS = '2M';
const ease = [0.22, 1, 0.36, 1] as const;

type Doc = { id: string; title: string };

// Three canned queries. For each, the two retrievers return their own ranked
// top-5 over a shared candidate pool, so fusion has overlap to work with.
const QUERIES: Record<
  string,
  { label: string; vector: string[]; bm25: string[]; docs: Record<string, Doc> }
> = {
  q1: {
    label: 'how to rotate database credentials',
    docs: {
      a: { id: 'a', title: 'Rotating Postgres roles without downtime' },
      b: { id: 'b', title: 'Secrets manager credential rotation' },
      c: { id: 'c', title: 'Zero-downtime password change runbook' },
      d: { id: 'd', title: 'Connection pool reconnect on rotation' },
      e: { id: 'e', title: 'IAM auth tokens for RDS' },
      f: { id: 'f', title: 'Vault dynamic database secrets' },
      g: { id: 'g', title: 'Audit log of credential changes' },
    },
    vector: ['c', 'a', 'f', 'b', 'd'],
    bm25: ['a', 'b', 'g', 'c', 'e'],
  },
  q2: {
    label: 'reduce p99 latency on the read path',
    docs: {
      a: { id: 'a', title: 'Covering indexes for hot read queries' },
      b: { id: 'b', title: 'Caching the read path with a TTL' },
      c: { id: 'c', title: 'Tail latency and the p99 problem' },
      d: { id: 'd', title: 'Connection pool sizing under load' },
      e: { id: 'e', title: 'Read replicas and replica lag' },
      f: { id: 'f', title: 'Query plan regressions after a deploy' },
      g: { id: 'g', title: 'Batching N+1 reads into one join' },
    },
    vector: ['c', 'b', 'a', 'e', 'g'],
    bm25: ['a', 'c', 'g', 'd', 'f'],
  },
  q3: {
    label: 'idempotent kafka consumer on replay',
    docs: {
      a: { id: 'a', title: 'Idempotency keys on (source, doc_id)' },
      b: { id: 'b', title: 'Exactly-once vs at-least-once delivery' },
      c: { id: 'c', title: 'Replaying a topic from an offset' },
      d: { id: 'd', title: 'Dedup table for consumer writes' },
      e: { id: 'e', title: 'Consumer group rebalance storms' },
      f: { id: 'f', title: 'Upsert on conflict do nothing' },
      g: { id: 'g', title: 'Offset commit ordering guarantees' },
    },
    vector: ['a', 'd', 'f', 'b', 'c'],
    bm25: ['c', 'a', 'b', 'g', 'e'],
  },
};

type Fused = { id: string; title: string; score: number; vr: number | null; br: number | null };

function fuse(vector: string[], bm25: string[], docs: Record<string, Doc>): Fused[] {
  const ids = new Set([...vector, ...bm25]);
  const rows: Fused[] = [];
  ids.forEach((id) => {
    const vr = vector.indexOf(id);
    const br = bm25.indexOf(id);
    const sv = vr >= 0 ? 1 / (RRF_K + (vr + 1)) : 0;
    const sb = br >= 0 ? 1 / (RRF_K + (br + 1)) : 0;
    rows.push({
      id,
      title: docs[id].title,
      score: sv + sb,
      vr: vr >= 0 ? vr + 1 : null,
      br: br >= 0 ? br + 1 : null,
    });
  });
  return rows.sort((a, b) => b.score - a.score);
}

export default function VectorsearchDemo() {
  const reduce = useReducedMotion();
  const [qKey, setQKey] = useState<keyof typeof QUERIES>('q1');
  const [fused, setFused] = useState(false);

  const q = QUERIES[qKey];
  const fusedRows = useMemo(() => fuse(q.vector, q.bm25, q.docs), [q]);
  const top = fusedRows[0];

  function runQuery(next: keyof typeof QUERIES) {
    setQKey(next);
    setFused(false);
  }

  return (
    <div className="demo" aria-label="vectorsearch hybrid ranking demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Two rankers, one fused result</h3>
      <p className="demo__lede">
        A query fans out to a vector cosine top-K and a BM25 top-K in parallel.
        Fuse them to combine both rankings with Reciprocal Rank Fusion, where
        each document scores sum of 1 / (k + rank) with k = {RRF_K}. Documents
        that both rankers like rise to the top.
      </p>

      <div className="vs__queries" role="group" aria-label="example queries">
        {(Object.keys(QUERIES) as Array<keyof typeof QUERIES>).map((k) => {
          const isActive = k === qKey;
          return (
            <button
              key={k}
              className={`vs__query${isActive ? ' vs__query--active' : ''}`}
              aria-pressed={isActive}
              onClick={() => runQuery(k)}
            >
              {QUERIES[k].label}
            </button>
          );
        })}
      </div>

      <div className="vs__stage">
        <div className="vs__lists">
          <Ranker
            title="vector cosine"
            sub="pgvector HNSW top-K"
            ids={q.vector}
            docs={q.docs}
            reduce={!!reduce}
            dim={fused}
          />
          <Ranker
            title="BM25"
            sub="tsvector + GIN top-K"
            ids={q.bm25}
            docs={q.docs}
            reduce={!!reduce}
            dim={fused}
          />
        </div>

        <AnimatePresence>
          {fused && (
            <motion.div
              className="vs__fused"
              initial={{ opacity: 0, y: reduce ? 0 : 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease }}
            >
              <div className="vs__col-head">
                <span className="vs__col-title">fused (RRF)</span>
                <span className="vs__col-sub">score = sum 1 / ({RRF_K} + rank)</span>
              </div>
              <ol className="vs__fused-list">
                {fusedRows.map((r, i) => (
                  <motion.li
                    key={r.id}
                    className="vs__fused-row"
                    initial={{ opacity: 0, x: reduce ? 0 : -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      duration: reduce ? 0 : 0.32,
                      delay: reduce ? 0 : i * 0.06,
                      ease,
                    }}
                  >
                    <span className="vs__fused-rank">{i + 1}</span>
                    <span className="vs__fused-title">{r.title}</span>
                    <span className="vs__fused-src">
                      {r.vr ? <em className="vs__chip vs__chip--v">v#{r.vr}</em> : null}
                      {r.br ? <em className="vs__chip vs__chip--b">b#{r.br}</em> : null}
                    </span>
                    <span className="vs__fused-score">{r.score.toFixed(4)}</span>
                  </motion.li>
                ))}
              </ol>
              <div className="vs__verdict">
                <strong>{top.title}</strong> wins:{' '}
                {top.vr && top.br
                  ? `ranked v#${top.vr} and b#${top.br}, so both terms add up`
                  : 'highest combined RRF score'}
                . Served in under {P95_MS}ms p95 across a {INDEX_DOCS} index.
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button className="demo__btn" onClick={() => setFused(true)} disabled={fused}>
          {fused ? 'Fused' : 'Fuse with RRF'}
        </button>
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => setFused(false)}
          disabled={!fused}
        >
          Reset
        </button>
        <span className="demo__hint">k = {RRF_K}, two top-K lists fused</span>
      </div>
    </div>
  );
}

function Ranker({
  title,
  sub,
  ids,
  docs,
  reduce,
  dim,
}: {
  title: string;
  sub: string;
  ids: string[];
  docs: Record<string, Doc>;
  reduce: boolean;
  dim: boolean;
}) {
  return (
    <div className={`vs__col${dim ? ' vs__col--dim' : ''}`}>
      <div className="vs__col-head">
        <span className="vs__col-title">{title}</span>
        <span className="vs__col-sub">{sub}</span>
      </div>
      <ol className="vs__list">
        {ids.map((id, i) => (
          <motion.li
            key={id}
            className="vs__row"
            initial={false}
            animate={{ opacity: 1 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
          >
            <span className="vs__rank">{i + 1}</span>
            <span className="vs__title">{docs[id].title}</span>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}
