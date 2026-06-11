import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './context-surgeon.css';

// context-surgeon audits the fixed config a session loads before any prompt.
// It counts tokens offline and flags three kinds of problem: skill descriptions
// clipped at the 1,536-character truncation limit, rules whose paths
// frontmatter matches no files, and duplicate paragraphs. Against the roughly
// 18,000 fixed-config tokens per session it renders findings as a treemap and
// returns exit code 1 when any warning-severity finding is present.
const CLIP_LIMIT = 1536;
const SESSION_TOKENS = 18000;

type FindingKind = 'clip' | 'dead' | 'dup';

type Finding = { kind: FindingKind; text: string };

type ConfigFile = {
  name: string;
  tokens: number;
  findings: Finding[];
};

// An illustrative fixed-config layout whose token shares sum near the
// roughly-18,000-token session budget. Files carrying a finding spell out the
// concrete reason the tool would report.
const FILES: ConfigFile[] = [
  {
    name: 'instructions.md',
    tokens: 4200,
    findings: [
      {
        kind: 'dup',
        text: 'A 3-sentence paragraph repeats almost verbatim in two sections (TF-IDF cosine over character n-grams = 0.94).',
      },
    ],
  },
  { name: 'git-workflow.md', tokens: 1300, findings: [] },
  {
    name: 'review-pr/SKILL.md',
    tokens: 2600,
    findings: [
      {
        kind: 'clip',
        text: `Description clipped at the ${CLIP_LIMIT}-character limit, over by 214 characters; the tail is never loaded.`,
      },
    ],
  },
  { name: 'security.md', tokens: 1700, findings: [] },
  {
    name: 'deploy.rules.md',
    tokens: 1450,
    findings: [
      {
        kind: 'dead',
        text: 'paths frontmatter "infra/**/*.tf" matches no files in the project, so this rule never activates.',
      },
    ],
  },
  { name: 'testing.md', tokens: 1100, findings: [] },
  {
    name: 'pdf/SKILL.md',
    tokens: 1900,
    findings: [
      {
        kind: 'clip',
        text: `Description clipped at the ${CLIP_LIMIT}-character limit, over by 88 characters.`,
      },
    ],
  },
  { name: 'commit.rules.md', tokens: 900, findings: [] },
  {
    name: 'agents.md',
    tokens: 1350,
    findings: [
      {
        kind: 'dup',
        text: 'An agent-routing paragraph duplicates one already present in instructions.md.',
      },
    ],
  },
];

const KIND_LABEL: Record<FindingKind, string> = {
  clip: 'clipped description',
  dead: 'dead-path rule',
  dup: 'duplicate paragraph',
};

type Rect = { x: number; y: number; w: number; h: number };
type Placed = ConfigFile & Rect;

// Squarified treemap over a 100x100 coordinate box, sized by token count.
function squarify(items: ConfigFile[], box: Rect): Placed[] {
  const total = items.reduce((s, it) => s + it.tokens, 0);
  const scale = (box.w * box.h) / total;
  const scaled = items.map((it) => ({ ...it, area: it.tokens * scale }));
  const placed: Placed[] = [];
  let rect = { ...box };
  let row: (ConfigFile & { area: number })[] = [];
  let i = 0;

  const shortSide = () => Math.min(rect.w, rect.h);
  const worst = (r: typeof row, side: number) => {
    if (r.length === 0) return Infinity;
    const sum = r.reduce((s, x) => s + x.area, 0);
    const max = Math.max(...r.map((x) => x.area));
    const min = Math.min(...r.map((x) => x.area));
    const s2 = side * side;
    const sum2 = sum * sum;
    return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
  };

  const layoutRow = (r: typeof row) => {
    const sum = r.reduce((s, x) => s + x.area, 0);
    if (rect.w >= rect.h) {
      const rw = sum / rect.h;
      let y = rect.y;
      for (const it of r) {
        const h = it.area / rw;
        placed.push({ ...it, x: rect.x, y, w: rw, h });
        y += h;
      }
      rect = { x: rect.x + rw, y: rect.y, w: rect.w - rw, h: rect.h };
    } else {
      const rh = sum / rect.w;
      let x = rect.x;
      for (const it of r) {
        const w = it.area / rh;
        placed.push({ ...it, x, y: rect.y, w, h: rh });
        x += w;
      }
      rect = { x: rect.x, y: rect.y + rh, w: rect.w, h: rect.h - rh };
    }
  };

  while (i < scaled.length) {
    const next = scaled[i];
    const side = shortSide();
    if (worst(row, side) >= worst([...row, next], side)) {
      row.push(next);
      i++;
    } else {
      layoutRow(row);
      row = [];
    }
  }
  if (row.length) layoutRow(row);
  return placed;
}

const ease = [0.22, 1, 0.36, 1] as const;
const KIND_FILL: Record<string, string> = {
  base: '#3a3a46',
  clip: '#ff5b29',
  dead: '#ffc759',
  dup: '#78a2ff',
};

export default function ContextSurgeonDemo() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState<Record<FindingKind, boolean>>({
    clip: true,
    dead: true,
    dup: true,
  });
  const [selected, setSelected] = useState<string | null>('instructions.md');

  const placed = useMemo(
    () => squarify(FILES, { x: 0, y: 0, w: 100, h: 100 }),
    [],
  );

  const counts = useMemo(() => {
    const c: Record<FindingKind, number> = { clip: 0, dead: 0, dup: 0 };
    for (const f of FILES)
      for (const fd of f.findings) c[fd.kind] += 1;
    return c;
  }, []);

  const totalFindings = counts.clip + counts.dead + counts.dup;
  const auditedTokens = FILES.reduce((s, f) => s + f.tokens, 0);
  const sel = FILES.find((f) => f.name === selected) ?? null;
  const hasWarning = totalFindings > 0;

  function fillFor(f: ConfigFile): string {
    const flagged = f.findings.find((fd) => active[fd.kind]);
    if (flagged) return KIND_FILL[flagged.kind];
    return KIND_FILL.base;
  }

  function flagClass(f: ConfigFile): string {
    const flagged = f.findings.find((fd) => active[fd.kind]);
    return flagged ? `cs__cell--flag-${flagged.kind}` : '';
  }

  function toggle(kind: FindingKind) {
    setActive((p) => ({ ...p, [kind]: !p[kind] }));
  }

  return (
    <div className="demo" aria-label="context-surgeon fixed-config audit demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Audit the fixed config before you type</h3>
      <p className="demo__lede">
        Every file a session loads before your first prompt is a sized block,
        counted offline by token. Toggle a finding type to light up the files
        that trip it: descriptions clipped at the {CLIP_LIMIT.toLocaleString()}
        -character limit, rules whose paths match no files, and duplicate
        paragraphs. Click any block to read the exact reason.
      </p>

      <div className="cs__stage">
        <div className="cs__toolbar" role="group" aria-label="Finding filters">
          {(['clip', 'dead', 'dup'] as FindingKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`cs__filter cs__filter--${k} ${active[k] ? 'cs__filter--on' : ''}`}
              aria-pressed={active[k]}
              onClick={() => toggle(k)}
            >
              <span className="cs__filter-dot" />
              {KIND_LABEL[k]}
              <span className="cs__filter-count">{counts[k]}</span>
            </button>
          ))}
        </div>

        <div className="cs__map" role="group" aria-label="Token treemap">
          {placed.map((p) => {
            const dimmed =
              totalFindings > 0 &&
              p.findings.length > 0 &&
              !p.findings.some((fd) => active[fd.kind]);
            return (
              <motion.button
                key={p.name}
                type="button"
                className={`cs__cell ${flagClass(p)} ${dimmed ? 'cs__cell--dim' : ''}`}
                style={{
                  left: `${p.x}%`,
                  top: `${p.y}%`,
                  width: `${p.w}%`,
                  height: `${p.h}%`,
                }}
                animate={{ backgroundColor: fillFor(p) }}
                initial={false}
                transition={{ duration: reduce ? 0 : 0.3, ease }}
                aria-pressed={selected === p.name}
                aria-label={`${p.name}, ${p.tokens} tokens${p.findings.length ? ', flagged' : ''}`}
                onClick={() => setSelected(p.name)}
                onMouseEnter={() => setSelected(p.name)}
                onFocus={() => setSelected(p.name)}
              >
                <span className="cs__cell-inner">
                  <span className="cs__cell-name">{p.name}</span>
                  {p.w > 14 && p.h > 12 && (
                    <span className="cs__cell-tok">
                      {p.tokens.toLocaleString()} tok
                    </span>
                  )}
                </span>
              </motion.button>
            );
          })}
        </div>

        <div className="cs__detail" aria-live="polite">
          {sel ? (
            <>
              <div className="cs__detail-head">
                <span className="cs__detail-name">{sel.name}</span>
                <span className="cs__detail-tok">
                  {sel.tokens.toLocaleString()} tokens
                </span>
                <span className="cs__detail-share">
                  {((sel.tokens / SESSION_TOKENS) * 100).toFixed(1)}% of the
                  session budget
                </span>
              </div>
              {sel.findings.length > 0 ? (
                <div className="cs__findings">
                  {sel.findings.map((fd, idx) => (
                    <div key={idx} className="cs__finding">
                      <span className={`cs__finding-tag cs__finding-tag--${fd.kind}`}>
                        {fd.kind}
                      </span>
                      <span>{fd.text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="cs__clean">no warnings on this file</div>
              )}
            </>
          ) : (
            <div className="cs__clean">hover a block to inspect it</div>
          )}
        </div>

        <div className="cs__exit">
          <span
            className={`cs__exit-code ${hasWarning ? 'cs__exit-code--warn' : 'cs__exit-code--ok'}`}
          >
            exit {hasWarning ? 1 : 0}
          </span>
          <span className="cs__exit-text">
            {hasWarning
              ? `${totalFindings} warning-severity findings, so the run exits 1 and a pre-commit hook or CI step fails. Add --json for a machine-readable report.`
              : 'No warnings, so the run exits 0 and the hook passes.'}
          </span>
          <span className="cs__exit-total">
            audited <b>{auditedTokens.toLocaleString()}</b> of ~
            {SESSION_TOKENS.toLocaleString()} tokens
          </span>
        </div>
      </div>

      <div className="demo__controls">
        <span className="demo__hint">
          tokens counted offline with a bundled tokenizer
        </span>
      </div>
    </div>
  );
}
