import { projects, categories } from './projects';

export type Bucket = { label: string; count: number };

export const totalProjects = projects.length;

export const categoryBuckets: Bucket[] = categories
  .map((label) => ({
    label,
    count: projects.filter((p) => p.category === label).length,
  }))
  .filter((b) => b.count > 0)
  .sort((a, b) => b.count - a.count);
