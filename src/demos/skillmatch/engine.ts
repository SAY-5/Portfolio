// Pure, deterministic matching engine. No eval, no Date, no randomness: every
// output is a function of the role and person passed in. The core idea is
// weighted set overlap. For each required skill the role asks for a needed
// level at a given weight; the person either meets it (full credit), partially
// meets it (partial credit proportional to how close they are), or lacks it
// (no credit). The match score is covered weight over total weight.

import {
  MAX_LEVEL,
  MIN_LEVEL,
  type Gap,
  type MatchResult,
  type Person,
  type RankedPerson,
  type RankedRole,
  type Role,
} from './types';

// Clamp a level onto the fixed ladder.
export function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return MIN_LEVEL;
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(level)));
}

// Look up a person's held level in a skill, or 0 if they do not have it.
function heldLevel(person: Person, skillId: string): number {
  const found = person.skills.find((s) => s.skillId === skillId);
  return found ? found.level : 0;
}

// Credit for one required skill given the held level. Meeting or exceeding the
// needed level scores 1. Below it, credit is the held level over the needed
// level, so being one rung short on a level-4 skill still earns partial credit
// rather than zero. A missing skill (held 0) scores 0.
function coverage(needed: number, held: number): number {
  if (needed <= 0) return 1;
  if (held >= needed) return 1;
  return Math.max(0, held) / needed;
}

// Score one person against one role. Skills with non-positive weight are
// ignored so a zero-weight skill cannot drag the denominator.
export function matchPersonToRole(role: Role, person: Person): MatchResult {
  let totalWeight = 0;
  let coveredWeight = 0;
  const gaps: Gap[] = [];

  for (const req of role.required) {
    const weight = req.weight > 0 ? req.weight : 0;
    if (weight === 0) continue;
    const needed = req.level;
    const held = heldLevel(person, req.skillId);
    totalWeight += weight;
    coveredWeight += weight * coverage(needed, held);

    const deficit = Math.max(0, needed - held);
    if (deficit > 0) {
      gaps.push({
        skillId: req.skillId,
        needed,
        held,
        deficit,
        missing: held === 0,
        weight,
      });
    }
  }

  // Rank gaps by weighted deficit so the most consequential shortfall leads.
  gaps.sort((a, b) => b.deficit * b.weight - a.deficit * a.weight);

  const score = totalWeight === 0 ? 1 : coveredWeight / totalWeight;
  return { score, gaps, totalWeight, coveredWeight };
}

// Rank every person for a role, best match first. Ties break on fewer gaps
// then name, so the order is stable and reproducible.
export function rankPeopleForRole(
  role: Role,
  people: Person[],
): RankedPerson[] {
  return people
    .map((person) => ({ person, match: matchPersonToRole(role, person) }))
    .sort((a, b) => {
      if (b.match.score !== a.match.score) return b.match.score - a.match.score;
      if (a.match.gaps.length !== b.match.gaps.length) {
        return a.match.gaps.length - b.match.gaps.length;
      }
      return a.person.name.localeCompare(b.person.name);
    });
}

// Rank every role for a person, best fit first, with the same tie ordering.
export function rankRolesForPerson(
  person: Person,
  roles: Role[],
): RankedRole[] {
  return roles
    .map((role) => ({ role, match: matchPersonToRole(role, person) }))
    .sort((a, b) => {
      if (b.match.score !== a.match.score) return b.match.score - a.match.score;
      if (a.match.gaps.length !== b.match.gaps.length) {
        return a.match.gaps.length - b.match.gaps.length;
      }
      return a.role.name.localeCompare(b.role.name);
    });
}

// Convenience for the UI: match as a rounded percentage.
export function matchPercent(score: number): number {
  return Math.round(score * 100);
}
