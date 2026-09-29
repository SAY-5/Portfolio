# Portfolio project search and verified demo links

Status: approved narrower direction. The user chose “Keep search only on the Work page.” The coordinator authorized local implementation and tests; commits, PRs and deployments remain coordinator-owned and unauthorized for this worker.

## Context and ownership

- Source: `SAY-5/Portfolio`, frozen main `a9d9c6eebcf6e86bb6a753bf6a0c6b4dd2aa0df3`.
- Owned checkout: `/private/tmp/portfolio-search.LIMN8L/Portfolio`; branch `say5/project-search-20260929`.
- This worker owns only this checkout's Portfolio source and tests. The coordinator owns publication decisions. Existing Portfolio/showcases checkouts and the shared showcases catalog remain untouched.
- The public site is `https://say5.vercel.app/`. Its `/work` route already provides query, category and language filters, URL state, a result count, clear and empty states. The homepage has no search field.
- At the frozen baseline, the catalog contained 165 project objects and neither KernelCheck nor RankFault. Deployment acceptance is coordinator-owned; the worker does not infer public URLs.

## Visitor job and selected direction

A visitor who knows a repository name, problem description or technology should be able to find it in the existing Work index and combine that query with category/language filters. Preserve the graphite/lime palette, Switzer typography, hairline project rows and reduced-motion behavior. This is a narrow refinement of the existing interface, not a visual redesign.

Approved approach: improve the existing Work search only. Keep `/work?q=<encoded query>` as the canonical shareable results route. Do not edit `Home.tsx`, `home.css`, the homepage selected-project list or homepage navigation.

Alternatives considered:

1. **Work-only improvements (selected by the user):** preserves the current homepage and one shareable results implementation.
2. **Homepage form to Work (not selected):** adds a discovery entry point, but is explicitly outside the approved scope.
3. **Global command palette/fuzzy search (not selected):** adds modal/focus/ranking complexity without improving the requested basic search enough.

## Search behavior

- Match repository `name`, `title`, `tagline`, `summary`, `category`, primary `language` and all `stack` entries. `stack` and category are the current technology/tag metadata; do not invent tags or rewrite the catalog.
- Preserve the current predictable case-insensitive substring/phrase semantics. Trim leading/trailing whitespace; blank query matches all projects. Treat characters such as `C++`, `C#`, hyphens and punctuation literally, not as a regular expression. Multiword fuzzy/token ranking is out of scope.
- Query AND category AND language determine results. Keep existing sort and contextual facet counts. Search changes preserve the active `c`, `l` and `sort` URL parameters.
- Preserve current Clear-all behavior and empty-state recovery. Add a separate Clear search action beside a non-empty Work query that removes only `q`, preserves other filters and returns focus to its input.
- Preserve the Work input's visible Search label, `type="search"`, `name="q"`, `autoComplete="off"`, `spellCheck={false}` and visible keyboard focus. Add a native button for query-only clearing. No autofocus, modal, new keyboard interception or new animation.
- Keep the Work result count in its existing polite live region; do not move focus on each result update. At 390px and 1440px the input/button wrap without horizontal overflow.

## Verified demo integration

- Extend `Project` with optional `demoUrl?: string` for explicit HTTPS destinations supplied by the coordinator after verifying the deployed app and revision.
- Resolve both primary and aside demo links from that field when present. Existing projects retain `https://showcases-lime.vercel.app/<name>` as their fallback; no mass link rewrite.
- Add each KernelCheck or RankFault catalog record only after its verified public URL and coordinator-approved factual summary are supplied. The coordinator authorized per-record insertion as each deployment passes acceptance. Until that record's gate passes, do not add its card, invent a host, or point a nonexistent showcase route at its name.
- Use the existing project detail route and normal row navigation, then an explicit external demo link. Do not copy the standalone app code into `src/demos`, iframe it, or duplicate its evidence.
- KernelCheck copy must identify a browser CPU execution-model port, not a measured GPU run. RankFault copy must identify a replay of committed CPU/Gloo evidence, not a live distributed cluster. No new performance or completeness claims.
- The two records are not added to the homepage's selected-project set. Preserve the curated ordering and existing selected flags.

## Source map

| File | Responsibility |
| --- | --- |
| `src/pages/Work.tsx` | Reuse matching helper; preserve existing facets/sort; query-only clear |
| `src/lib/projectSearch.ts` | Pure, dependency-free text matching shared by result and facet calculations |
| `src/lib/projectLinks.ts` | Pure explicit-demo destination or existing showcase fallback |
| `src/styles/work.css` | Query-clear placement within existing search controls |
| `src/data/projects.ts` | Optional demo URL; two verified records only after the external gate |
| `src/pages/Detail.tsx` | Use explicit demo URL for both outbound app links |
| `tests/project-search.test.mjs` | Real matching behavior and hand-derived cases |
| `tests/portfolio-search.browser.mjs` | Built-site Work query state, filters, clear/empty/focus, responsive and demo-link checks |
| `package.json`, lockfile, `.github/workflows/ci.yml` | Reproducible tests with lifecycle scripts disabled during installation |
| `README.md`, `index.html` | Test instructions and removal of stale hard-coded project counts |

## Verification and dependency proposal

Baseline main CI passed at `https://github.com/SAY-5/Portfolio/actions/runs/36357488305`. New implementation evidence will be recorded separately.

Use Node's built-in test/assert APIs and the already installed TypeScript compiler to execute pure helper tests across the existing supported Node versions. Use pinned development-only `playwright-core@1.63.0`, whose published engine floor is Node 20, with an explicitly supplied existing Chrome binary and a fresh browser profile. No browser download, installer hook, production dependency or Node engine-floor change is needed.

All package operations use `--ignore-scripts`. Current package scripts are Vite, TypeScript and ESLint only; current lock metadata flags only optional `fsevents` as having an install script. Inspect the new lockfile's lifecycle metadata before executing installed tools.

Acceptance: direct Work links and reload retain the query; repository names and description/technology phrases match; combined filters and query-only clear behave correctly; an unknown query exposes the existing empty recovery; keyboard focus is visible and stable; 390px/1440px layouts do not overflow; both new detail pages open the coordinator-verified URLs; existing demo links retain their old destination; homepage files remain unchanged. Record RED and GREEN test results, lint/build results and the exact verified revision. Public deployment verification is a separate coordinator-owned gate.

## Approval gates

The search interaction is approved by the user's Work-only decision. The coordinator supplied both verified demo URLs and approved factual descriptions before catalog insertion. The local catalog now contains 167 records, with neither new project in the selected set. This document does not authorize any remote write, deployment, commit or PR.

Coordinator-provided public acceptance receipts (not independently re-executed by this worker):

| Project | Verified destination | Observed public behavior | Deployment |
| --- | --- | --- | --- |
| RankFault | `https://say5-rankfault.vercel.app/` | Unauthenticated HTTP 200; 114-run replay loads; repeat 2 survives URL refresh | `8WJkuvbbUiaLPN5aDdK6qf4HsxQv`, web commit `09f0e6d` |
| KernelCheck | `https://say5-kernelcheck.vercel.app/` | Unauthenticated HTTP 200; default `sync_drop` / `row_sum` / seed 42 completes 24 shrink candidates to rows 1, columns 97 | `2EFebqeK6R3YdoqVVyLAgts2jD4o`; coordinator may republish the same alias for immutable evidence-document links |

These are deployment receipts, not GPU acceptance or a fresh distributed-cluster run. The Portfolio browser suite checks local navigation, factual caveats and both outbound destinations; deployment/publication of the Portfolio change remains coordinator-owned.
