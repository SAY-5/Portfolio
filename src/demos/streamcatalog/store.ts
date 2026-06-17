// Framework-agnostic store for the streamcatalog. Topics, their schema-version
// history, and their producers/consumers persist in localStorage and survive a
// reload. Registering a new schema version runs the pure compatibility engine:
// a compatible change is appended directly, a breaking change is appended only
// when the caller explicitly allows it, and is recorded as such. Nothing here
// talks to a server.

import { checkCompatibility, isCompatible, VERDICT_LABEL } from './engine';
import { seedTopics } from './seed';
import type { CompatibilityReport, Endpoint, Field, Topic } from './types';

const TOPICS_KEY = 'streamcatalog.topics.v1';

export type State = {
  topics: Topic[];
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
    // storage may be unavailable (private mode); the app still works in memory.
  }
}

function loadState(): State {
  const topics = readJSON<Topic[] | null>(TOPICS_KEY, null);
  if (topics && topics.length) return { topics };
  return { topics: seedTopics() };
}

// ---------- minimal external store ----------

let state: State = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function persist(): void {
  writeJSON(TOPICS_KEY, state.topics);
}

function setTopics(topics: Topic[]): void {
  state = { topics };
  persist();
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): State {
  return state;
}

// ---------- derived helpers ----------

export function findTopic(id: string): Topic | undefined {
  return state.topics.find((t) => t.id === id);
}

// The current (latest) schema version of a topic.
export function currentVersion(topic: Topic) {
  return topic.versions[topic.versions.length - 1];
}

// Compare a proposed field list against a topic's current schema.
export function previewChange(
  topicId: string,
  proposed: Field[],
): CompatibilityReport | null {
  const topic = findTopic(topicId);
  if (!topic) return null;
  return checkCompatibility(currentVersion(topic).fields, proposed);
}

export type RegisterResult =
  | { ok: true; version: number; report: CompatibilityReport }
  | { ok: false; reason: string; report: CompatibilityReport | null };

// Register a proposed schema as the next version. A compatible change is always
// accepted. A breaking change is accepted only when `allowBreaking` is set, and
// the version note records that it was force-registered. An identical schema is
// rejected so the history stays meaningful. `now` is passed in so the store
// stays free of clock reads; the UI snapshots the clock once per action.
export function registerVersion(
  topicId: string,
  proposed: Field[],
  allowBreaking: boolean,
  now: number,
): RegisterResult {
  const topic = findTopic(topicId);
  if (!topic) return { ok: false, reason: 'unknown topic', report: null };

  const report = checkCompatibility(currentVersion(topic).fields, proposed);

  if (report.identical) {
    return { ok: false, reason: 'no change from the current schema', report };
  }

  const compatible = isCompatible(report.verdict);
  if (!compatible && !allowBreaking) {
    return {
      ok: false,
      reason: 'breaking change requires an explicit override',
      report,
    };
  }

  const nextVersion = currentVersion(topic).version + 1;
  const note = compatible
    ? VERDICT_LABEL[report.verdict]
    : `${VERDICT_LABEL[report.verdict]} (registered with override)`;

  const updated: Topic = {
    ...topic,
    versions: [
      ...topic.versions,
      {
        version: nextVersion,
        fields: proposed.map((f) => ({ ...f })),
        registeredAt: now,
        note,
      },
    ],
  };

  setTopics(state.topics.map((t) => (t.id === topicId ? updated : t)));
  return { ok: true, version: nextVersion, report };
}

// ---------- producers / consumers ----------

let endpointSeq = 0;

function makeEndpointId(prefix: string): string {
  endpointSeq += 1;
  return `${prefix}-${endpointSeq.toString(36)}`;
}

function withTopic(topicId: string, fn: (t: Topic) => Topic): void {
  setTopics(state.topics.map((t) => (t.id === topicId ? fn(t) : t)));
}

export function addProducer(topicId: string, name: string): void {
  const clean = name.trim();
  if (!clean) return;
  withTopic(topicId, (t) =>
    t.producers.some((p) => p.name === clean)
      ? t
      : { ...t, producers: [...t.producers, { id: makeEndpointId('prod'), name: clean }] },
  );
}

export function removeProducer(topicId: string, endpointId: string): void {
  withTopic(topicId, (t) => ({
    ...t,
    producers: t.producers.filter((p) => p.id !== endpointId),
  }));
}

export function addConsumer(topicId: string, name: string): void {
  const clean = name.trim();
  if (!clean) return;
  withTopic(topicId, (t) =>
    t.consumers.some((c) => c.name === clean)
      ? t
      : { ...t, consumers: [...t.consumers, { id: makeEndpointId('cons'), name: clean }] },
  );
}

export function removeConsumer(topicId: string, endpointId: string): void {
  withTopic(topicId, (t) => ({
    ...t,
    consumers: t.consumers.filter((c) => c.id !== endpointId),
  }));
}

// ---------- reset ----------

export function resetAll(): void {
  try {
    localStorage.removeItem(TOPICS_KEY);
  } catch {
    // ignore storage errors
  }
  endpointSeq = 0;
  state = { topics: seedTopics() };
  emit();
}

export type { Endpoint, Topic };
