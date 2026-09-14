// Deterministic note parser and rule-based compiler (ports of
// expertloop/compiler/parser.py and compile.py). Headings name a section,
// numbered or bulleted items fold indented continuation lines, inline
// references are URLs, doc:<id> ids and ticket keys, and every compiled step
// carries at least one citation: the line range of the note item it came from
// plus any source reference found on it.

export type SourceKind = 'url' | 'doc' | 'ticket';

export interface SourceRef {
  kind: SourceKind;
  ref: string;
}

export type Section = 'preconditions' | 'steps' | 'decision_rules' | 'tools' | 'outcomes' | 'forbidden';

export interface NoteItem {
  text: string;
  line_start: number;
  line_end: number;
  section: Section;
  sources: SourceRef[];
}

export interface ParsedNote {
  title: string | null;
  items: NoteItem[];
  sources: SourceRef[];
  line_count: number;
}

const SECTION_ALIASES: Record<Section, string[]> = {
  preconditions: ['precondition', 'prerequisite', 'before you start', 'before starting'],
  steps: ['step', 'procedure', 'process', 'checklist', 'how to', 'workflow'],
  decision_rules: ['decision', 'rule', 'escalat', 'when to', 'thresholds'],
  tools: ['tool', 'system', 'systems to use'],
  outcomes: ['outcome', 'expected result', 'done when', 'definition of done', 'result'],
  forbidden: ['never', 'do not', "don't", 'forbidden', 'must not', 'prohibited'],
};

const ITEM_RE = /^(\s*)(?:(\d+)[.)]|[-*+])\s+(.*)$/;
const HEADING_RE = /^\s*#{1,6}\s*(.+?)\s*#*\s*$/;
const URL_RE = /https?:\/\/[^\s)\]>"']+/g;
const DOC_RE = /\bdoc:([A-Za-z0-9_./-]+)/g;
const TICKET_RE = /\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/g;

function sectionItems(note: ParsedNote, name: Section): NoteItem[] {
  return note.items.filter((item) => item.section === name);
}

function classifyHeading(text: string): Section {
  const lowered = text.toLowerCase();
  for (const section of Object.keys(SECTION_ALIASES) as Section[]) {
    if (SECTION_ALIASES[section].some((needle) => lowered.includes(needle))) return section;
  }
  return 'steps';
}

function stripTrailing(value: string, chars: string): string {
  let end = value.length;
  while (end > 0 && chars.includes(value[end - 1])) end--;
  return value.slice(0, end);
}

export function extractSources(text: string): SourceRef[] {
  const refs: SourceRef[] = [];
  const seen = new Set<string>();
  const add = (kind: SourceKind, ref: string) => {
    const key = `${kind}:${ref}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ kind, ref });
    }
  };
  for (const match of text.matchAll(URL_RE)) add('url', stripTrailing(match[0], '.,;'));
  let scrubbed = text.replace(URL_RE, ' ');
  for (const match of scrubbed.matchAll(DOC_RE)) add('doc', stripTrailing(match[1], '.,;:'));
  scrubbed = scrubbed.replace(DOC_RE, ' ');
  for (const match of scrubbed.matchAll(TICKET_RE)) add('ticket', match[1]);
  return refs;
}

function expandTabs(value: string, width = 4): string {
  let out = '';
  for (const ch of value) out += ch === '\t' ? ' '.repeat(width - (out.length % width)) : ch;
  return out;
}

export function parseNote(body: string): ParsedNote {
  const lines = body.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '' && body.endsWith('\n')) lines.pop();
  let title: string | null = null;
  const items: NoteItem[] = [];
  let currentSection: Section = 'steps';
  let openItem: NoteItem | null = null;
  let openIndent = 0;

  const close = () => {
    if (openItem !== null) {
      openItem.text = openItem.text.trim();
      openItem.sources = extractSources(openItem.text);
      items.push(openItem);
      openItem = null;
    }
  };

  lines.forEach((raw, index) => {
    const number = index + 1;
    const heading = HEADING_RE.exec(raw);
    if (heading) {
      close();
      if (title === null && raw.trimStart().startsWith('# ')) {
        title = heading[1];
        return;
      }
      currentSection = classifyHeading(heading[1]);
      return;
    }
    const item = ITEM_RE.exec(raw);
    if (item) {
      const indent = expandTabs(item[1]).length;
      if (openItem !== null && indent > openIndent) {
        openItem.text += '\n' + item[3].trim();
        openItem.line_end = number;
        return;
      }
      close();
      openItem = { text: item[3], line_start: number, line_end: number, section: currentSection, sources: [] };
      openIndent = indent;
      return;
    }
    if (raw.trim() === '') {
      close();
      return;
    }
    if (openItem !== null) {
      openItem.text += '\n' + raw.trim();
      openItem.line_end = number;
      return;
    }
    openItem = { text: raw.trim(), line_start: number, line_end: number, section: currentSection, sources: [] };
    openIndent = 0;
  });
  close();

  const sources: SourceRef[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    for (const ref of item.sources) {
      const key = `${ref.kind}:${ref.ref}`;
      if (!seen.has(key)) {
        seen.add(key);
        sources.push(ref);
      }
    }
  }
  return { title, items, sources, line_count: lines.length };
}

export interface Citation {
  note_id: number | null;
  line_start: number;
  line_end: number;
  source_kind?: string;
  source_ref?: string;
  source_id?: number;
  source_hash?: string;
}

export interface DecisionRule {
  condition: string;
  then: string;
  halts: boolean;
  citations?: Citation[];
}

export interface Step {
  id: string;
  order: number;
  action: string;
  condition: string | null;
  halts: boolean;
  tool: string | null;
  decision_rules: DecisionRule[];
  forbidden: string[];
  expected_outcome: string | null;
  citations: Citation[];
}

export interface CitedText {
  text: string;
  citations: Citation[];
}

export interface InstructionDocument {
  name: string;
  title: string;
  preconditions: CitedText[];
  steps: Step[];
  decision_rules: DecisionRule[];
  tools: string[];
  outcomes: CitedText[];
  forbidden_actions: CitedText[];
  sources: SourceRef[];
  agent_prompt: string;
}

const TOOL_RE = /\b(?:in|via|using|through|open|call|from)\s+([A-Z][A-Za-z0-9]+(?:\s[A-Z][A-Za-z0-9]+)?)/;
const RULE_RE = /^\s*(?:if|when)\s+(.+?)\s*(?:,|then)\s*(.+)$/i;
const FORBIDDEN_RE = /\b(?:never|do not|don't|must not)\s+(.+)/i;
const OUTCOME_RE = /\b(?:so that|until|expected:|result:)\s*(.+)$/i;
export const STOP_WORDS = ['stop', 'halt', 'escalate', 'do not proceed', 'hand off', 'hand it off', 'pause'];

function rstripDot(value: string): string {
  return value.replace(/\.+$/, '');
}

function hasStopWord(text: string): boolean {
  const lowered = text.toLowerCase();
  return STOP_WORDS.some((word) => lowered.includes(word));
}

function citation(item: NoteItem, noteId: number | null, ref?: SourceRef): Citation {
  const cite: Citation = { note_id: noteId, line_start: item.line_start, line_end: item.line_end };
  if (ref) {
    cite.source_kind = ref.kind;
    cite.source_ref = ref.ref;
  }
  return cite;
}

function citations(item: NoteItem, noteId: number | null): Citation[] {
  return [citation(item, noteId), ...item.sources.map((ref) => citation(item, noteId, ref))];
}

function firstLine(text: string): string {
  return text.split('\n', 1)[0].trim();
}

function detectTool(text: string, knownTools: string[]): string | null {
  const lowered = text.toLowerCase();
  for (const tool of knownTools) if (lowered.includes(tool.toLowerCase())) return tool;
  const match = TOOL_RE.exec(text);
  return match ? match[1] : null;
}

/**
 * Separate a step into action, gating condition, decision rules, forbidden clauses and outcome.
 * A first line of the form "if X, Y" makes the step conditional; later "if" lines are rules.
 */
function splitRules(text: string): { action: string; condition: string | null; rules: DecisionRule[]; forbidden: string[]; outcome: string | null } {
  const actionLines: string[] = [];
  let condition: string | null = null;
  const rules: DecisionRule[] = [];
  const forbidden: string[] = [];
  let outcome: string | null = null;
  text.split('\n').forEach((rawLine, index) => {
    let line = rawLine;
    const rule = RULE_RE.exec(line);
    if (rule && index === 0) {
      condition = rule[1].trim();
      line = rule[2].trim();
    } else if (rule) {
      const then = rstripDot(rule[2].trim());
      rules.push({ condition: rule[1].trim(), then, halts: hasStopWord(then) });
      return;
    }
    const banned = FORBIDDEN_RE.exec(line);
    if (banned) {
      forbidden.push(rstripDot(banned[1].trim()));
      return;
    }
    const result = OUTCOME_RE.exec(line);
    if (result && outcome === null) {
      const captured = result[1].trim();
      const split = captured.indexOf('. ');
      let rest = '';
      if (split >= 0) {
        outcome = captured.slice(0, split);
        rest = captured.slice(split + 2);
      } else {
        outcome = captured;
      }
      outcome = rstripDot(outcome);
      line = line.slice(0, result.index).trim().replace(/,+$/, '');
      if (line) actionLines.push(line);
      if (rest) actionLines.push(rest.trim());
      return;
    }
    actionLines.push(line.trim());
  });
  return { action: actionLines.filter(Boolean).join(' ').trim(), condition, rules, forbidden, outcome };
}

export function compileNote(body: string, noteId: number | null = null, name?: string): InstructionDocument {
  const parsed = parseNote(body);
  const docName = name ?? parsed.title ?? 'untitled';
  const tools = sectionItems(parsed, 'tools').map((item) => rstripDot(firstLine(item.text)));
  const steps: Step[] = [];
  const globalRules: DecisionRule[] = [];
  const forbiddenActions: CitedText[] = [];
  const cited = (item: NoteItem) => ({ text: rstripDot(firstLine(item.text)), citations: citations(item, noteId) });

  for (const item of sectionItems(parsed, 'decision_rules')) {
    const rule = RULE_RE.exec(firstLine(item.text));
    if (rule) {
      const then = rstripDot(rule[2].trim());
      globalRules.push({ condition: rule[1].trim(), then, halts: hasStopWord(then), citations: citations(item, noteId) });
    } else {
      globalRules.push({ condition: rstripDot(firstLine(item.text)), then: 'apply rule', halts: false, citations: citations(item, noteId) });
    }
  }

  for (const item of sectionItems(parsed, 'forbidden')) {
    const banned = FORBIDDEN_RE.exec(item.text);
    const text = banned ? banned[1] : firstLine(item.text);
    forbiddenActions.push({ text: rstripDot(text.trim()), citations: citations(item, noteId) });
  }

  sectionItems(parsed, 'steps').forEach((item, i) => {
    const index = i + 1;
    const { condition, rules, forbidden, outcome, action: split } = splitRules(item.text);
    const action = split || firstLine(item.text);
    steps.push({
      id: `s${index}`,
      order: index,
      action: rstripDot(action),
      condition,
      halts: hasStopWord(action),
      tool: detectTool(item.text, tools),
      decision_rules: rules,
      forbidden,
      expected_outcome: outcome,
      citations: citations(item, noteId),
    });
    for (const text of forbidden) forbiddenActions.push({ text, citations: citations(item, noteId) });
  });

  const document: InstructionDocument = {
    name: docName,
    title: parsed.title ?? docName,
    preconditions: sectionItems(parsed, 'preconditions').map(cited),
    steps,
    decision_rules: globalRules,
    tools,
    outcomes: sectionItems(parsed, 'outcomes').map(cited),
    forbidden_actions: forbiddenActions,
    sources: parsed.sources.map((ref) => ({ kind: ref.kind, ref: ref.ref })),
    agent_prompt: '',
  };
  document.agent_prompt = renderPrompt(document);
  return document;
}

/** The text an agent receives. */
export function renderPrompt(document: InstructionDocument): string {
  const lines: string[] = [`# ${document.title}`, ''];
  if (document.preconditions.length) {
    lines.push('Before starting, confirm:');
    for (const p of document.preconditions) lines.push(`- ${p.text}`);
    lines.push('');
  }
  lines.push('Follow these steps in order:');
  for (const step of document.steps) {
    const tool = step.tool ? ` (tool: ${step.tool})` : '';
    const gate = step.condition ? `Only if ${step.condition}: ` : '';
    lines.push(`${step.order}. ${gate}${step.action}${tool}`);
    for (const rule of step.decision_rules) lines.push(`   - if ${rule.condition}: ${rule.then}`);
    if (step.expected_outcome) lines.push(`   - expected: ${step.expected_outcome}`);
  }
  if (document.decision_rules.length) {
    lines.push('', 'Decision rules:');
    for (const r of document.decision_rules) lines.push(`- if ${r.condition}: ${r.then}`);
  }
  if (document.forbidden_actions.length) {
    lines.push('', 'Never:');
    for (const f of document.forbidden_actions) lines.push(`- ${f.text}`);
  }
  if (document.outcomes.length) {
    lines.push('', 'Done when:');
    for (const o of document.outcomes) lines.push(`- ${o.text}`);
  }
  return lines.join('\n');
}

export interface Coverage {
  steps: number;
  cited_steps: number;
  citations: number;
  coverage: number;
}

export function citationCoverage(document: InstructionDocument): Coverage {
  const cited = document.steps.filter((s) => s.citations.length > 0);
  const total = document.steps.length;
  return {
    steps: total,
    cited_steps: cited.length,
    citations: document.steps.reduce((sum, s) => sum + s.citations.length, 0),
    coverage: total ? cited.length / total : 1,
  };
}

/** A list of problems; empty means the document is acceptable. */
export function validateDocument(document: InstructionDocument): string[] {
  const problems: string[] = [];
  for (const step of document.steps) {
    if (!step.id) problems.push('step without id');
    if (!step.action) problems.push(`step ${step.id} has no action`);
    if (step.citations.length === 0) problems.push(`step ${step.id} has no citations`);
  }
  const ids = document.steps.map((s) => s.id);
  if (ids.length !== new Set(ids).size) problems.push('duplicate step ids');
  return problems;
}
