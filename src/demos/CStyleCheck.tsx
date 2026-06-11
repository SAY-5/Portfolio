import { useMemo, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './CStyleCheck.css';

// Real facts from the project: a stdlib-only Python linter (~3,200 lines)
// enforcing Barr-C:2018 and MISRA-C complementary rules across 50 rule IDs,
// emitting text, JSON, or SARIF 2.1.0 for GitHub Code Scanning, with baseline
// suppression so CI fails only on newly introduced violations.
const RULE_COUNT = 50;

type Format = 'text' | 'json' | 'sarif';

type Finding = {
  rule: string; // rule ID
  std: 'Barr-C' | 'MISRA-C';
  line: number;
  col: number;
  level: 'error' | 'warning';
  message: string;
  legacy: boolean; // present in the baseline (pre-existing)
};

// A small fixed C sample. Each highlighted line maps to one real-style rule ID.
const code: { text: string; finding?: Finding }[] = [
  { text: '#include <stdint.h>' },
  { text: '' },
  {
    text: 'int Calc_Total(int n) {',
    finding: {
      rule: 'BARR-NAM-04',
      std: 'Barr-C',
      line: 3,
      col: 5,
      level: 'warning',
      message: 'function name must be lower_snake_case',
      legacy: true,
    },
  },
  {
    text: '    int total = 0;',
    finding: {
      rule: 'BARR-TYP-01',
      std: 'Barr-C',
      line: 4,
      col: 5,
      level: 'warning',
      message: 'use fixed-width type int32_t, not int',
      legacy: true,
    },
  },
  {
    text: '    for (int i = 0; i < n; i++)',
    finding: {
      rule: 'MISRA-14.4',
      std: 'MISRA-C',
      line: 5,
      col: 5,
      level: 'error',
      message: 'loop body must be a brace-enclosed block',
      legacy: false,
    },
  },
  { text: '        total += i;' },
  {
    text: '    if (total = n) return total;',
    finding: {
      rule: 'MISRA-13.4',
      std: 'MISRA-C',
      line: 7,
      col: 9,
      level: 'error',
      message: 'assignment used as a condition',
      legacy: false,
    },
  },
  {
    text: '    return total',
    finding: {
      rule: 'BARR-FMT-02',
      std: 'Barr-C',
      line: 8,
      col: 17,
      level: 'error',
      message: 'missing semicolon at end of statement',
      legacy: false,
    },
  },
  { text: '}' },
];

const allFindings = code
  .map((l) => l.finding)
  .filter((f): f is Finding => Boolean(f));

const ease = [0.22, 1, 0.36, 1] as const;

export default function CStyleCheckDemo() {
  const reduce = useReducedMotion();
  const [format, setFormat] = useState<Format>('text');
  const [baseline, setBaseline] = useState(true);

  // With the baseline on, legacy findings are suppressed and CI fails only on
  // newly introduced violations.
  const active = useMemo(
    () => allFindings.filter((f) => !(baseline && f.legacy)),
    [baseline],
  );
  const newCount = allFindings.filter((f) => !f.legacy).length;
  const legacyCount = allFindings.filter((f) => f.legacy).length;
  const errorCount = active.filter((f) => f.level === 'error').length;

  const output = useMemo(
    () => renderOutput(format, active),
    [format, active],
  );

  return (
    <div className="demo" aria-label="CStyleCheck linter demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Lint embedded C against {RULE_COUNT} rules</h3>
      <p className="demo__lede">
        Each underlined line maps to one rule ID drawn from the Barr-C:2018 and
        MISRA-C set across {RULE_COUNT} rules. Switch the output between text,
        JSON, and SARIF 2.1.0, then toggle the baseline to suppress legacy
        violations so CI fails only on newly introduced ones.
      </p>

      <div className="cs__bar">
        <div className="cs__formats" role="tablist" aria-label="Output format">
          {(['text', 'json', 'sarif'] as Format[]).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={format === f}
              className={`cs__format ${format === f ? 'cs__format--on' : ''}`}
              onClick={() => setFormat(f)}
            >
              {f === 'sarif' ? 'SARIF 2.1.0' : f.toUpperCase()}
            </button>
          ))}
        </div>
        <label className="cs__baseline">
          <input
            type="checkbox"
            checked={baseline}
            onChange={(e) => setBaseline(e.target.checked)}
          />
          <span>baseline suppression</span>
        </label>
      </div>

      <div className="cs__stage">
        <div className="cs__editor" aria-label="C source with violations">
          <div className="cs__filename">sensor_driver.c</div>
          <ol className="cs__code">
            {code.map((line, i) => {
              const f = line.finding;
              const suppressed = f && baseline && f.legacy;
              const shown = f && !suppressed;
              return (
                <li className="cs__row" key={i}>
                  <span className="cs__ln">{i + 1}</span>
                  <code
                    className={`cs__src ${shown ? `cs__src--${f.level}` : ''} ${
                      suppressed ? 'cs__src--legacy' : ''
                    }`}
                    title={
                      f
                        ? `${f.rule} (${f.std}): ${f.message}${
                            suppressed ? ' [in baseline]' : ''
                          }`
                        : undefined
                    }
                  >
                    {line.text || ' '}
                  </code>
                  {shown && (
                    <span className={`cs__badge cs__badge--${f.level}`}>
                      {f.rule}
                    </span>
                  )}
                  {suppressed && <span className="cs__badge cs__badge--legacy">baseline</span>}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="cs__panel">
          <div className="cs__panel-head">
            <span>
              {format === 'sarif'
                ? 'SARIF 2.1.0'
                : format === 'json'
                  ? 'JSON'
                  : 'text'}{' '}
              output
            </span>
            <span className="cs__panel-count">
              {active.length} reported
            </span>
          </div>
          <AnimatePresence mode="wait">
            <motion.pre
              key={`${format}-${baseline}`}
              className="cs__out"
              initial={{ opacity: 0, y: reduce ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.22, ease }}
            >
              <code>{output}</code>
            </motion.pre>
          </AnimatePresence>
        </div>
      </div>

      <div className="cs__summary">
        <div className="cs__stat">
          <div className="cs__stat-val">{active.length}</div>
          <div className="cs__stat-name">reported</div>
        </div>
        <div className="cs__stat cs__stat--err">
          <div className="cs__stat-val">{errorCount}</div>
          <div className="cs__stat-name">errors</div>
        </div>
        <div className="cs__stat">
          <div className="cs__stat-val">{newCount}</div>
          <div className="cs__stat-name">newly introduced</div>
        </div>
        <div className="cs__stat">
          <div className="cs__stat-val">{baseline ? legacyCount : 0}</div>
          <div className="cs__stat-name">suppressed by baseline</div>
        </div>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn"
          onClick={() => setBaseline((b) => !b)}
        >
          {baseline ? 'Drop baseline' : 'Write baseline'}
        </button>
        <span className="demo__hint">
          {baseline
            ? `CI fails on ${active.length} new (${legacyCount} legacy greyed)`
            : `CI sees all ${allFindings.length} violations`}
        </span>
      </div>
    </div>
  );
}

function renderOutput(format: Format, findings: Finding[]): string {
  if (findings.length === 0) {
    return format === 'text'
      ? 'sensor_driver.c: no new violations'
      : format === 'json'
        ? '{\n  "file": "sensor_driver.c",\n  "results": []\n}'
        : '{\n  "version": "2.1.0",\n  "runs": [\n    { "results": [] }\n  ]\n}';
  }

  if (format === 'text') {
    return findings
      .map(
        (f) =>
          `sensor_driver.c:${f.line}:${f.col}: ${f.level}: [${f.rule}] ${f.message}`,
      )
      .join('\n');
  }

  if (format === 'json') {
    const body = findings
      .map(
        (f) =>
          `    {\n      "ruleId": "${f.rule}",\n      "standard": "${f.std}",\n      "level": "${f.level}",\n      "line": ${f.line},\n      "column": ${f.col},\n      "message": "${f.message}"\n    }`,
      )
      .join(',\n');
    return `{\n  "file": "sensor_driver.c",\n  "results": [\n${body}\n  ]\n}`;
  }

  // SARIF 2.1.0 shape for GitHub Code Scanning.
  const results = findings
    .map(
      (f) =>
        `        {\n          "ruleId": "${f.rule}",\n          "level": "${f.level}",\n          "message": { "text": "${f.message}" },\n          "locations": [\n            { "physicalLocation": {\n              "artifactLocation": { "uri": "sensor_driver.c" },\n              "region": { "startLine": ${f.line}, "startColumn": ${f.col} }\n            } }\n          ]\n        }`,
    )
    .join(',\n');
  return `{\n  "version": "2.1.0",\n  "runs": [\n    {\n      "tool": { "driver": { "name": "CStyleCheck" } },\n      "results": [\n${results}\n      ]\n    }\n  ]\n}`;
}
