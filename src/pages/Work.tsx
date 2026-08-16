import {
  useMemo,
  useEffect,
  useRef,
  useDeferredValue,
  useCallback,
} from "react";
import { useSearchParams } from "react-router-dom";
import ProjectRow from "../components/ProjectRow";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { projects, categories, languages } from "../data/projects";
import "../styles/work.css";

type Sort = "featured" | "name";

const indexOf = new Map(projects.map((p, i) => [p.name, i + 1]));

function matchesQuery(p: (typeof projects)[number], q: string) {
  if (!q) return true;
  const hay = [
    p.title,
    p.tagline,
    p.summary,
    p.category,
    p.language,
    ...p.stack,
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export default function Work() {
  useDocumentTitle("Work");
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const category = params.get("c");
  const language = params.get("l");
  const sort: Sort = params.get("sort") === "name" ? "name" : "featured";
  const inputRef = useRef<HTMLInputElement>(null);

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  // "/" focuses search from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT")
      )
        return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const deferredQuery = useDeferredValue(query);
  const q = deferredQuery.trim().toLowerCase();

  const visible = useMemo(() => {
    const filtered = projects.filter(
      (p) =>
        (!category || p.category === category) &&
        (!language || p.language === language) &&
        matchesQuery(p, q),
    );
    return filtered.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      return b.flagshipScore - a.flagshipScore || a.name.localeCompare(b.name);
    });
  }, [q, category, language, sort]);

  // Facet counts respect the other active filter and the query.
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of projects) {
      if (language && p.language !== language) continue;
      if (!matchesQuery(p, q)) continue;
      m.set(p.category, (m.get(p.category) ?? 0) + 1);
    }
    return m;
  }, [language, q]);
  const languageCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of projects) {
      if (category && p.category !== category) continue;
      if (!matchesQuery(p, q)) continue;
      m.set(p.language, (m.get(p.language) ?? 0) + 1);
    }
    return m;
  }, [category, q]);

  const active = Boolean(category || language || query.trim());
  const listKey = `${category ?? ""}|${language ?? ""}|${sort}`;

  return (
    <div className="work">
      <header className="work__head wrap">
        <h1 className="work__metric">
          <span className="metric work__count">{projects.length}</span>
          <span className="work__metric-cap">
            public
            <br />
            repos
          </span>
        </h1>
        <p className="work__lede">
          Filter by category or language, or search. Each row opens a summary
          and notes, and usually a live demo.
        </p>
      </header>

      <div className="wrap">
        <div className="work__controls">
          <label className="work__search">
            <span className="work__search-label">Search</span>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => update({ q: e.target.value })}
              placeholder="name, language, or stack"
              name="q"
              inputMode="search"
              spellCheck={false}
              aria-label="Search projects"
              className="work__input"
              autoComplete="off"
            />
          </label>

          <div className="work__sort" role="group" aria-label="Sort">
            <span className="work__sort-label">Sort</span>
            <button
              type="button"
              className={`work__sort-btn ${sort === "featured" ? "is-active" : ""}`}
              aria-pressed={sort === "featured"}
              onClick={() => update({ sort: null })}
            >
              Featured first
            </button>
            <button
              type="button"
              className={`work__sort-btn ${sort === "name" ? "is-active" : ""}`}
              aria-pressed={sort === "name"}
              onClick={() => update({ sort: "name" })}
            >
              A to Z
            </button>
          </div>
        </div>
      </div>

      <div className="work__filters wrap">
        <div className="facet" role="group" aria-label="Category">
          <span className="facet__label">Category</span>
          <div className="facet__items">
            <button
              type="button"
              className={`facet__btn ${category === null ? "is-active" : ""}`}
              aria-pressed={category === null}
              onClick={() => update({ c: null })}
            >
              All
            </button>
            {categories.map((c) => {
              const n = categoryCounts.get(c) ?? 0;
              return (
                <button
                  key={c}
                  type="button"
                  className={`facet__btn ${category === c ? "is-active" : ""} ${n === 0 ? "is-empty" : ""}`}
                  aria-pressed={category === c}
                  onClick={() => update({ c: category === c ? null : c })}
                >
                  {c}
                  <span className="facet__count mono num">{n}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="facet" role="group" aria-label="Language">
          <span className="facet__label">Language</span>
          <div className="facet__items">
            <button
              type="button"
              className={`facet__btn ${language === null ? "is-active" : ""}`}
              aria-pressed={language === null}
              onClick={() => update({ l: null })}
            >
              All
            </button>
            {languages.map((l) => {
              const n = languageCounts.get(l) ?? 0;
              return (
                <button
                  key={l}
                  type="button"
                  className={`facet__btn ${language === l ? "is-active" : ""} ${n === 0 ? "is-empty" : ""}`}
                  aria-pressed={language === l}
                  onClick={() => update({ l: language === l ? null : l })}
                >
                  {l}
                  <span className="facet__count mono num">{n}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="work__status wrap" aria-live="polite">
        <span className="work__shown mono">
          {active
            ? `${visible.length} of ${projects.length}`
            : `${projects.length} projects`}
        </span>
        {active && (
          <button
            type="button"
            className="work__clear tlink"
            onClick={() => setParams({}, { replace: true })}
          >
            Clear
          </button>
        )}
      </div>

      <div className="wrap">
        {visible.length === 0 ? (
          <div className="work__empty">
            <p className="work__empty-title">Nothing matches that.</p>
            <p className="work__empty-sub">
              Try a shorter search, or{" "}
              <button
                type="button"
                className="tlink work__empty-clear"
                onClick={() => setParams({}, { replace: true })}
              >
                clear the filters
              </button>{" "}
              and start again.
            </p>
          </div>
        ) : (
          <ol className="rows" key={listKey}>
            {visible.map((p, i) => (
              <ProjectRow
                key={p.name}
                project={p}
                number={indexOf.get(p.name) ?? i + 1}
                animIndex={i}
              />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
