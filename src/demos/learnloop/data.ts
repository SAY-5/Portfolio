// Question bank for the in-browser LearnLoop practice session. In the real
// system this lives in Postgres behind the Spring Boot service; here it is a
// static seed so the app runs fully in the browser. Each question carries a
// difficulty rating on the same Elo scale as the learner rating, so the
// expected-success formula compares the two directly. Every question is
// multiple choice with exactly one correct option, so the app can grade an
// answer locally without a server.

export type Skill = 'algebra' | 'geometry' | 'statistics';

export type Question = {
  id: string;
  skill: Skill;
  prompt: string;
  options: string[];
  answer: number; // index into options of the correct choice
  // Difficulty rating on the Elo scale. A question at the learner's rating is a
  // coin flip; one rated 400 below is about a 91 percent expected success.
  diff: number;
};

export const SKILLS: { id: Skill; label: string }[] = [
  { id: 'algebra', label: 'Algebra' },
  { id: 'geometry', label: 'Geometry' },
  { id: 'statistics', label: 'Statistics' },
];

export function skillLabel(skill: Skill): string {
  return SKILLS.find((s) => s.id === skill)?.label ?? skill;
}

// A spread of difficulties per skill so the selector always has items above and
// below the learner to chase the 70 percent target as the rating moves.
export const bank: Question[] = [
  // ---------- algebra ----------
  {
    id: 'al-1',
    skill: 'algebra',
    prompt: 'Solve for x: 2x + 6 = 14',
    options: ['2', '4', '5', '10'],
    answer: 1,
    diff: 1120,
  },
  {
    id: 'al-2',
    skill: 'algebra',
    prompt: 'Simplify: 3(x + 2) - 2x',
    options: ['x + 6', 'x + 2', '5x + 6', 'x - 6'],
    answer: 0,
    diff: 1220,
  },
  {
    id: 'al-3',
    skill: 'algebra',
    prompt: 'Factor: x^2 - 9',
    options: ['(x - 3)(x - 3)', '(x + 9)(x - 1)', '(x - 3)(x + 3)', 'x(x - 9)'],
    answer: 2,
    diff: 1330,
  },
  {
    id: 'al-4',
    skill: 'algebra',
    prompt: 'Solve the system: x + y = 7 and x - y = 1',
    options: ['x = 4, y = 3', 'x = 3, y = 4', 'x = 5, y = 2', 'x = 6, y = 1'],
    answer: 0,
    diff: 1440,
  },
  {
    id: 'al-5',
    skill: 'algebra',
    prompt: 'Solve: 1 / (x - 2) = 3',
    options: ['x = 7/3', 'x = 2/3', 'x = 5', 'x = 1/3'],
    answer: 0,
    diff: 1560,
  },
  {
    id: 'al-6',
    skill: 'algebra',
    prompt: 'If log2(x) = 5, then x equals',
    options: ['10', '25', '32', '64'],
    answer: 2,
    diff: 1640,
  },

  // ---------- geometry ----------
  {
    id: 'ge-1',
    skill: 'geometry',
    prompt: 'The interior angles of a triangle sum to',
    options: ['90', '180', '270', '360'],
    answer: 1,
    diff: 1100,
  },
  {
    id: 'ge-2',
    skill: 'geometry',
    prompt: 'Area of a rectangle 6 by 4',
    options: ['10', '20', '24', '48'],
    answer: 2,
    diff: 1200,
  },
  {
    id: 'ge-3',
    skill: 'geometry',
    prompt: 'Hypotenuse of a right triangle with legs 3 and 4',
    options: ['5', '6', '7', '12'],
    answer: 0,
    diff: 1310,
  },
  {
    id: 'ge-4',
    skill: 'geometry',
    prompt: 'Circumference of a circle with radius 7 (use 22/7)',
    options: ['22', '44', '49', '154'],
    answer: 1,
    diff: 1420,
  },
  {
    id: 'ge-5',
    skill: 'geometry',
    prompt: 'Volume of a cube with edge 5',
    options: ['25', '75', '100', '125'],
    answer: 3,
    diff: 1530,
  },
  {
    id: 'ge-6',
    skill: 'geometry',
    prompt: 'Interior angle of a regular hexagon',
    options: ['108', '120', '135', '144'],
    answer: 1,
    diff: 1630,
  },

  // ---------- statistics ----------
  {
    id: 'st-1',
    skill: 'statistics',
    prompt: 'Mean of 2, 4, 6, 8',
    options: ['4', '5', '6', '20'],
    answer: 1,
    diff: 1130,
  },
  {
    id: 'st-2',
    skill: 'statistics',
    prompt: 'Median of 3, 1, 4, 1, 5',
    options: ['1', '3', '4', '5'],
    answer: 1,
    diff: 1230,
  },
  {
    id: 'st-3',
    skill: 'statistics',
    prompt: 'Mode of 7, 7, 2, 9, 7, 2',
    options: ['2', '7', '9', '5'],
    answer: 1,
    diff: 1340,
  },
  {
    id: 'st-4',
    skill: 'statistics',
    prompt: 'Probability of two heads on two fair coin flips',
    options: ['1/2', '1/3', '1/4', '3/4'],
    answer: 2,
    diff: 1450,
  },
  {
    id: 'st-5',
    skill: 'statistics',
    prompt: 'Range of 12, 5, 20, 8',
    options: ['8', '12', '15', '20'],
    answer: 2,
    diff: 1540,
  },
  {
    id: 'st-6',
    skill: 'statistics',
    prompt: 'Standard deviation of 4, 4, 4, 4',
    options: ['0', '1', '2', '4'],
    answer: 0,
    diff: 1650,
  },
];

export function questionsForSkill(skill: Skill): Question[] {
  return bank.filter((q) => q.skill === skill);
}

export function findQuestion(id: string): Question | undefined {
  return bank.find((q) => q.id === id);
}
