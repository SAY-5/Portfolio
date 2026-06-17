// Shared types for the PromptForge template manager. A template is a piece of
// text with {{variable}} placeholders and a list of declared variables. Each
// save snapshots an immutable version, so the body and variable set can be
// diffed and restored over time. Everything here is local and synchronous.

export type VarType = 'text' | 'number' | 'enum';

// A declared variable: the placeholder name used in the body, its input type,
// an optional default, and the allowed choices when the type is enum.
export type VarDef = {
  name: string;
  type: VarType;
  default: string;
  // Only meaningful for enum-typed variables; the allowed values.
  options: string[];
};

// A saved snapshot of a template at a point in time. Versions are immutable
// once written, which is what makes line diffs and restore well defined.
export type Version = {
  id: string;
  label: string;
  body: string;
  vars: VarDef[];
  savedAt: number;
};

// A template the user edits. body and vars hold the working draft; versions
// holds the saved history; activeVersionId marks the snapshot last restored.
export type Template = {
  id: string;
  name: string;
  body: string;
  vars: VarDef[];
  versions: Version[];
  activeVersionId: string | null;
  createdAt: number;
  updatedAt: number;
};

// Result of rendering a body against a set of values: the substituted output
// plus diagnostics the UI surfaces as warnings.
export type RenderResult = {
  output: string;
  // Placeholders found in the body that have no declared variable.
  undeclared: string[];
  // Declared variables referenced by the body with no value supplied.
  missing: string[];
  // Enum variables whose supplied value is not one of the declared options.
  invalidEnum: string[];
};

// One line of a unit diff between two versions' bodies.
export type DiffLine = {
  kind: 'same' | 'added' | 'removed';
  text: string;
};
