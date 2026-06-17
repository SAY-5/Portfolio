// Domain types for the in-browser configmesh configuration manager. The model
// is a single base layer of default values plus a set of environments, each of
// which can override any key. Everything here is plain data so the engine that
// resolves, validates, and diffs it stays free of side effects.

// The value types a config key can hold. Kept deliberately small: a string, a
// number, or a boolean. Stored values are always one of these primitives.
export type ConfigType = 'string' | 'number' | 'bool';

export type ConfigValue = string | number | boolean;

// A key declaration. The base default is stored separately (in the base layer)
// so a key can exist before a default is set.
export type ConfigKey = {
  name: string;
  type: ConfigType;
  required: boolean;
};

// An environment owns a sparse map of overrides keyed by config-key name. A key
// absent from the map inherits the base default.
export type Environment = {
  id: string;
  name: string;
  overrides: Record<string, ConfigValue>;
};

// The whole document the store persists and the engine operates on.
export type ConfigDoc = {
  keys: ConfigKey[];
  // Base defaults keyed by key name. A key may be missing here (no default).
  base: Record<string, ConfigValue>;
  environments: Environment[];
};

// One resolved key in the context of a single environment.
export type Resolved = {
  name: string;
  type: ConfigType;
  required: boolean;
  // The effective value after applying the override-else-base rule, or
  // undefined when neither a default nor an override is set.
  value: ConfigValue | undefined;
  // True when the value came from an environment override rather than the base.
  overridden: boolean;
};

// A single validation problem found for an environment.
export type ValidationIssue =
  | { kind: 'missing-required'; key: string }
  | { kind: 'type-error'; key: string; expected: ConfigType; got: string };

// One entry in a two-environment diff.
export type DiffEntry =
  | { kind: 'added'; key: string; value: ConfigValue | undefined }
  | { kind: 'removed'; key: string; value: ConfigValue | undefined }
  | {
      kind: 'changed';
      key: string;
      from: ConfigValue | undefined;
      to: ConfigValue | undefined;
    };
