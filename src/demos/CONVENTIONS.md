# Demo conventions

This folder holds interactive project demos and nothing else. Demos are
auto-discovered, so adding one is dropping a single file here with no edit to
any shared file. That is what lets many demos be added in parallel without
conflicts.

## The one-file rule

A new demo is exactly one file:

```
src/demos/<exact-repo-name>.tsx
```

- It must have a default-exported React component.
- The basename of the `.tsx` must equal the GitHub repo name exactly (the
  project `name`), so it maps to the right project detail page at
  `/p/<name>`. For example `src/demos/codelens.tsx` powers `/p/codelens`.
- You may add one OPTIONAL co-located stylesheet `src/demos/<name>.css`,
  imported only by that demo file.

## What a demo must NOT touch

A new demo must not edit any shared file. Specifically, do not change:

- `src/lib/demoRegistry.ts` (the registry; it discovers files for you)
- `src/components/DemoSlot.tsx` (renders the registered demo)
- `src/styles/demo.css` (shared demo styles; co-locate your own CSS instead)
- `src/pages/Detail.tsx` (the detail page)

## How discovery works

The registry uses a Vite glob import:

```ts
import.meta.glob('../demos/*.tsx', { eager: true })
```

It keys each module by the file basename and exposes the component as the
module's default export. `hasDemo(name)` reports whether a demo exists, and
`DemoSlot` looks up `demos[name]` and renders it; a project without a demo
keeps the placeholder. `CONVENTIONS.md` is not a `.tsx` file, so it is never
picked up as a demo.
