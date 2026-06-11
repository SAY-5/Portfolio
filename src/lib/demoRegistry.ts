import type { ComponentType } from 'react';

// Auto-discovered demo registry. Every file under src/demos that matches
// <name>.tsx is picked up by the glob below and keyed by its basename, which
// must equal the GitHub repo name so it maps to the matching project. Adding a
// demo is dropping one file here; no edit to this file or any other is needed.
// See src/demos/CONVENTIONS.md for the one-file rule.
type DemoModule = { default: ComponentType };

const modules = import.meta.glob<DemoModule>('../demos/*.tsx', { eager: true });

export const demos: Record<string, ComponentType> = Object.fromEntries(
  Object.entries(modules).map(([path, mod]) => {
    const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.tsx$/, '');
    return [name, mod.default];
  }),
);

export function hasDemo(name: string): boolean {
  return name in demos;
}
