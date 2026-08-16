import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

// Auto-discovered demo registry. Every file under src/demos that matches
// <name>.tsx is picked up by the glob below and keyed by its basename, which
// must equal the GitHub repo name so it maps to the matching project. Adding a
// demo is dropping one file here; no edit to this file or any other is needed.
// See src/demos/CONVENTIONS.md for the one-file rule.
//
// Demos are loaded lazily: the glob is not eager, so each demo (and its
// stylesheet) becomes its own chunk that only downloads on its detail page.
type DemoModule = { default: ComponentType };

const loaders = import.meta.glob<DemoModule>('../demos/*.tsx');

export const demos: Record<string, LazyExoticComponent<ComponentType>> =
  Object.fromEntries(
    Object.entries(loaders).map(([path, load]) => {
      const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.tsx$/, '');
      return [name, lazy(load)];
    }),
  );

export function hasDemo(name: string): boolean {
  return name in demos;
}
