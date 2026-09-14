// Port of conduit/models.py: task payloads, envelopes and quarantine notes.

export interface Task {
  id: string;
  version: number;
  title: string;
  body: string;
  status: string;
  priority: string;
  assignee: string | null;
  labels: string[];
  fields: Record<string, unknown>;
}

export function makeTask(partial: Partial<Task> & { id: string; title: string }): Task {
  return { version: 1, body: '', status: 'open', priority: 'normal', assignee: null, labels: [], fields: {}, ...partial };
}

// Resolve a dotted path such as fields.region against the task.
export function taskField(task: Task, path: string): unknown {
  let current: unknown = task;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[part];
    if (current === undefined || current === null) return null;
  }
  return current;
}

export interface QuarantineNote {
  stage: 'schema' | 'mapping';
  field: string;
  reason: string;
  detail: string;
}

export interface Envelope {
  task: Task;
  connector: string;
  idempotencyKey: string;
  submittedAt: number;
  attempt: number;
  quarantine?: QuarantineNote;
}

// Python repr for the values a note quotes, so details read as the CLI prints them.
export function pyRepr(v: unknown): string {
  if (typeof v === 'string') return `'${v}'`;
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(', ')}]`;
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  return String(v);
}
