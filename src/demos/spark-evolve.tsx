import { useMemo, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './spark-evolve.css';

// The load-bearing piece is the schema-evolution validator: it accumulates a
// List of violations across ALL rules instead of short-circuiting on the
// first, under a codified Backward compatibility table.
// Real throughput number: 1,000,000 events in 9,345 ms, about 107,000 ev/s.
const THROUGHPUT = 107000;

type AvroType = 'string' | 'int' | 'long' | 'double';

type Field = {
  name: string;
  type: AvroType;
};

const READER: Field[] = [
  { name: 'event_id', type: 'string' },
  { name: 'user_id', type: 'long' },
  { name: 'amount', type: 'int' },
  { name: 'ts', type: 'long' },
];

// Each toggle is one concrete edit to the writer schema, with the codified
// Backward verdict the rule engine returns for it.
type Change = {
  id: string;
  label: string;
  ok: boolean;
  // how it mutates the writer field list relative to READER
  apply: (fields: Field[]) => Field[];
  // the violation message when not ok, or the allow reason when ok
  reason: string;
};

const CHANGES: Change[] = [
  {
    id: 'add-default',
    label: 'add field "region" with default',
    ok: true,
    apply: (f) => [...f, { name: 'region', type: 'string' }],
    reason: 'add-with-default is backward compatible: old readers see the default',
  },
  {
    id: 'add-nodefault',
    label: 'add field "device" without default',
    ok: false,
    apply: (f) => [...f, { name: 'device', type: 'string' }],
    reason: 'add-without-default rejected: old data has no value for the new field',
  },
  {
    id: 'narrow',
    label: 'narrow "amount" long to int',
    ok: false,
    apply: (f) =>
      f.map((x) => (x.name === 'amount' ? { ...x, type: 'int' } : x)),
    reason: 'type-narrowing rejected: long values do not fit the narrower int',
  },
  {
    id: 'widen',
    label: 'widen "amount" int to long',
    ok: true,
    apply: (f) =>
      f.map((x) => (x.name === 'amount' ? { ...x, type: 'long' } : x)),
    reason: 'type-widening allowed: every int promotes cleanly to long',
  },
  {
    id: 'drop',
    label: 'remove field "ts"',
    ok: false,
    apply: (f) => f.filter((x) => x.name !== 'ts'),
    reason: 'removing a field without default rejected: readers still require it',
  },
];

const ease = [0.22, 1, 0.36, 1] as const;

export default function SparkEvolveDemo() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState<Record<string, boolean>>({
    'add-default': true,
  });

  const selected = CHANGES.filter((c) => active[c.id]);

  // The validator runs the writer fields against the reader and accumulates
  // every violation rather than stopping at the first.
  const violations = selected.filter((c) => !c.ok);
  const passes = selected.filter((c) => c.ok);
  const compatible = violations.length === 0;

  // Build the writer schema view by starting from READER and applying each
  // selected change in order.
  const writer = useMemo(() => {
    let f = READER.map((x) => ({ ...x }));
    const baseNames = new Set(READER.map((x) => x.name));
    for (const c of selected) f = c.apply(f);
    return f.map((x) => {
      const orig = READER.find((r) => r.name === x.name);
      const isAdd = !baseNames.has(x.name);
      const changed = orig ? orig.type !== x.type : false;
      return { ...x, isAdd, changed };
    });
  }, [selected]);

  // A tiny batch the splitter routes: when the schema is incompatible the
  // affected records dead-letter with the structured reason; otherwise the
  // whole batch is valid.
  const BATCH = 6;
  const dlqCount = compatible ? 0 : Math.min(BATCH, 1 + violations.length);
  const validCount = BATCH - dlqCount;

  function toggle(id: string) {
    setActive((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="demo" aria-label="spark-evolve schema compatibility demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Evolve the schema, see what breaks</h3>
      <p className="demo__lede">
        Toggle edits to the writer schema. The validator checks every change
        against the reader under the Backward rules and collects all violations
        at once, not just the first. When the schema is incompatible, the
        affected records dead-letter with a structured reason.
      </p>

      <div className="se__stage">
        <div className="se__schemas">
          <div className="se__schema">
            <div className="se__schema-head">
              <span>reader schema</span>
              <span className="se__schema-tag">registered</span>
            </div>
            <div className="se__fields">
              {READER.map((f) => (
                <div key={f.name} className="se__field">
                  <span className="se__field-name">{f.name}</span>
                  <span className="se__field-type">{f.type}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="se__schema">
            <div className="se__schema-head">
              <span>writer schema</span>
              <span className="se__schema-tag">candidate</span>
            </div>
            <div className="se__fields">
              <AnimatePresence initial={false}>
                {writer.map((f) => (
                  <motion.div
                    key={f.name}
                    className={`se__field${f.isAdd ? ' se__field--add' : ''}${
                      f.changed ? ' se__field--changed' : ''
                    }`}
                    layout={!reduce}
                    initial={{ opacity: 0, y: reduce ? 0 : -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: reduce ? 0 : -4 }}
                    transition={{ duration: reduce ? 0 : 0.2, ease }}
                  >
                    <span className="se__field-name">{f.name}</span>
                    {f.isAdd ? (
                      <span className="se__field-flag">added</span>
                    ) : f.changed ? (
                      <span className="se__field-flag">{f.type}</span>
                    ) : (
                      <span className="se__field-type">{f.type}</span>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="se__controls-row" role="group" aria-label="schema edits">
          {CHANGES.map((c) => (
            <button
              key={c.id}
              className="se__change"
              data-on={!!active[c.id]}
              aria-pressed={!!active[c.id]}
              onClick={() => toggle(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="se__verdict-card" data-ok={compatible}>
          <div className="se__verdict-row">
            <span className="se__verdict-badge">
              {compatible ? 'compatible' : 'rejected'}
            </span>
            <span className="se__verdict-level">
              backward, {violations.length} violation
              {violations.length === 1 ? '' : 's'}
            </span>
          </div>
          <ul className="se__violations">
            {selected.length === 0 && (
              <li className="se__violation se__violation--ok">
                <span className="se__violation-mark">OK</span>
                <span>no edits: writer equals reader, trivially compatible</span>
              </li>
            )}
            {passes.map((c) => (
              <li key={c.id} className="se__violation se__violation--ok">
                <span className="se__violation-mark">OK</span>
                <span>{c.reason}</span>
              </li>
            ))}
            {violations.map((c) => (
              <li key={c.id} className="se__violation">
                <span className="se__violation-mark">X</span>
                <span>{c.reason}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="se__stream" aria-label="record routing">
          <div className="se__source">
            <span className="se__source-label">batch</span>
            <span className="se__source-val">{BATCH}</span>
            <span className="se__source-label">records</span>
          </div>

          <div className="se__sink se__sink--valid">
            <div className="se__sink-head">
              <span>valid to parquet</span>
              <span className="se__sink-count">{validCount}</span>
            </div>
            <div className="se__chips">
              {Array.from({ length: validCount }).map((_, i) => (
                <motion.span
                  key={i}
                  className="se__chip se__chip--valid"
                  initial={{ opacity: 0, scale: reduce ? 1 : 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: reduce ? 0 : 0.2, delay: reduce ? 0 : i * 0.04 }}
                >
                  rec{i + 1}
                </motion.span>
              ))}
            </div>
          </div>

          <div className="se__sink se__sink--dlq">
            <div className="se__sink-head">
              <span>dead-letter sink</span>
              <span className="se__sink-count">{dlqCount}</span>
            </div>
            <div className="se__chips">
              {Array.from({ length: dlqCount }).map((_, i) => (
                <motion.span
                  key={i}
                  className="se__chip se__chip--dlq"
                  initial={{ opacity: 0, scale: reduce ? 1 : 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: reduce ? 0 : 0.2, delay: reduce ? 0 : i * 0.04 }}
                >
                  rec{validCount + i + 1}
                </motion.span>
              ))}
            </div>
            {dlqCount > 0 && (
              <div className="se__dlq-reason">
                original bytes retained, reason: {violations[0]?.reason}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => setActive({})}
        >
          Clear edits
        </button>
        <span className="demo__hint">
          local pipeline: ~{THROUGHPUT.toLocaleString()} events/sec, dead-letter
          is a first-class sink
        </span>
      </div>
    </div>
  );
}
