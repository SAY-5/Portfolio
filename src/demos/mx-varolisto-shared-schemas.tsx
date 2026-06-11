import { useMemo, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import '../styles/demo.css';
import './mx-varolisto-shared-schemas.css';

// The package's Mexican-specific validators return { valid, reason } objects so
// callers get a structured failure reason rather than a bare boolean. These are
// faithful ports of the CLABE checksum, the CURP layout, and the RFC layout.
// (validateClabe additionally keeps a boolean API in the real package; here it
// is shown through the same structured shape for a consistent playground.)

type Result = { valid: boolean; reason: string };

const ease = [0.22, 1, 0.36, 1] as const;

const CLABE_WEIGHTS = [3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7];

function validateClabe(raw: string): Result {
  const v = raw.trim();
  if (v.length === 0) return { valid: false, reason: 'empty' };
  if (!/^\d+$/.test(v)) return { valid: false, reason: 'non_digit' };
  if (v.length !== 18) return { valid: false, reason: 'wrong_length' };
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += (CLABE_WEIGHTS[i] * Number(v[i])) % 10;
  }
  const control = (10 - (sum % 10)) % 10;
  if (control !== Number(v[17])) return { valid: false, reason: 'bad_checksum' };
  return { valid: true, reason: 'ok' };
}

const CURP_RE =
  /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HM][A-Z]{5}[A-Z\d]\d$/;

function validateCurp(raw: string): Result {
  const v = raw.trim().toUpperCase();
  if (v.length === 0) return { valid: false, reason: 'empty' };
  if (v.length !== 18) return { valid: false, reason: 'wrong_length' };
  const sex = v[10];
  if (sex && sex !== 'H' && sex !== 'M' && /^[A-Z0-9]+$/.test(v)) {
    return { valid: false, reason: 'bad_sex_marker' };
  }
  if (!CURP_RE.test(v)) return { valid: false, reason: 'bad_format' };
  return { valid: true, reason: 'ok' };
}

const RFC_RE =
  /^([A-ZÑ&]{3,4})\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[A-Z\d]{2}[A\d]$/;

function validateRfc(raw: string): Result {
  const v = raw.trim().toUpperCase();
  if (v.length === 0) return { valid: false, reason: 'empty' };
  if (v.length !== 12 && v.length !== 13) {
    return { valid: false, reason: 'wrong_length' };
  }
  if (!RFC_RE.test(v)) return { valid: false, reason: 'bad_format' };
  return { valid: true, reason: 'ok' };
}

const REASON_COPY: Record<string, string> = {
  empty: 'no input yet',
  non_digit: 'contains non-digit characters',
  wrong_length: 'wrong length',
  bad_checksum: 'control digit does not match',
  bad_sex_marker: 'position 11 must be H or M',
  bad_format: 'does not match the expected layout',
  ok: 'passes every rule',
};

type FieldDef = {
  id: 'clabe' | 'curp' | 'rfc';
  name: string;
  hint: string;
  placeholder: string;
  validate: (s: string) => Result;
  examples: { label: string; value: string }[];
};

const FIELDS: FieldDef[] = [
  {
    id: 'clabe',
    name: 'CLABE',
    hint: '18 digits, last is a mod-10 control digit',
    placeholder: '012180012345678909',
    validate: validateClabe,
    examples: [
      { label: 'valid', value: '012180012345678909' },
      { label: 'bad checksum', value: '012180012345678903' },
      { label: 'too short', value: '0121800123456789' },
    ],
  },
  {
    id: 'curp',
    name: 'CURP',
    hint: '18 chars: name + birth date + sex + state',
    placeholder: 'GODE561231HDFXYZ09',
    validate: validateCurp,
    examples: [
      { label: 'valid', value: 'GODE561231HDFXYZ09' },
      { label: 'bad month', value: 'GODE561331HDFXYZ09' },
      { label: 'bad sex', value: 'GODE561231XDFXYZ09' },
    ],
  },
  {
    id: 'rfc',
    name: 'RFC',
    hint: '13 chars for a person, 12 for a company',
    placeholder: 'GODE561231GR8',
    validate: validateRfc,
    examples: [
      { label: 'person', value: 'GODE561231GR8' },
      { label: 'company', value: 'ABC850101AB1' },
      { label: 'bad date', value: 'GODE561331GR8' },
    ],
  },
];

export default function VarolistoSchemasDemo() {
  const reduce = useReducedMotion();
  const [values, setValues] = useState<Record<string, string>>({
    clabe: '',
    curp: '',
    rfc: '',
  });

  const results = useMemo(() => {
    const out: Record<string, Result> = {};
    for (const f of FIELDS) out[f.id] = f.validate(values[f.id] ?? '');
    return out;
  }, [values]);

  const touched = FIELDS.filter((f) => (values[f.id] ?? '').trim().length > 0);
  const passing = touched.filter((f) => results[f.id].valid).length;

  function setField(id: string, v: string) {
    setValues((prev) => ({ ...prev, [id]: v }));
  }

  return (
    <div className="demo" aria-label="Varolisto shared schemas validation demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Mexican identifier validators</h3>
      <p className="demo__lede">
        Type a CLABE, CURP, or RFC. Each validator returns a structured
        {' '}
        <span className="mono">{'{ valid, reason }'}</span> object, so a caller
        learns not just that input failed but exactly which rule it broke. Try
        the example chips to see each failure reason.
      </p>

      <div className="vs__stage">
        <div className="vs__fields">
          {FIELDS.map((f) => {
            const val = values[f.id] ?? '';
            const res = results[f.id];
            const has = val.trim().length > 0;
            const state = !has
              ? ''
              : res.valid
                ? 'vs__field--valid'
                : 'vs__field--invalid';
            return (
              <div key={f.id} className={`vs__field ${state}`}>
                <div className="vs__field-head">
                  <span className="vs__field-name">{f.name}</span>
                  <span className="vs__field-hint">{f.hint}</span>
                  {has && (
                    <span className="vs__field-status">
                      {res.valid ? 'valid' : 'invalid'}
                    </span>
                  )}
                </div>
                <input
                  className="vs__input"
                  type="text"
                  inputMode={f.id === 'clabe' ? 'numeric' : 'text'}
                  spellCheck={false}
                  autoCapitalize="characters"
                  value={val}
                  placeholder={f.placeholder}
                  aria-label={`${f.name} value`}
                  aria-invalid={has ? !res.valid : undefined}
                  onChange={(e) => setField(f.id, e.target.value)}
                />

                <AnimatePresence mode="wait">
                  {has && (
                    <motion.div
                      key={res.valid ? 'ok' : res.reason}
                      className={`vs__reason ${res.valid ? 'vs__reason--ok' : 'vs__reason--err'}`}
                      initial={{ opacity: 0, y: reduce ? 0 : 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: reduce ? 0 : 0.22, ease }}
                    >
                      <span className="vs__reason-key">reason:</span>
                      <span className="vs__reason-val">
                        {res.reason} ({REASON_COPY[res.reason]})
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {has && (
                  <div className="vs__return" aria-hidden="true">
                    <span className="vs__b">validate{f.name}</span>(
                    <span className="vs__k">"{val}"</span>) {'->'} {'{ '}
                    valid:{' '}
                    <span
                      className={res.valid ? 'vs__s-ok' : 'vs__s-err'}
                    >
                      {String(res.valid)}
                    </span>
                    , reason:{' '}
                    <span
                      className={res.valid ? 'vs__s-ok' : 'vs__s-err'}
                    >
                      "{res.reason}"
                    </span>
                    {' }'}
                  </div>
                )}

                <div className="vs__examples">
                  {f.examples.map((ex) => (
                    <button
                      key={ex.value}
                      type="button"
                      className="vs__chip-btn"
                      onClick={() => setField(f.id, ex.value)}
                    >
                      {ex.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <AnimatePresence>
          {touched.length > 0 && (
            <motion.div
              className="vs__summary"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.3, ease }}
            >
              <span className="vs__summary-x">
                {passing}/{touched.length}
              </span>
              <span className="vs__summary-text">
                fields passing. These validators ship alongside Zod schemas for
                a six-step loan application form, with domain enums covering 11
                loan states and 9 file types, all inferred straight into
                TypeScript types.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn demo__btn--ghost"
          type="button"
          onClick={() => setValues({ clabe: '', curp: '', rfc: '' })}
        >
          Clear
        </button>
        <span className="demo__hint">
          structured failure reasons, not just a boolean
        </span>
      </div>
    </div>
  );
}
