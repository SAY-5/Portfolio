# Portfolio Project Search Implementation Plan

> **For agentic workers:** Use supported Codex collaboration for a focused implementation owner and an independent review. The user approved the narrower Work-only scope; proceed with local implementation/tests. Do not edit Home.tsx or home.css, commit, create a PR or deploy.

**Goal:** Improve the Work index's project-name search and query-only clear while preserving combined filters, and connect two new catalog records only to verified standalone demos.

**Architecture:** Preserve the existing `/work?q=` flow. A small pure matcher supplies results and facet counts. An optional catalog demo URL overrides the existing showcase fallback in the two detail links.

**Tech Stack:** React 19, React Router 7, TypeScript 6, Vite 8, existing CSS, Node test/assert, development-only playwright-core 1.63.0 with existing Chrome.

## Global constraints

- Spec: `docs/superpowers/specs/2026-09-29-project-search-design.md`; Work-only scope is approved.
- Frozen base: `a9d9c6eebcf6e86bb6a753bf6a0c6b4dd2aa0df3`; branch `say5/project-search-20260929`.
- Own only `/private/tmp/portfolio-search.LIMN8L/Portfolio`; preserve all other checkouts and owners.
- No Home.tsx/home.css changes, commit, PR, deployment, credentials, environment-file reads or shared showcases catalog changes.
- Keep substring/phrase matching and AND-combined query/category/language semantics. No fuzzy search, runtime search dependency, new ranking, copied demos or guessed public URLs.
- Preserve the existing engine declaration and CI Node 20. All dependency operations use `--ignore-scripts`; playwright-core 1.63.0 supports Node 20.
- Before a UI edit, read Impeccable's craft-floor reference. Preserve the current graphite/lime styling and native form behavior. Visual QA is one batched desktop/mobile pass plus at most one confirmation pass.

## Task 1: Prove and fix catalog text matching

**Files:** `src/lib/projectSearch.ts`, `src/pages/Work.tsx`, `tests/project-search.test.mjs`, `tests/portfolio-search.browser.mjs`, `package.json`, `package-lock.json`.

**Interface:** `matchesProjectQuery(project: Pick<Project, 'name' | 'title' | 'tagline' | 'summary' | 'category' | 'language' | 'stack'>, rawQuery: string): boolean`. It normalizes the query internally and does not mutate the project.

- [x] Confirm approval and clean baseline, then review package/lock lifecycle metadata. Install `npm install --save-dev --save-exact --ignore-scripts playwright-core@1.63.0`; use `npm ci --ignore-scripts` for clean repeatability. Never download Chrome through package hooks.
- [x] Write a browser regression against the unchanged built site: visit `/work?q=scanguard`; assert that `/p/scanguard` is among visible project links. Its repository name is absent from the current matcher's text fields. Run `npm run build` and `node --test tests/portfolio-search.browser.mjs`; record the expected result-absence failure before modifying the matcher.
- [x] Browser harness requirements: launch only an explicit Chrome executable in a fresh temporary profile, use Vite's preview server on `127.0.0.1` with an assigned port to serve `dist`, capture page errors, and close the owned browser/server in teardown. Never attach to personal tabs. Run browser cases serially.
- [x] Extract the current matcher into the stated pure interface and add `project.name` to the text fields. Update Work result and both facet-count calculations to use it, preserving URL handling, deferred query, category/language checks and sort.
- [x] Add independent pure cases with a hand-authored object whose repo name appears nowhere else:

```js
const project = {
  name: 'scan-sequencer', title: 'Instrument Control',
  tagline: 'Coordinate devices', summary: 'A scanner preflight service',
  category: 'Instrumentation and Test', language: 'Go',
  stack: ['Go', 'C++', 'React'],
};
for (const [query, expected] of [
  ['scan-sequencer', true], ['  SCAN-SEQUENCER  ', true],
  ['preflight service', true], ['c++', true], ['react', true],
  ['', true], ['   ', true], ['does-not-exist', false],
  ['[', false], ['C#', false],
]) {
  assert.equal(matchesProjectQuery(project, query), expected, query);
}
```

- [x] Run pure tests using the existing TypeScript compiler's transpileModule and Node test/assert, then browser regression; record GREEN. Add scripts `test:search` and `test:browser` so a clean checkout can repeat them without external test-library state.

## Task 2: Accessible query-only filter recovery

**Files:** `src/pages/Work.tsx`, `src/styles/work.css`, `tests/portfolio-search.browser.mjs`.

**Interface:** Work's `Clear search` action removes only `q` and focuses its input. Existing URL parsing and labeled search input remain unchanged.

- [x] Write a failing real-browser case for query-only clear before UI changes. Directly visit `/work?q=preflight&c=Instrumentation%20and%20Test&l=Go&sort=name`, require the existing result, activate Clear search, and assert only q is removed and focus returns to the input.
- [x] Test Work query editing and reload with `C++`; inspect decoded URLSearchParams, not string escaping. Blank/whitespace query matches all projects within the remaining filters.
- [x] Add combined-filter cases using literal URL input:

```js
const query = new URLSearchParams({
  q: 'declarative checklist', c: 'Instrumentation and Test', l: 'Go', sort: 'name',
});
await page.goto(`${origin}/work?${query}`);
// Assert /p/scanguard is visible and the result live region reports a match.
// Change l to Python: no project row matches; empty recovery is visible.
// Restore l=Go, then activate Clear search: q is absent, c/l/sort remain,
// and document.activeElement is the Work search input.
```

- [x] Run these new cases and record the expected failure: query-only clear absent. Existing combined-filter behavior should remain passing as a regression baseline.
- [x] Add query-only clear to Work using its existing `update({q: null})` and `inputRef.current?.focus()`. Keep the existing Clear-all and empty-state actions unchanged.
- [x] Style with existing variables, hairline controls and inherited font. Keep the field `min-width: 0`, allow input/button wrapping at 390px, make clear comfortably keyboard/touch operable, and retain visible `:focus-visible`/`:focus-within` styling. No new animation.
- [x] Run the browser cases at 1440px and 390px. Assert no horizontal overflow, visible focus, result count updates, recovery from an unknown query, preserved category/language/sort and unchanged project navigation. Capture both viewport screenshots in one pass.

## Task 3: Explicit demo destination and verified catalog records

**Files:** `src/data/projects.ts`, `src/lib/projectLinks.ts`, `src/pages/Detail.tsx`, `tests/project-search.test.mjs`, `tests/portfolio-search.browser.mjs`.

**External gate:** implement/test the optional URL override locally, but stop catalog insertion until the coordinator provides KernelCheck and RankFault's verified public HTTPS URLs, deployed revisions and approved descriptive copy. The URL values are external acceptance inputs, not values this worker may infer. Neither new record is selected homepage work.

**Interface:** optional `Project.demoUrl?: string`; `getProjectDemoUrl(project: { name: string; demoUrl?: string }): string` resolves `project.demoUrl ?? \`https://showcases-lime.vercel.app/${project.name}\`` for both detail links.

- [x] Once the external gate is satisfied, write a failing browser case for each new detail route. Assert the correct heading and that both outbound app links equal the coordinator-provided literal URL. Record RED before adding records.
- [x] Add the optional field and replace the single `showcaseUrl` computation in Detail. Keep the existing source link and fallback destination unchanged for all existing records.
- [x] Add exactly the two approved catalog records. Reuse current categories/stack fields and preserve honest CPU-port versus recorded-replay distinctions. Do not change the curated selected list or create `src/demos/kernelcheck.tsx` or `src/demos/rankfault.tsx`.
- [x] Run the new browser cases plus an existing `/p/scanguard` fallback-link case. Verify both names are found from Work and that existing filters remain correct. The coordinator separately verifies the remote app interactions and deployment revision; a successful HTTP response alone is not acceptance.

## Task 4: Reproducible gates and handoff

**Files:** `.github/workflows/ci.yml`, `package.json`, `README.md`, test files changed above.

- [x] Add approved test scripts to the existing CI Node 20 job, change dependency installation to `npm ci --ignore-scripts`, retain lint/typecheck/build, and run pure/browser tests with an explicit installed Chrome executable. Do not add installer downloads as a hidden fallback.
- [x] Run `npm run test:search`, `npm run lint`, `npm run build`, then `npm run test:browser` serially. Record command, exit and commit/base revision; do not claim baseline results apply to the new code.
- [x] Inspect the completed UI once with desktop/mobile screenshots, then run the inspected Impeccable detector once over changed UI files. Fix concrete defects in one batch and use at most one confirming screenshot pass. Do not rewrite unrelated visual systems or legacy catalog copy.
- [x] Review `git diff --check`, exact diff scope and installed-package lifecycle metadata. Confirm no credentials, private browser data, generated profiles or dependencies are tracked.
- [x] Return changed files, RED/GREEN results, remaining external gates and preview screenshots to the coordinator. Leave publication, commits and PR creation to separately authorized coordination.

## Plan self-review

- Coverage: name/description/technology matching, existing AND filters, URL state, query-only and all-filter clear, empty recovery, accessibility, responsive behavior and two verified demo links each have an explicit task. The homepage is explicitly excluded by the user's decision.
- Interface consistency: a single matcher supplies result/facet behavior; `demoUrl` is optional and used only for explicit verified destinations; no standalone code is copied into the portfolio.
- Scope: only owned Portfolio code/tests and planning docs; no shared showcases writes or remote changes.
- Current status: local implementation and verification complete; publication remains coordinator-owned. The execution checkpoints below record actual evidence rather than treating a checked plan as a test result.

## Local verification checkpoint before catalog insertion

- Browser RED on the unchanged build: repository-name search returned zero instead of one; query-only clear was absent at both 1440px and 390px. Existing combined filters, query editing and old demo destinations passed. An initial overly broad `preflight` fixture also matched a Python project; the fixture was narrowed to the independently inspected `declarative checklist` phrase before recording the valid RED baseline.
- Pure RED against extracted baseline behavior: repository-name/partial-name assertions failed and explicit demo URL returned the old fallback. These were assertion failures, not just the earlier missing-module setup failures.
- First visual inspection found the clear button overflowing at 390px. The new nonempty-query overflow assertion failed, then passed after constraining the search flex item's min/max width. The confirming desktop/mobile screenshots fit their viewport.
- Current local checks: 3 pure tests pass; 6 browser tests pass; lint and production build exit 0; `git diff --check` exits 0. The build retains its pre-existing large-chunk warning. Impeccable's one mechanical scan returned no findings.
- Screenshots: `/private/tmp/portfolio-search-shots.wwLP1h/work-search-390.png` and `/private/tmp/portfolio-search-shots.wwLP1h/work-search-1440.png`.
- No `Home.tsx`, `home.css`, shared showcases file or selected-project list change. No commits, PRs, deployments or public-demo acceptance are claimed here. The two catalog records remain gated on coordinator-supplied URLs.

## Final local handoff checkpoint

- The earlier checkpoint above is historical: the coordinator subsequently supplied both verified URLs and observed deployment receipts, now recorded in the spec. RankFault and KernelCheck were each added only after their individual missing-result browser regression failed with `0 !== 1`.
- Both explicit destinations are now covered in the built-site browser suite: `https://say5-rankfault.vercel.app/` and `https://say5-kernelcheck.vercel.app/`. Each case navigates from Work to the detail page, checks both outbound app links and asserts the replay/CPU-model caveat. KernelCheck's detail case runs at 390px and checks overflow.
- Final serial run: `npm run test:search` (3/3), `npm run lint`, `npm run build -- --logLevel warn`, `npm run test:browser` (8/8), then `git diff --check`; all exited 0. The existing large-chunk warning remains. Local runtime was Node 26.7.0; CI remains configured for Node 20, and hosted CI has not been run by this worker.
- Catalog count is 167, up from 165. Both new records use `isFlagship: false`; the curated selected list and Home component/styles are unchanged. Removed stale hard-coded 153-project and eleven-selected counts from README/HTML descriptions rather than adding another brittle total.
- Source remains uncommitted on `say5/project-search-20260929` above base `a9d9c6eebcf6e86bb6a753bf6a0c6b4dd2aa0df3`. No remote writes or shared showcases changes. Coordinator retains integration, publication and public Portfolio acceptance.
