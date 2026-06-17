// Presentation helpers shared by the detail view: the ordered status pipeline
// for the state diagram and human labels for actions and events. Keeping these
// out of the component keeps the JSX declarative.

import type { Action, IntentStatus } from './types';

// The happy-path pipeline rendered as the state diagram. Terminal side states
// (voided, failed) are shown separately by the component when reached.
export const PIPELINE: IntentStatus[] = [
  'created',
  'authorized',
  'captured',
  'partially_refunded',
  'refunded',
];

export const ACTION_LABEL: Record<Action, string> = {
  authorize: 'Authorize',
  capture: 'Capture',
  refund: 'Refund',
  void: 'Void',
};

// How far along the pipeline a status sits, for highlighting reached nodes.
export function pipelineIndex(status: IntentStatus): number {
  const i = PIPELINE.indexOf(status);
  if (i >= 0) return i;
  // voided maps to the authorized stage (it leaves from authorized); failed maps
  // to the created stage (authorization never completed).
  if (status === 'voided') return PIPELINE.indexOf('authorized');
  return 0;
}

export function isTerminal(status: IntentStatus): boolean {
  return status === 'refunded' || status === 'voided' || status === 'failed';
}
