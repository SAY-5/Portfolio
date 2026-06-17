// Small presentation helpers shared by the GovGate views. These are pure label
// and grouping helpers with no state of their own.

import type {
  CategoryBreakdown,
  Control,
  ControlStatus,
  RemediationItem,
  Score,
  Severity,
} from './types';

// Human label for a status, used in selectors and summaries.
export const STATUS_LABEL: Record<ControlStatus, string> = {
  met: 'Met',
  partial: 'Partial',
  'not-met': 'Not met',
  'n-a': 'N/A',
};

// The order statuses appear in the selector.
export const STATUS_ORDER: ControlStatus[] = ['met', 'partial', 'not-met', 'n-a'];

// Human label for a severity.
export const SEVERITY_LABEL: Record<Severity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

// Group controls by category, preserving first-seen order, for the grouped list.
export function groupByCategory(controls: Control[]): {
  category: string;
  controls: Control[];
}[] {
  const order: string[] = [];
  const map = new Map<string, Control[]>();
  for (const control of controls) {
    if (!map.has(control.category)) {
      order.push(control.category);
      map.set(control.category, []);
    }
    map.get(control.category)!.push(control);
  }
  return order.map((category) => ({
    category,
    controls: map.get(category)!,
  }));
}

// Render a plain-text compliance summary suitable for copying into a ticket or
// report. Pure: it takes the already-computed engine output and lays it out.
export function exportSummary(
  frameworkName: string,
  score: Score,
  categories: CategoryBreakdown[],
  remediation: RemediationItem[],
): string {
  const lines: string[] = [];
  lines.push(`Compliance summary: ${frameworkName}`);
  lines.push('');
  lines.push(
    `Overall: ${score.percent}% weighted compliance (${score.passed ? 'PASS' : 'FAIL'} at ${score.threshold}% threshold)`,
  );
  lines.push('');
  lines.push('By category:');
  for (const cat of categories) {
    lines.push(`  ${cat.category}: ${cat.percent}%`);
  }
  lines.push('');
  if (remediation.length === 0) {
    lines.push('Remediation: none, every applicable control is met.');
  } else {
    lines.push(`Remediation (${remediation.length}, highest priority first):`);
    remediation.forEach((item, i) => {
      lines.push(
        `  ${i + 1}. [${SEVERITY_LABEL[item.control.severity]}, w${item.control.weight}] ${item.control.title} (${STATUS_LABEL[item.status]})`,
      );
      if (item.note.trim()) lines.push(`     note: ${item.note.trim()}`);
    });
  }
  return lines.join('\n');
}
