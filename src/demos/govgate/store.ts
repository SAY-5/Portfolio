// Browser-side store for GovGate. It holds the policy framework and the current
// assessment, persisted to localStorage. Actions only handle identity and
// persistence; every scoring decision is delegated to the pure engine. A minimal
// external store with subscribe/getState lets the React binding use
// useSyncExternalStore.

import { clampThreshold } from './engine';
import type {
  Assessment,
  ControlResult,
  ControlStatus,
  Framework,
} from './types';

const ASSESS_KEY = 'govgate.assessment.v1';

// A fixed AI tool governance framework: ten controls across seven categories,
// each with a weight and a severity. This is the policy the assessment scores
// against. It is constant, so it lives in code rather than localStorage.
export const FRAMEWORK: Framework = {
  id: 'ai-tool-governance',
  name: 'AI tool governance baseline',
  controls: [
    {
      id: 'dr-region',
      category: 'Data residency',
      title: 'Approved regions only',
      requirement:
        'All processing and storage stay within contractually approved regions.',
      weight: 3,
      severity: 'high',
    },
    {
      id: 'pii-redaction',
      category: 'Privacy',
      title: 'No PII to the model',
      requirement:
        'Personal data is redacted or tokenized before any prompt reaches the model.',
      weight: 4,
      severity: 'critical',
    },
    {
      id: 'pii-dpa',
      category: 'Privacy',
      title: 'Data processing agreement',
      requirement:
        'A signed data processing agreement is on file with the vendor.',
      weight: 2,
      severity: 'medium',
    },
    {
      id: 'prov-version',
      category: 'Model provenance',
      title: 'Model and version disclosed',
      requirement:
        'The model family and version in use are documented and disclosed.',
      weight: 2,
      severity: 'medium',
    },
    {
      id: 'ret-purge',
      category: 'Retention',
      title: 'Prompt retention limit',
      requirement: 'Prompts and outputs are purged within thirty days.',
      weight: 2,
      severity: 'high',
    },
    {
      id: 'ovr-human',
      category: 'Human oversight',
      title: 'Human in the loop',
      requirement:
        'A person reviews any action the tool takes that affects production or customers.',
      weight: 3,
      severity: 'high',
    },
    {
      id: 'sec-sso',
      category: 'Security',
      title: 'SSO and access control',
      requirement: 'Access is gated behind single sign-on with role controls.',
      weight: 3,
      severity: 'critical',
    },
    {
      id: 'sec-audit',
      category: 'Security',
      title: 'Audit logging',
      requirement:
        'All access and actions are written to a tamper-evident audit log.',
      weight: 3,
      severity: 'high',
    },
    {
      id: 'ven-finance',
      category: 'Vendor stability',
      title: 'Vendor financial check',
      requirement:
        'The vendor passes a basic financial and continuity check.',
      weight: 1,
      severity: 'low',
    },
    {
      id: 'ven-subproc',
      category: 'Vendor stability',
      title: 'Subprocessor list',
      requirement:
        'A current list of subprocessors is published and reviewed.',
      weight: 1,
      severity: 'low',
    },
  ],
};

// A starting assessment that is part way through: a mix of met, partial,
// not-met, and one not-applicable control, so the score, breakdown, and
// remediation list all have something to show on first load.
function seedAssessment(): Assessment {
  const mk = (status: ControlStatus, note = ''): ControlResult => ({
    status,
    note,
  });
  return {
    threshold: 75,
    results: {
      'dr-region': mk('met', 'Hosted in eu-west-1, confirmed in contract.'),
      'pii-redaction': mk('partial', 'Redaction live for free text; structured fields pending.'),
      'pii-dpa': mk('met'),
      'prov-version': mk('met', 'Documented in the tool intake form.'),
      'ret-purge': mk('not-met', 'Vendor default retention is ninety days.'),
      'ovr-human': mk('partial', 'Review covers writes but not read actions.'),
      'sec-sso': mk('met'),
      'sec-audit': mk('not-met', 'Audit export not yet wired to the SIEM.'),
      'ven-finance': mk('met'),
      'ven-subproc': mk('n-a', 'Single-tenant deployment, no subprocessors.'),
    },
  };
}

export type State = {
  framework: Framework;
  assessment: Assessment;
};

// ---------- persistence ----------

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage may be unavailable (private mode); the app runs in-memory.
  }
}

function loadState(): State {
  return {
    framework: FRAMEWORK,
    assessment: readJSON<Assessment>(ASSESS_KEY, seedAssessment()),
  };
}

// ---------- external store ----------

let state: State = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

function commit(assessment: Assessment): void {
  state = { ...state, assessment };
  writeJSON(ASSESS_KEY, assessment);
  emit();
}

// ---------- actions ----------

// Set the status for one control, preserving its existing note.
export function setControlStatus(controlId: string, status: ControlStatus): void {
  const prev = state.assessment.results[controlId] ?? { status, note: '' };
  commit({
    ...state.assessment,
    results: {
      ...state.assessment.results,
      [controlId]: { ...prev, status },
    },
  });
}

// Set the note for one control, preserving its existing status.
export function setControlNote(controlId: string, note: string): void {
  const prev = state.assessment.results[controlId] ?? {
    status: 'not-met' as ControlStatus,
    note: '',
  };
  commit({
    ...state.assessment,
    results: {
      ...state.assessment.results,
      [controlId]: { ...prev, note },
    },
  });
}

// Set the pass threshold, clamped to 0 to 100 by the engine.
export function setThreshold(value: number): void {
  commit({ ...state.assessment, threshold: clampThreshold(value) });
}

// Wipe the persisted assessment and restore the seed.
export function resetAssessment(): void {
  try {
    localStorage.removeItem(ASSESS_KEY);
  } catch {
    // ignore storage errors
  }
  state = { framework: FRAMEWORK, assessment: seedAssessment() };
  writeJSON(ASSESS_KEY, state.assessment);
  emit();
}
