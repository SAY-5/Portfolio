// Deterministic note parser and rule-based compiler (ports of
// expertloop/compiler/parser.py and compile.py at 5.1.0, with the citation
// checks of expertloop/document.py). Headings name a section, numbered or
// bulleted items fold indented continuation lines, inline references are
// URLs, doc:<id> ids and ticket keys, and every compiled step carries at
// least one citation: the line range of the note item it came from plus any
// source reference found on it. A stop word inside a negation is not a halt,
// and "do not proceed until X" is a guard on the step, not a forbidden action.

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

/** Lines of a note the way Python's str.splitlines() counts them. */
export function noteLines(body: string): string[] {
  const lines = body.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '' && body.endsWith('\n')) lines.pop();
  return lines;
}

export function parseNote(body: string): ParsedNote {
  const lines = noteLines(body);
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

/** Where a step came from: a line range in the note, a registered source, or both. */
export interface Citation {
  note_id?: number | null;
  line_start?: number | null;
  line_end?: number | null;
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
// "do not proceed until the scan lands" gates the step on an outcome; experts write it as a
// negation, but it is not a forbidden action and it does not stop the run
const NOT_PROCEED_SOURCE = String.raw`\b(?:do not|don't|does not|must not)\s+proceed\s+(?:until|before)\s+([^.;]+)`;
const NOT_PROCEED_RE = new RegExp(NOT_PROCEED_SOURCE, 'i');
const NOT_PROCEED_ALL_RE = new RegExp(NOT_PROCEED_SOURCE, 'gi');
const NEGATED_RE = /\b(?:do not|don't|does not|must not|never|without)\s+$/i;
const TRAILING_CONJUNCTION_RE = /\s+(?:and|but|then)$/i;

function rstripDot(value: string): string {
  return value.replace(/\.+$/, '');
}

/**
 * True when the text tells the agent to stop. A stop word inside a negation ("do not
 * escalate") is an instruction not to stop, and a guard ("do not proceed until X") is a
 * condition on the step, so neither counts. Mirrors halts_from in compiler/compile.py.
 */
export function haltsFrom(text: string): boolean {
  const lowered = text.toLowerCase().replace(NOT_PROCEED_ALL_RE, ' ');
  for (const word of STOP_WORDS) {
    let start = 0;
    for (;;) {
      const found = lowered.indexOf(word, start);
      if (found === -1) break;
      if (!NEGATED_RE.test(lowered.slice(0, found))) return true;
      start = found + word.length;
    }
  }
  return false;
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

interface SplitResult {
  action: string;
  condition: string | null;
  rules: DecisionRule[];
  forbidden: string[];
  outcome: string | null;
}

/**
 * Separate a step into action, gating condition, decision rules, forbidden clauses and outcome.
 * A first line of the form "if X, Y" makes the step conditional; later "if" lines are rules
 * evaluated before the action; "do not proceed until X" becomes the expected outcome.
 */
function splitRules(text: string): SplitResult {
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
      rules.push({ condition: rule[1].trim(), then, halts: haltsFrom(then) });
      return;
    }
    const guard = NOT_PROCEED_RE.exec(line);
    if (guard) {
      if (outcome === null) outcome = rstripDot(guard[1].trim());
      const head = line
        .slice(0, guard.index)
        .trim()
        .replace(/,+$/, '')
        .replace(TRAILING_CONJUNCTION_RE, '')
        .trim();
      if (head) actionLines.push(head);
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

export function compileParsed(parsed: ParsedNote, noteId: number | null, name: string): InstructionDocument {
  const tools = sectionItems(parsed, 'tools').map((item) => rstripDot(firstLine(item.text)));
  const steps: Step[] = [];
  const globalRules: DecisionRule[] = [];
  const forbiddenActions: CitedText[] = [];
  const cited = (item: NoteItem) => ({ text: rstripDot(firstLine(item.text)), citations: citations(item, noteId) });

  for (const item of sectionItems(parsed, 'decision_rules')) {
    const rule = RULE_RE.exec(firstLine(item.text));
    if (rule) {
      const then = rstripDot(rule[2].trim());
      globalRules.push({ condition: rule[1].trim(), then, halts: haltsFrom(then), citations: citations(item, noteId) });
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
      halts: haltsFrom(action),
      tool: detectTool(item.text, tools),
      decision_rules: rules,
      forbidden,
      expected_outcome: outcome,
      citations: citations(item, noteId),
    });
    for (const text of forbidden) forbiddenActions.push({ text, citations: citations(item, noteId) });
  });

  const document: InstructionDocument = {
    name,
    title: parsed.title ?? name,
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

export function compileNote(body: string, noteId: number | null = null, name?: string): InstructionDocument {
  const parsed = parseNote(body);
  return compileParsed(parsed, noteId, name ?? parsed.title ?? 'untitled');
}

/** The text an agent receives; every section is read with a default. */
export function renderPrompt(document: InstructionDocument): string {
  const lines: string[] = [`# ${document.title ?? ''}`, ''];
  const preconditions = document.preconditions ?? [];
  if (preconditions.length) {
    lines.push('Before starting, confirm:');
    for (const p of preconditions) lines.push(`- ${p.text ?? ''}`);
    lines.push('');
  }
  lines.push('Follow these steps in order:');
  for (const step of document.steps ?? []) {
    const tool = step.tool ? ` (tool: ${step.tool})` : '';
    const gate = step.condition ? `Only if ${step.condition}: ` : '';
    lines.push(`${step.order ?? 0}. ${gate}${step.action ?? ''}${tool}`);
    for (const rule of step.decision_rules ?? []) lines.push(`   - if ${rule.condition ?? ''}: ${rule.then ?? ''}`);
    if (step.expected_outcome) lines.push(`   - expected: ${step.expected_outcome}`);
  }
  const globalRules = document.decision_rules ?? [];
  if (globalRules.length) {
    lines.push('', 'Decision rules:');
    for (const r of globalRules) lines.push(`- if ${r.condition ?? ''}: ${r.then ?? ''}`);
  }
  const forbidden = document.forbidden_actions ?? [];
  if (forbidden.length) {
    lines.push('', 'Never:');
    for (const f of forbidden) lines.push(`- ${f.text ?? ''}`);
  }
  const outcomes = document.outcomes ?? [];
  if (outcomes.length) {
    lines.push('', 'Done when:');
    for (const o of outcomes) lines.push(`- ${o.text ?? ''}`);
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
  const steps = document.steps ?? [];
  const cited = steps.filter((s) => s.citations && s.citations.length > 0);
  const total = steps.length;
  return {
    steps: total,
    cited_steps: cited.length,
    citations: steps.reduce((sum, s) => sum + (s.citations ?? []).length, 0),
    coverage: total ? cited.length / total : 1,
  };
}

/** The note a document was compiled from, used to check line-range citations. */
export interface NoteContext {
  note_id: number;
  line_count: number;
}

export function noteContext(noteId: number, body: string): NoteContext {
  return { note_id: noteId, line_count: noteLines(body).length };
}

const SOURCE_KINDS: readonly string[] = ['url', 'doc', 'ticket'];

function isSet(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/** Port of expertloop/document.py _citation_problems. */
function citationProblems(stepId: string, index: number, cite: Citation, note: NoteContext | undefined): string[] {
  const label = `step ${stepId} citation ${index}`;
  const hasLines = isSet(cite.line_start) && isSet(cite.line_end);
  const hasSource = isSet(cite.source_kind) && isSet(cite.source_ref);
  if (!hasLines && !hasSource) return [`${label} has neither a note line range nor a source reference`];
  const problems: string[] = [];
  if (isSet(cite.source_ref) && !isSet(cite.source_kind)) problems.push(`${label} has a source reference without a source kind`);
  if (isSet(cite.source_kind) && !isSet(cite.source_ref)) problems.push(`${label} has a source kind without a source reference`);
  if (hasLines) {
    const start = cite.line_start as number;
    const end = cite.line_end as number;
    if (start > end) {
      problems.push(`${label} cites note lines ${start}-${end}, which is not a range`);
    } else if (note && isSet(cite.note_id) && cite.note_id !== note.note_id) {
      problems.push(`${label} cites note ${cite.note_id}, but the set was compiled from note ${note.note_id}`);
    } else if (note && end > note.line_count) {
      problems.push(`${label} cites note lines ${start}-${end}, but note ${note.note_id} has ${note.line_count} lines`);
    }
  } else if (isSet(cite.line_start) || isSet(cite.line_end)) {
    problems.push(`${label} gives only one end of its note line range`);
  }
  return problems;
}

/**
 * A list of problems; empty means the document is acceptable (port of
 * expertloop/document.py document_problems). With the note the set was compiled
 * from, every line-range citation is checked against that note's id and length,
 * so a citation cannot point at a line the expert never wrote.
 */
export function validateDocument(document: Partial<InstructionDocument>, note?: NoteContext): string[] {
  const problems: string[] = [];
  for (const key of ['title', 'steps', 'preconditions', 'decision_rules', 'forbidden_actions'] as const) {
    if (!(key in document)) problems.push(`missing field: ${key}`);
  }
  const steps = document.steps ?? [];
  steps.forEach((step, i) => {
    (step.decision_rules ?? []).forEach((rule, j) => {
      if (!rule.condition) problems.push(`steps.${i}.decision_rules.${j}.condition: String should have at least 1 character`);
      if (!rule.then) problems.push(`steps.${i}.decision_rules.${j}.then: String should have at least 1 character`);
    });
    (step.citations ?? []).forEach((cite, j) => {
      if (isSet(cite.source_kind) && !SOURCE_KINDS.includes(String(cite.source_kind))) {
        problems.push(`steps.${i}.citations.${j}.source_kind: Input should be 'url', 'doc' or 'ticket'`);
      }
      if (isSet(cite.source_ref) && String(cite.source_ref).length === 0) {
        problems.push(`steps.${i}.citations.${j}.source_ref: String should have at least 1 character`);
      }
    });
  });
  if (problems.length) return problems;
  for (const step of steps) {
    if (!step.id) problems.push('step without id');
    if (!step.action) problems.push(`step ${step.id} has no action`);
    const cites = step.citations ?? [];
    if (cites.length === 0) problems.push(`step ${step.id} has no citations`);
    cites.forEach((cite, index) => problems.push(...citationProblems(step.id, index + 1, cite, note)));
  }
  const ids = steps.map((s) => s.id);
  if (ids.length !== new Set(ids).size) problems.push('duplicate step ids');
  return problems;
}
