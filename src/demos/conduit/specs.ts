// Port of conduit/config.py: one YAML file per integration. The three shipped
// connector files and the fourth one the demo adds are embedded verbatim and
// read by a small YAML subset parser (nested maps, scalars, flow lists,
// comments) into a validated ConnectorSpec with typed mapping rules.

export type ConnectorType = 'slack' | 'jira' | 'webhook';
export type FieldType = 'string' | 'integer' | 'number' | 'boolean' | 'list' | 'any';

export interface RetryPolicy {
  maxAttempts: number;
  baseSeconds: number;
  maxSeconds: number;
  multiplier: number;
  retryOnStatus: number[];
  timeoutSeconds: number;
}

export interface FieldRule {
  source: string | null;
  type: FieldType;
  required: boolean;
  enum: unknown[] | null;
  default: unknown;
  maxLength: number | null;
  truncate: boolean;
}

export interface ConnectorSpec {
  name: string;
  type: ConnectorType;
  target: string;
  baseUrl: string | null;
  secrets: Record<string, string>;
  mapping: Record<string, FieldRule>;
  retry: RetryPolicy;
  rateLimit: { requestsPerSecond: number; burst: number; maxRetryAfterSeconds: number };
  breaker: { failureThreshold: number; recoverySeconds: number };
  queue: { maxReceiveCount: number; visibilityTimeoutSeconds: number };
}

export const CONNECTOR_YAML: Record<string, string> = {
  'jira-support': `# Create or update an issue in the SUP project for every task revision.
type: jira
target: SUP
base_url: \${JIRA_BASE_URL:-https://example.atlassian.net}
secrets:
  email: JIRA_EMAIL
  api_token: JIRA_API_TOKEN
mapping:
  summary:
    source: title
    type: string
    required: true
    max_length: 255                # Jira's summary limit; longer titles are cut
  description: body
  issuetype:
    default: Task                  # constant: no source, only a default
  customfield_10042:
    source: id                     # external task id field
    required: true
retry:
  max_attempts: 4
  base_seconds: 0.25
  max_seconds: 8
rate_limit:
  requests_per_second: 10          # Jira Cloud's per-app budget
  burst: 5
  max_retry_after_seconds: 120     # honour Retry-After up to two minutes
breaker:
  failure_threshold: 5             # consecutive 5xx or timeouts, not 429
  recovery_seconds: 30
queue:
  max_receive_count: 3
  visibility_timeout_seconds: 45
idempotency_ttl_seconds: 1209600
`,
  'slack-ops': `# Post every task to the #ops channel as a Block Kit message.
type: slack
target: "#ops"
base_url: \${SLACK_BASE_URL:-https://slack.com}   # the demo points this at a fake
secrets:
  token: SLACK_BOT_TOKEN
mapping:
  title:
    source: "[$priority] $title"
    max_length: 150                # Slack header block limit
  body: body
retry:
  max_attempts: 5
  base_seconds: 0.2
  max_seconds: 5
rate_limit:
  requests_per_second: 20
  burst: 5
breaker:
  failure_threshold: 5
  recovery_seconds: 20
queue:
  max_receive_count: 3
  visibility_timeout_seconds: 30
`,
  'webhook-crm': `# Signed JSON POST to the CRM ingest endpoint.
type: webhook
target: \${CRM_WEBHOOK_URL:-https://crm.example.com/hooks/conduit}
secrets:
  signing_secret: CRM_WEBHOOK_SECRET
mapping:
  external_id:
    source: id
    required: true
  revision:
    source: version
    type: integer
  name:
    source: title
    required: true
    max_length: 200
    truncate: false                # the CRM rejects long names, so do we, up front
  notes: body
  state:
    source: status
    enum: [open, in_progress, blocked, done, closed]
  owner:
    source: assignee
    default: unassigned
retry:
  max_attempts: 3
  base_seconds: 0.1
  max_seconds: 2
rate_limit:
  requests_per_second: 50
  burst: 10
breaker:
  failure_threshold: 3             # the CRM is the flakiest target, pause sooner
  recovery_seconds: 15
queue:
  max_receive_count: 2
  visibility_timeout_seconds: 20
`,
};

export const NEW_CONNECTOR_NAME = 'pager-oncall';
export const NEW_CONNECTOR_YAML = `type: slack
target: "#oncall"
secrets:
  token: PAGER_SLACK_TOKEN
retry:
  max_attempts: 6
queue:
  max_receive_count: 4
`;

type Yaml = string | number | boolean | null | Yaml[] | { [k: string]: Yaml };
type YamlMap = { [k: string]: Yaml };

export class ConfigError extends Error {}

function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function scalar(s: string): Yaml {
  if (s.startsWith('[') && s.endsWith(']')) return s.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean).map(scalar);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if (s === 'true' || s === 'false') return s === 'true';
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

export function parseYaml(text: string): YamlMap {
  const root: YamlMap = {};
  const stack: { indent: number; map: YamlMap }[] = [{ indent: -1, map: root }];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = stripComment(raw);
    if (!line.trim()) return;
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    const colon = body.indexOf(':');
    if (colon <= 0) throw new ConfigError(`line ${i + 1}: expected "key: value"`);
    const key = body.slice(0, colon).trim();
    const rest = body.slice(colon + 1).trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].map;
    if (rest === '') {
      const child: YamlMap = {};
      parent[key] = child;
      stack.push({ indent, map: child });
    } else {
      parent[key] = scalar(rest);
    }
  });
  return root;
}

// ${VAR:-default}: the browser has no environment, so defaults apply.
function interpolate(v: Yaml): Yaml {
  if (typeof v === 'string') {
    return v.replace(/\$\{([A-Z][A-Z0-9_]*)(?::-([^}]*))?\}/g, (_m, name: string, def?: string) => {
      if (def === undefined) throw new ConfigError(`environment variable ${name} is referenced but not set`);
      return def;
    });
  }
  if (Array.isArray(v)) return v.map(interpolate);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, interpolate(x)]));
  return v;
}

const asMap = (v: Yaml | undefined): YamlMap => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function num(map: YamlMap, key: string, fallback: number, lo: number): number {
  const v = map[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || v < lo) throw new ConfigError(`${key} must be a number >= ${lo}`);
  return v;
}

function rule(remote: string, raw: Yaml): FieldRule {
  const m = typeof raw === 'string' ? { source: raw } : asMap(raw);
  const r: FieldRule = {
    source: m.source === undefined || m.source === null ? null : String(m.source),
    type: (m.type as FieldType) ?? 'any',
    required: m.required === true,
    enum: Array.isArray(m.enum) ? m.enum : null,
    default: m.default ?? null,
    maxLength: typeof m.max_length === 'number' ? m.max_length : null,
    truncate: m.truncate !== false,
  };
  if (r.source === null && r.default === null) throw new ConfigError(`mapping.${remote}: a mapping rule needs a source or a default`);
  return r;
}

const REQUIRED_SECRETS: Record<ConnectorType, string[]> = { slack: ['token'], jira: ['email', 'api_token'], webhook: ['signing_secret'] };

export function loadSpec(name: string, text: string): ConnectorSpec {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) throw new ConfigError(`connector name ${name} must match ^[a-z0-9][a-z0-9-]{0,62}$`);
  const raw = interpolate(parseYaml(text)) as YamlMap;
  const type = raw.type;
  if (type !== 'slack' && type !== 'jira' && type !== 'webhook') throw new ConfigError('type must be one of slack, jira, webhook');
  if (typeof raw.target !== 'string' || !raw.target) throw new ConfigError('target is required');
  const secrets = Object.fromEntries(Object.entries(asMap(raw.secrets)).map(([k, v]) => [k, String(v)]));
  const missing = REQUIRED_SECRETS[type].filter((s) => !(s in secrets));
  if (missing.length) throw new ConfigError(`${type} connector requires secrets: ${missing.join(', ')}`);
  const retry = asMap(raw.retry);
  const rate = asMap(raw.rate_limit);
  const breaker = asMap(raw.breaker);
  const queue = asMap(raw.queue);
  const spec: ConnectorSpec = {
    name,
    type,
    target: raw.target,
    baseUrl: typeof raw.base_url === 'string' ? raw.base_url : null,
    secrets,
    mapping: Object.fromEntries(Object.entries(asMap(raw.mapping)).map(([k, v]) => [k, rule(k, v)])),
    retry: {
      maxAttempts: num(retry, 'max_attempts', 5, 1),
      baseSeconds: num(retry, 'base_seconds', 0.5, 0),
      maxSeconds: num(retry, 'max_seconds', 30, 0),
      multiplier: num(retry, 'multiplier', 2, 1),
      retryOnStatus: [408, 425, 429, 500, 502, 503, 504],
      timeoutSeconds: num(retry, 'timeout_seconds', 10, 0),
    },
    rateLimit: {
      requestsPerSecond: num(rate, 'requests_per_second', 10, 0),
      burst: num(rate, 'burst', 1, 1),
      maxRetryAfterSeconds: num(rate, 'max_retry_after_seconds', 60, 0),
    },
    breaker: { failureThreshold: num(breaker, 'failure_threshold', 5, 1), recoverySeconds: num(breaker, 'recovery_seconds', 30, 0) },
    queue: { maxReceiveCount: num(queue, 'max_receive_count', 3, 1), visibilityTimeoutSeconds: num(queue, 'visibility_timeout_seconds', 60, 1) },
  };
  if (spec.type === 'jira' && !spec.baseUrl) throw new ConfigError('jira connector requires base_url');
  if (spec.retry.maxSeconds < spec.retry.baseSeconds) throw new ConfigError('max_seconds must be >= base_seconds');
  return spec;
}

export const queueName = (name: string) => `conduit-${name}`;
export const dlqName = (name: string) => `conduit-${name}-dlq`;
export const quarantineName = (name: string) => `conduit-${name}-quarantine`;
