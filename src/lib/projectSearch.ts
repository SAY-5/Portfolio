import type { Project } from '../data/projects';

type SearchableProject = Pick<Project, 'name' | 'title' | 'tagline' | 'summary' | 'category' | 'language' | 'stack'>;

export function matchesProjectQuery(project: SearchableProject, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  const text = [project.name, project.title, project.tagline, project.summary, project.category, project.language, ...project.stack]
    .join(' ')
    .toLowerCase();
  return text.includes(query);
}
