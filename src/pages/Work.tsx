import { useMemo, useState, useDeferredValue } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import ProjectTile from '../components/ProjectTile';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { projects, categories, languages } from '../data/projects';
import '../styles/work.css';

type Sort = 'flagship' | 'name';

export default function Work() {
  useDocumentTitle('Work');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('flagship');

  const deferredQuery = useDeferredValue(query);

  const visible = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const filtered = projects.filter((p) => {
      if (category && p.category !== category) return false;
      if (language && p.language !== language) return false;
      if (!q) return true;
      const haystack = [p.title, p.tagline, p.summary, p.category, ...p.stack]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });

    return [...filtered].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      return b.flagshipScore - a.flagshipScore || a.name.localeCompare(b.name);
    });
  }, [deferredQuery, category, language, sort]);

  const activeFilters = Boolean(category || language || query.trim());

  return (
    <div className="work">
      <header className="work__head wrap">
        <p className="eyebrow">The work</p>
        <h1 className="work__title">
          Every project,{' '}
          <span className="work__count mono">{projects.length}</span> in all
        </h1>
        <p className="work__sub">
          Filter by category or language, search across titles and stacks, and
          sort. Each tile opens a full write-up.
        </p>
      </header>

      <div className="work__controls wrap">
        <div className="work__search">
          <span className="work__search-icon" aria-hidden="true">
            &#9906;
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, stacks, ideas"
            aria-label="Search projects"
            className="work__input"
          />
        </div>

        <div className="work__sort">
          <label htmlFor="sort" className="work__sort-label mono">
            Sort
          </label>
          <select
            id="sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="work__select"
          >
            <option value="flagship">Flagship score</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      <div className="work__filters wrap" role="group" aria-label="Filters">
        <div className="filter-row">
          <span className="filter-row__label mono">Category</span>
          <div className="chips-scroll">
            <button
              type="button"
              className={`filter-chip ${category === null ? 'is-active' : ''}`}
              onClick={() => setCategory(null)}
              aria-pressed={category === null}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`filter-chip ${category === c ? 'is-active' : ''}`}
                onClick={() => setCategory(category === c ? null : c)}
                aria-pressed={category === c}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-row">
          <span className="filter-row__label mono">Language</span>
          <div className="chips-scroll">
            <button
              type="button"
              className={`filter-chip ${language === null ? 'is-active' : ''}`}
              onClick={() => setLanguage(null)}
              aria-pressed={language === null}
            >
              All
            </button>
            {languages.map((l) => (
              <button
                key={l}
                type="button"
                className={`filter-chip ${language === l ? 'is-active' : ''}`}
                onClick={() => setLanguage(language === l ? null : l)}
                aria-pressed={language === l}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="work__statusbar wrap" aria-live="polite">
        <span className="work__shown mono">
          {visible.length} {visible.length === 1 ? 'project' : 'projects'}
        </span>
        {activeFilters && (
          <button
            type="button"
            className="work__clear"
            onClick={() => {
              setQuery('');
              setCategory(null);
              setLanguage(null);
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="work__grid-wrap wrap">
        {visible.length === 0 ? (
          <p className="work__empty">
            Nothing matches that yet. Try a broader search or clear the filters.
          </p>
        ) : (
          <LayoutGroup>
            <motion.div layout className="work__grid">
              <AnimatePresence mode="popLayout">
                {visible.map((p, i) => (
                  <ProjectTile key={p.name} project={p} index={i} />
                ))}
              </AnimatePresence>
            </motion.div>
          </LayoutGroup>
        )}
      </div>
    </div>
  );
}
