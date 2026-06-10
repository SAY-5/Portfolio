import { projects, categories, languages } from './projects';

export type Bucket = { label: string; count: number };

export const totalProjects = projects.length;

export const languageCount = languages.length;

export const categoryBuckets: Bucket[] = categories
  .map((label) => ({
    label,
    count: projects.filter((p) => p.category === label).length,
  }))
  .filter((b) => b.count > 0)
  .sort((a, b) => b.count - a.count);

export const languageBuckets: Bucket[] = languages
  .map((label) => ({
    label,
    count: projects.filter((p) => p.language === label).length,
  }))
  .sort((a, b) => b.count - a.count);

export const topLanguages = languageBuckets.slice(0, 8);

export const maxCategoryCount = Math.max(
  ...categoryBuckets.map((b) => b.count),
);
