# portfolio

The portfolio hub for Sai Asish Y (GitHub: [SAY-5](https://github.com/SAY-5)).
One site that collects 148 projects across systems, distributed infra, agents,
full-stack web, and C++, with a home page, a project explorer, and a detail
page for every project.

## Stack

React, TypeScript, Vite, React Router, and Framer Motion. The build is a static
single-page app.

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

The build output in `dist/` is static and ready for Vercel. `vercel.json`
rewrites all routes to `index.html` so client-side routing works on refresh and
deep links. No server is required.

## Layout

- `/` home: positioning, the eight featured projects, and a numbers band.
- `/work` explorer: all 148 projects with category and language filters, search,
  and sort.
- `/p/:name` detail: summary, stack, highlights, and links for one project.

## License

MIT. See [LICENSE](./LICENSE).
