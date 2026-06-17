// Browser-side model for the conference scheduler. The full schedule is a fixed
// seed; the only mutable, persisted piece is the personal agenda, a list of
// saved session ids in localStorage. A tiny external store exposes the agenda
// through useSyncExternalStore so React stays in sync without a server.

import { useSyncExternalStore } from 'react';
import type { Session } from './types';

const AGENDA_KEY = 'live-events-spa.agenda.v1';

// Sixteen sessions across three tracks and two time blocks. Block one runs
// 09:00 to 12:00, block two 13:00 to 16:30. Start times are minutes from
// midnight: 540 == 09:00, 780 == 13:00. Several sessions deliberately overlap
// across tracks so building an agenda surfaces real conflicts.
export const schedule: Session[] = [
  {
    id: 's1',
    title: 'Opening Keynote: The Edge of Compute',
    speaker: 'Mara Quinn',
    track: 'Platform',
    room: 'Auditorium',
    startMin: 540,
    durationMin: 60,
    tags: ['keynote', 'infra'],
    abstract:
      'A tour of where compute is heading as workloads push toward the edge and latency budgets shrink.',
  },
  {
    id: 's2',
    title: 'Designing Resilient APIs',
    speaker: 'Theo Adler',
    track: 'Platform',
    room: 'Room A',
    startMin: 615,
    durationMin: 45,
    tags: ['api', 'reliability'],
    abstract:
      'Patterns for timeouts, retries, and backpressure that keep a public API healthy under load.',
  },
  {
    id: 's3',
    title: 'State Management Without Tears',
    speaker: 'Priya Nair',
    track: 'Frontend',
    room: 'Room B',
    startMin: 540,
    durationMin: 45,
    tags: ['react', 'state'],
    abstract:
      'A practical look at external stores, selectors, and when local state is still the right call.',
  },
  {
    id: 's4',
    title: 'CSS That Scales',
    speaker: 'Devon Cole',
    track: 'Frontend',
    room: 'Room B',
    startMin: 600,
    durationMin: 45,
    tags: ['css', 'design'],
    abstract:
      'Tokens, layers, and container queries for stylesheets that survive a growing team.',
  },
  {
    id: 's5',
    title: 'From Notebook to Pipeline',
    speaker: 'Sana Iqbal',
    track: 'Data',
    room: 'Room C',
    startMin: 540,
    durationMin: 60,
    tags: ['data', 'pipelines'],
    abstract:
      'Turning an exploratory notebook into a reproducible, scheduled data pipeline.',
  },
  {
    id: 's6',
    title: 'Vector Search in Practice',
    speaker: 'Liam Fletcher',
    track: 'Data',
    room: 'Room C',
    startMin: 615,
    durationMin: 45,
    tags: ['data', 'search'],
    abstract:
      'Indexing strategies, recall tradeoffs, and cost control for production vector search.',
  },
  {
    id: 's7',
    title: 'Observability for Humans',
    speaker: 'Mara Quinn',
    track: 'Platform',
    room: 'Room A',
    startMin: 675,
    durationMin: 45,
    tags: ['infra', 'observability'],
    abstract:
      'Building dashboards and alerts people actually read instead of muting.',
  },
  {
    id: 's8',
    title: 'Accessible Components by Default',
    speaker: 'Priya Nair',
    track: 'Frontend',
    room: 'Room B',
    startMin: 660,
    durationMin: 45,
    tags: ['react', 'a11y'],
    abstract:
      'Roles, focus order, and keyboard support baked into a component library from the start.',
  },
  {
    id: 's9',
    title: 'Streaming Joins at Scale',
    speaker: 'Sana Iqbal',
    track: 'Data',
    room: 'Room C',
    startMin: 675,
    durationMin: 45,
    tags: ['data', 'streaming'],
    abstract:
      'How to join unbounded streams without unbounded state, with concrete windowing recipes.',
  },
  {
    id: 's10',
    title: 'Zero Downtime Deploys',
    speaker: 'Theo Adler',
    track: 'Platform',
    room: 'Auditorium',
    startMin: 780,
    durationMin: 60,
    tags: ['infra', 'deploys'],
    abstract:
      'Blue green, canaries, and database migrations that ship without a maintenance window.',
  },
  {
    id: 's11',
    title: 'Animation You Can Justify',
    speaker: 'Devon Cole',
    track: 'Frontend',
    room: 'Room B',
    startMin: 780,
    durationMin: 45,
    tags: ['css', 'motion'],
    abstract:
      'Motion that guides attention and respects reduced-motion preferences.',
  },
  {
    id: 's12',
    title: 'Feature Stores Demystified',
    speaker: 'Liam Fletcher',
    track: 'Data',
    room: 'Room C',
    startMin: 780,
    durationMin: 45,
    tags: ['data', 'ml'],
    abstract:
      'What a feature store buys you, what it costs, and when a plain table is enough.',
  },
  {
    id: 's13',
    title: 'Caching: The Two Hard Problems',
    speaker: 'Mara Quinn',
    track: 'Platform',
    room: 'Room A',
    startMin: 855,
    durationMin: 45,
    tags: ['infra', 'performance'],
    abstract:
      'Invalidation strategies and naming conventions for caches that stay correct.',
  },
  {
    id: 's14',
    title: 'Forms That Do Not Fight You',
    speaker: 'Priya Nair',
    track: 'Frontend',
    room: 'Room B',
    startMin: 855,
    durationMin: 45,
    tags: ['react', 'forms'],
    abstract:
      'Validation, error recovery, and accessibility for forms users can finish.',
  },
  {
    id: 's15',
    title: 'Backfills Without Fear',
    speaker: 'Sana Iqbal',
    track: 'Data',
    room: 'Room C',
    startMin: 855,
    durationMin: 45,
    tags: ['data', 'pipelines'],
    abstract:
      'Idempotent, resumable backfills that you can run in the middle of the day.',
  },
  {
    id: 's16',
    title: 'Closing Panel: What We Got Wrong',
    speaker: 'Theo Adler',
    track: 'Platform',
    room: 'Auditorium',
    startMin: 930,
    durationMin: 60,
    tags: ['keynote', 'panel'],
    abstract:
      'Speakers revisit predictions from past years and own the calls that did not land.',
  },
];

// ---------- persistence ----------

function readAgenda(): string[] {
  try {
    const raw = localStorage.getItem(AGENDA_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function writeAgenda(ids: string[]): void {
  try {
    localStorage.setItem(AGENDA_KEY, JSON.stringify(ids));
  } catch {
    // storage may be unavailable (private mode); state still lives in memory.
  }
}

// ---------- external store ----------

let agendaIds: string[] = readAgenda();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Return the stable array reference so useSyncExternalStore can skip renders
// when nothing changed. A new array is only created by the actions below.
export function getAgendaIds(): string[] {
  return agendaIds;
}

const SERVER_SNAPSHOT: string[] = [];

// During SSR there is no localStorage; hand back an empty, stable snapshot.
function getServerSnapshot(): string[] {
  return SERVER_SNAPSHOT;
}

// ---------- actions ----------

export function isSaved(id: string): boolean {
  return agendaIds.includes(id);
}

export function addToAgenda(id: string): void {
  if (agendaIds.includes(id)) return;
  agendaIds = [...agendaIds, id];
  writeAgenda(agendaIds);
  emit();
}

export function removeFromAgenda(id: string): void {
  if (!agendaIds.includes(id)) return;
  agendaIds = agendaIds.filter((x) => x !== id);
  writeAgenda(agendaIds);
  emit();
}

export function toggleAgenda(id: string): void {
  if (agendaIds.includes(id)) removeFromAgenda(id);
  else addToAgenda(id);
}

// Clear the persisted agenda and reset the in-memory list.
export function resetAll(): void {
  try {
    localStorage.removeItem(AGENDA_KEY);
  } catch {
    // ignore storage errors
  }
  agendaIds = [];
  emit();
}

// ---------- React binding ----------

export function useAgendaIds(): string[] {
  return useSyncExternalStore(subscribe, getAgendaIds, getServerSnapshot);
}
