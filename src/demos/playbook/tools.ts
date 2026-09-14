// Port of the offline tool side: the keyword knowledge base and in-memory
// stand-ins for Jira and Slack with inspectable inboxes. Every result is a
// plain JSON object, so the trace records exactly what the grader scores.
import type { JsonObject, KbArticle } from './types';

export const API_TO_DOTTED: Record<string, string> = {
  kb_search: 'kb.search',
  jira_create_issue: 'jira.create_issue',
  jira_transition: 'jira.transition',
  jira_comment: 'jira.comment',
  slack_post: 'slack.post',
  slack_lookup_channel: 'slack.lookup_channel',
};

export class KnowledgeBase {
  readonly articles: KbArticle[];

  constructor(articles: KbArticle[]) {
    this.articles = articles;
  }

  // An article matches when at least two of its keywords appear in the query.
  search(query: string): (KbArticle & { score: number })[] {
    const words = new Set(query.toLowerCase().match(/[a-z0-9-]+/g) ?? []);
    const hits: (KbArticle & { score: number })[] = [];
    for (const art of this.articles) {
      const score = art.keywords.filter((k) => words.has(k)).length;
      if (score >= 2) hits.push({ ...art, score });
    }
    return hits.sort((a, b) => b.score - a.score);
  }
}

interface JiraIssue {
  id: string;
  key: string;
  status: string;
  comments: string[];
}

export class FakeJira {
  readonly issues = new Map<string, JiraIssue>();
  private counters = new Map<string, number>();

  reset(): void {
    this.issues.clear();
    this.counters.clear();
  }

  create(project: string, summary: string): { id: string; key: string } {
    if (!project || !summary) throw new Error('ValueError: fields.project.key and fields.summary are required');
    const n = (this.counters.get(project) ?? 100) + 1;
    this.counters.set(project, n);
    const key = `${project}-${n}`;
    const id = String(10000 + this.issues.size);
    this.issues.set(key, { id, key, status: 'Open', comments: [] });
    return { id, key };
  }

  transition(key: string, status: string): void {
    const issue = this.issues.get(key);
    if (!issue) throw new Error(`KeyError: ${key}`);
    if (!status) throw new Error('ValueError: transition.name required');
    issue.status = status;
  }

  comment(key: string, body: string): { id: string } {
    const issue = this.issues.get(key);
    if (!issue) throw new Error(`KeyError: ${key}`);
    if (!body) throw new Error('ValueError: body required');
    issue.comments.push(body);
    return { id: String(issue.comments.length) };
  }
}

const DEFAULT_CHANNELS: [string, string][] = [
  ['support-escalations', 'Escalated support cases'],
  ['oncall-sev1', 'Pages the sev1 on-call engineer'],
  ['incidents', 'Incident announcements'],
  ['status-updates', 'Customer-facing status'],
  ['ic-oncall', 'Incident commander pages'],
  ['team-payments', 'Owns payments-api and billing'],
  ['team-identity', 'Owns auth-service and sso'],
  ['team-data', 'Owns export-service and analytics'],
  ['general', 'Company wide'],
];

export class FakeSlack {
  readonly channels = DEFAULT_CHANNELS.map(([name, topic]) => ({ name, topic }));
  messages: { channel: string; text: string; ts: string }[] = [];

  reset(): void {
    this.messages = [];
  }

  postMessage(channelRaw: string, text: string): { ok: true; ts: string } | { ok: false; error: string } {
    const channel = String(channelRaw ?? '').replace(/^#+/, '');
    if (!channel || !text) return { ok: false, error: 'invalid_arguments' };
    if (!this.channels.some((c) => c.name === channel)) return { ok: false, error: 'channel_not_found' };
    const ts = `${1700000000 + this.messages.length}.000100`;
    this.messages.push({ channel: `#${channel}`, text, ts });
    return { ok: true, ts };
  }
}

export class ToolExecutor {
  readonly kb: KnowledgeBase;
  readonly jira: FakeJira;
  readonly slack: FakeSlack;

  constructor(kb: KnowledgeBase, jira: FakeJira, slack: FakeSlack) {
    this.kb = kb;
    this.jira = jira;
    this.slack = slack;
  }

  execute(name: string, args: JsonObject): JsonObject {
    const str = (k: string): string => (args[k] === undefined || args[k] === null ? '' : String(args[k]));
    switch (name) {
      case 'kb_search':
        return { matches: this.kb.search(str('query')) as unknown as JsonObject[] };
      case 'jira_create_issue': {
        const data = this.jira.create(str('project'), str('summary'));
        return { issue_key: data.key, id: data.id };
      }
      case 'jira_transition':
        this.jira.transition(str('issue_key'), str('status'));
        return { issue_key: str('issue_key'), status: str('status') };
      case 'jira_comment': {
        const data = this.jira.comment(str('issue_key'), str('body'));
        return { issue_key: str('issue_key'), comment_id: data.id };
      }
      case 'slack_post': {
        const data = this.slack.postMessage(str('channel'), str('text'));
        if (!data.ok) throw new Error(`RuntimeError: slack error: ${data.error}`);
        return { channel: str('channel'), ts: data.ts };
      }
      case 'slack_lookup_channel': {
        const wanted = str('service').toLowerCase();
        for (const ch of this.slack.channels) {
          if (wanted && (ch.name.toLowerCase().includes(wanted) || ch.topic.toLowerCase().includes(wanted))) {
            return { channel: `#${ch.name}`, found: true };
          }
        }
        return { channel: null, found: false };
      }
      default:
        throw new Error(`ValueError: unknown tool ${name}`);
    }
  }
}
