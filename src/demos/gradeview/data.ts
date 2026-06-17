// Synthetic class dataset for the in-browser GradeView dashboard. In the real
// system this lives in Postgres as an attempts table (one row per learner per
// skill per week, holding attempts and correct counts) and the aggregation runs
// SQL-side. Here it is generated deterministically in the browser from a fixed
// seed so the dashboard runs fully client-side and every reload draws the same
// class. The generator bakes in two real signals the views surface:
//   - graphing is a hard skill for the whole class across the term, and
//   - word problems shows a whole-class regression in one week (the change
//     point the drill-down flags).

export const LEARNERS = 30; // shown as small multiples; the SQL dataset is 300
export const WEEKS = 20;
export const FULL_LEARNERS = 300; // the size the benchmark numbers were taken at

export type SkillKey = 'fractions' | 'graphing' | 'word-problems' | 'geometry';

export type SkillMeta = {
  key: SkillKey;
  label: string;
  // starting class mean mastery and the weekly improvement slope
  base: number;
  slope: number;
  // per-week dips applied to the whole class, keyed by week index
  dips: Record<number, number>;
  // how wide the cohort spreads around the class mean (bigger = more variance)
  spread: number;
};

// The four skills. graphing has the lowest base and slope (hard for everyone);
// word problems carries a sharp week-11 dip that the change-point flag catches.
export const SKILLS: SkillMeta[] = [
  { key: 'fractions', label: 'fractions', base: 0.42, slope: 0.026, dips: {}, spread: 0.16 },
  { key: 'graphing', label: 'graphing', base: 0.3, slope: 0.014, dips: {}, spread: 0.18 },
  {
    key: 'word-problems',
    label: 'word problems',
    base: 0.4,
    slope: 0.025,
    dips: { 11: 0.22, 12: 0.08 },
    spread: 0.17,
  },
  { key: 'geometry', label: 'geometry', base: 0.36, slope: 0.022, dips: { 6: 0.07 }, spread: 0.15 },
];

export function skillMeta(key: SkillKey): SkillMeta {
  return SKILLS.find((s) => s.key === key) ?? SKILLS[0];
}

// Deterministic learner names so small multiples have stable, human labels.
const FIRST = [
  'Ava', 'Ben', 'Cara', 'Dev', 'Ela', 'Finn', 'Gia', 'Hugo', 'Iris', 'Jude',
  'Kai', 'Lena', 'Milo', 'Nora', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tariq',
  'Uma', 'Vik', 'Wren', 'Xena', 'Yusuf', 'Zoe', 'Asha', 'Bo', 'Cy', 'Dot',
];

export type Learner = {
  id: number;
  name: string;
  // a stable per-learner ability offset in roughly [-1, 1] that shifts their
  // whole mastery curve up or down relative to the class mean
  ability: number;
};

// A tiny deterministic PRNG (mulberry32) so the whole dataset is reproducible
// without pulling in a dependency. Same seed in, same class out.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0x6a4d3; // fixed seed; the dashboard always shows the same class

// One attempt cell: how many questions a learner saw that week for a skill and
// how many they got right, plus the derived mastery (correct / attempts).
export type Cell = {
  attempts: number;
  correct: number;
  mastery: number;
};

// A learner's full record: their ability offset and a skill -> weekly cells map.
export type LearnerRecord = {
  learner: Learner;
  bySkill: Record<SkillKey, Cell[]>;
};

function clamp01(v: number): number {
  return Math.max(0.02, Math.min(0.99, v));
}

// Build the whole class once. Each learner's weekly mastery is the class mean
// for that skill and week, shifted by the learner's ability and a little noise,
// then turned into integer attempts/correct so the cohort looks like real data.
function build(): LearnerRecord[] {
  const rand = mulberry32(SEED);
  const records: LearnerRecord[] = [];

  for (let i = 0; i < LEARNERS; i++) {
    const ability = (rand() - 0.5) * 1.6; // roughly [-0.8, 0.8]
    const learner: Learner = {
      id: i,
      name: FIRST[i % FIRST.length] + (i >= FIRST.length ? ` ${Math.floor(i / FIRST.length) + 1}` : ''),
      ability,
    };

    const bySkill = {} as Record<SkillKey, Cell[]>;

    for (const skill of SKILLS) {
      const cells: Cell[] = [];
      let mean = skill.base;
      for (let w = 0; w < WEEKS; w++) {
        mean = Math.min(0.98, mean + skill.slope);
        if (skill.dips[w]) mean = Math.max(0.05, mean - skill.dips[w]);
        // learner mastery = class mean + ability * spread + small weekly noise
        const noise = (rand() - 0.5) * skill.spread * 0.9;
        const mastery = clamp01(mean + ability * skill.spread + noise);
        const attempts = 8 + Math.floor(rand() * 5); // 8..12 questions a week
        const correct = Math.round(mastery * attempts);
        cells.push({ attempts, correct, mastery: +(correct / attempts).toFixed(3) });
      }
      bySkill[skill.key] = cells;
    }

    records.push({ learner, bySkill });
  }

  return records;
}

// The dataset is built once at module load and frozen so views share one
// reference and never mutate it.
export const CLASS: LearnerRecord[] = build();

// A few questions per skill with deterministic failure rates, used by the
// drill-down's "worst questions" panel. The worst question per skill is the one
// the most learners miss, which is the struggle signal teachers act on.
export type Question = {
  id: string;
  skill: SkillKey;
  prompt: string;
  // share of the class that gets this question wrong, 0..1
  failRate: number;
};

export const QUESTIONS: Question[] = [
  { id: 'FR-1', skill: 'fractions', prompt: 'Add unlike denominators', failRate: 0.41 },
  { id: 'FR-2', skill: 'fractions', prompt: 'Simplify to lowest terms', failRate: 0.22 },
  { id: 'FR-3', skill: 'fractions', prompt: 'Compare two fractions', failRate: 0.18 },
  { id: 'GR-1', skill: 'graphing', prompt: 'Read slope from a line', failRate: 0.58 },
  { id: 'GR-2', skill: 'graphing', prompt: 'Plot from an equation', failRate: 0.46 },
  { id: 'GR-3', skill: 'graphing', prompt: 'Identify the intercept', failRate: 0.33 },
  { id: 'WP-1', skill: 'word-problems', prompt: 'Two-step rate problem', failRate: 0.52 },
  { id: 'WP-2', skill: 'word-problems', prompt: 'Translate words to an equation', failRate: 0.49 },
  { id: 'WP-3', skill: 'word-problems', prompt: 'Multi-part ratio problem', failRate: 0.37 },
  { id: 'GE-1', skill: 'geometry', prompt: 'Area of a composite shape', failRate: 0.44 },
  { id: 'GE-2', skill: 'geometry', prompt: 'Angle sum in a polygon', failRate: 0.29 },
  { id: 'GE-3', skill: 'geometry', prompt: 'Volume of a prism', failRate: 0.24 },
];

export function questionsForSkill(skill: SkillKey): Question[] {
  return QUESTIONS.filter((q) => q.skill === skill).sort((a, b) => b.failRate - a.failRate);
}
