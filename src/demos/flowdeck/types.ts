// FlowDeck models a multi-step approval workflow that items advance through.
// A workflow is an ordered list of steps. Each step names the role that may
// approve it and can carry an optional condition that decides whether the step
// applies to a given item; a step whose condition is false is skipped. Items
// move forward only when their current step is approved, and a rejection sends
// them back to the previous step or to the start, per the step's onReject rule.

export type Role = 'requester' | 'manager' | 'finance' | 'security';

// A field on an item the workflow reasons about. Kept primitive so conditions
// stay a safe, data-only comparison (no eval, no functions on the wire).
export type FieldValue = string | number | boolean;

export type ItemFields = Record<string, FieldValue>;

// A condition is a plain data object compared against an item's fields. The
// engine interprets it; it is never executed as code. This is what keeps the
// engine eval-free while still letting a workflow gate a step on item data.
export type Comparator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';

export type Condition = {
  field: string;
  op: Comparator;
  value: FieldValue;
};

// Where a rejection at this step sends the item.
export type RejectTarget = 'previous' | 'start';

export type WorkflowStep = {
  id: string;
  name: string;
  // The role allowed to approve or reject this step.
  approver: Role;
  // When present, the step only applies if the condition holds for the item.
  // A step that does not apply is skipped during placement and advancement.
  condition?: Condition;
  // Short description shown in the workflow panel.
  description: string;
  // Where a rejection sends the item.
  onReject: RejectTarget;
};

export type Workflow = {
  id: string;
  name: string;
  steps: WorkflowStep[];
};

// The lifecycle stage of an item within a workflow.
//  - active:   sitting at a step, awaiting that step's approval
//  - approved: cleared the final applicable step
//  - rejected: most recent decision was a rejection (still active at a step)
export type ItemStage = 'active' | 'approved';

export type HistoryKind = 'submitted' | 'approved' | 'rejected' | 'skipped' | 'completed';

export type HistoryEntry = {
  id: string;
  itemId: string;
  // The step the decision was taken at (empty for submit/complete summaries).
  stepId: string;
  stepName: string;
  kind: HistoryKind;
  // Who took the action. For skips this is the engine.
  actor: Role | 'engine';
  note: string;
  at: number;
};

export type Item = {
  id: string;
  title: string;
  fields: ItemFields;
  // Index into the workflow's steps array of the step the item currently sits
  // at. Equal to steps.length once the item has cleared the final step.
  stepIndex: number;
  stage: ItemStage;
  submittedAt: number;
  history: HistoryEntry[];
};
