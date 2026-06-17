// Domain model for SkillMatch. A role lists the skills it requires, each with
// a needed level (1..5) and a relative weight that controls how much it counts
// toward the match. A person lists the skills they hold with their own level
// (1..5). The engine computes weighted set overlap, gaps, and rankings between
// roles and people. No skill is treated as an exact-name match beyond its id,
// so the same id refers to the same competency across roles and people.

// A proficiency level on a fixed 1..5 ladder. Kept as a plain number so the
// editors can bind a range input directly.
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 5;

export type RequiredSkill = {
  // Stable competency id, shared between roles and people (lowercase slug).
  skillId: string;
  // Needed proficiency on the 1..5 ladder.
  level: number;
  // Relative importance of this skill within the role. Larger weighs more.
  weight: number;
};

export type Role = {
  id: string;
  name: string;
  required: RequiredSkill[];
};

export type PersonSkill = {
  skillId: string;
  // Held proficiency on the 1..5 ladder.
  level: number;
};

export type Person = {
  id: string;
  name: string;
  skills: PersonSkill[];
};

// A single gap entry for a role/person pair. `missing` means the person holds
// no level in the skill at all; otherwise `deficit` is the shortfall below the
// needed level (0 when the person meets or exceeds it).
export type Gap = {
  skillId: string;
  needed: number;
  held: number; // 0 when the person lacks the skill entirely
  deficit: number; // max(0, needed - held)
  missing: boolean;
  weight: number;
};

// Result of scoring one person against one role.
export type MatchResult = {
  // 0..1 weighted coverage of the role's required skills.
  score: number;
  // Gaps sorted by weighted deficit, most severe first.
  gaps: Gap[];
  // Total required weight, used for transparency in the UI.
  totalWeight: number;
  // Covered weight that contributed to the score.
  coveredWeight: number;
};

// A ranked person for a given role.
export type RankedPerson = {
  person: Person;
  match: MatchResult;
};

// A ranked role for a given person.
export type RankedRole = {
  role: Role;
  match: MatchResult;
};
