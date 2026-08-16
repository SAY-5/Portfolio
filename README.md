# portfolio

Sai Asish Y's portfolio (GitHub: [SAY-5](https://github.com/SAY-5)). One site
that indexes 153 public repos: systems and infrastructure work, agents, web
apps, and a few C++ experiments. There is a home page with the whole catalog
rendered as one object, an index you can filter and search, and a page per
project with a summary, the parts worth knowing, and usually a live demo.

## Stack

React 19, TypeScript, Vite, React Router, Framer Motion, and three.js through
react-three-fiber for the hero object. The build is a static single page app.

## Run it locally

```bash
npm install
npm run dev
```

Then open the printed local URL.

## Other scripts

```bash
npm run build    # type-check and produce a static build in dist/
npm run preview  # serve the production build locally
npm run lint     # run eslint
```

## Deploy

`dist/` is static and ready for Vercel. `vercel.json` rewrites every route to
`index.html` so client side routing survives refreshes and deep links.

## Layout

- `/` home: the object, the eleven selected projects, and the catalog by
  category.
- `/work` index: all 153 projects with category and language filters, search,
  and sort. Filters live in the URL, so a filtered view can be shared.
- `/p/:name` detail: summary, highlights, stack, links, and the demo when one
  exists.

## Demos

Each demo is one file under `src/demos/<repo-name>.tsx`, discovered
automatically and loaded lazily on its own page. See
`src/demos/CONVENTIONS.md`.

## License

MIT. See [LICENSE](./LICENSE).
