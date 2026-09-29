# portfolio

Sai Asish Y's portfolio (GitHub: [SAY-5](https://github.com/SAY-5)). One site
that indexes public repos: systems and infrastructure work, agents, web
apps, and a few C++ experiments. There is a home page with the whole catalog
rendered as one object, an index you can filter and search, and a page per
project with a summary, the parts worth knowing, and usually a live demo.

## Stack

React 19, TypeScript, Vite, React Router, Framer Motion, and three.js through
react-three-fiber for the hero object. The build is a static single page app.

## Run it locally

Use Node.js 20.19+, 22.13+, or 24+ (even-numbered LTS releases).

```bash
npm ci --ignore-scripts
npm run dev
```

Then open the printed local URL.

## Other scripts

```bash
npm run build    # type-check and produce a static build in dist/
npm run preview  # serve the production build locally
npm run lint     # run eslint
npm run test:search # pure search and demo-link behavior
npm run test:browser # production-build browser checks; run build first
```

Browser checks use the existing Google Chrome binary at
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on macOS or
`/usr/bin/google-chrome` on Linux. Set `CHROME_PATH` to use another installed
Chrome binary. The test runner creates and closes its own temporary browser
profile and loopback-only preview server; it never attaches to personal tabs
or downloads a browser. CI installs dependencies with lifecycle scripts
disabled and runs both test suites.

Project search stays on `/work`. It matches repository names, titles,
descriptions, categories, languages and stack entries, and combines the query
with category/language filters. **Clear search** removes only the query and
returns focus to the input; **Clear** resets all filters. Search and filter
state remain in the URL for sharing and reloading.

## Deploy

`dist/` is static and ready for Vercel. `vercel.json` rewrites every route to
`index.html` so client side routing survives refreshes and deep links.

## Layout

- `/` home: the object, the selected projects, and the catalog by
  category.
- `/work` index: the full project catalog with category and language filters, search,
  and sort. Filters live in the URL, so a filtered view can be shared.
- `/p/:name` detail: summary, highlights, stack, links, and the demo when one
  exists.

## Demos

Each embedded demo is one file under `src/demos/<repo-name>.tsx`, discovered
automatically and loaded lazily on its own page. See
`src/demos/CONVENTIONS.md`.

An optional `demoUrl` in the project catalog points both outbound app links to
a verified standalone deployment. Projects without an override retain their
existing showcase destination.

## License

MIT. See [LICENSE](./LICENSE).
