export function getProjectDemoUrl(project: { name: string; demoUrl?: string }): string {
  return project.demoUrl ?? `https://showcases-lime.vercel.app/${project.name}`;
}
