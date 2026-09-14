// Port of playbook/agent/prompt.py: a versioned PromptSpec rendered from the
// Procedure, with each correction appended under the SOP step it belongs to.
import { citeStr, type Correction, type Procedure, type PromptSpec } from './types';

export function initialSpec(procedureSlug: string): PromptSpec {
  return { procedureSlug, version: 1, parentVersion: null, corrections: [], notes: 'initial prompt built from the ingested procedure' };
}

export function specLabel(spec: PromptSpec): string {
  return `v${spec.version}`;
}

// The next version keeps every existing correction and drops duplicates.
export function withCorrections(spec: PromptSpec, fresh: Correction[], notes: string): PromptSpec {
  const seen = new Set(spec.corrections.map((c) => `${c.stepId} ${c.text}`));
  const merged = [...spec.corrections];
  for (const c of fresh) {
    const key = `${c.stepId} ${c.text}`;
    if (!seen.has(key)) {
      merged.push({ ...c, version: spec.version + 1 });
      seen.add(key);
    }
  }
  return { procedureSlug: spec.procedureSlug, version: spec.version + 1, parentVersion: spec.version, corrections: merged, notes };
}

export function renderPrompt(spec: PromptSpec, proc: Procedure): string {
  const byStep = new Map<string, Correction[]>();
  for (const c of spec.corrections) byStep.set(c.stepId, [...(byStep.get(c.stepId) ?? []), c]);
  const out: string[] = [
    `You are an operations agent executing the procedure "${proc.name}" (prompt ${specLabel(spec)}).`,
    proc.purpose,
    'Work through the steps in order, calling one tool at a time and using only the tools ' +
      'provided. Read each tool result before the next call. When every step is done, reply ' +
      'with a one-line summary and stop.',
    '',
  ];
  if (proc.preconditions.length) {
    out.push('## Preconditions', ...proc.preconditions.map((r) => `- ${r.text}`), '');
  }
  out.push('## Steps');
  for (const step of proc.steps) {
    out.push(`### Step ${step.index}: ${step.title} [${step.id}]${step.tool ? ` (tool: ${step.tool})` : ''}`);
    if (step.instruction) out.push(step.instruction);
    for (const r of step.rules) out.push(`- ${r.text}`);
    const fixes = byStep.get(step.id) ?? [];
    if (fixes.length) out.push('Corrections:', ...fixes.map((c) => `- (v${c.version}) ${c.text}`));
    out.push('');
  }
  const decisions = proc.decisionPoints.filter((d) => d.kind === 'decision');
  if (decisions.length) {
    out.push('## Decision points (from the walkthrough)');
    for (const d of decisions) out.push(`- ${d.stepId ? `[${d.stepId}] ` : ''}${d.text} (${citeStr(d.citation)})`);
    out.push('');
  }
  if (proc.escalationRules.length) out.push('## Escalation', ...proc.escalationRules.map((r) => `- ${r.text}`), '');
  const forbidden = [...proc.forbidden.map((r) => r.text), ...proc.decisionPoints.filter((d) => d.kind === 'forbidden').map((d) => d.text)];
  if (forbidden.length) out.push('## Never', ...Array.from(new Set(forbidden)).map((t) => `- ${t}`), '');
  if (proc.checks.length) out.push('## Checks before finishing', ...proc.checks.map((r) => `- ${r.text}`), '');
  return out.join('\n').replace(/\s+$/, '') + '\n';
}
