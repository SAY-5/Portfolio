import { useReducedMotion } from 'framer-motion';
import { useRef, useState } from 'react';
import '../styles/demo.css';
import './localebridge.css';
import {
  addKey,
  addLocale,
  deleteKey,
  editBaseValue,
  removeLocale,
  resetCatalog,
  setTranslation,
  useCatalog,
} from './localebridge/store';
import {
  collectIssues,
  computeStats,
  effectiveStatus,
  exportLocale,
  exportSummary,
} from './localebridge/engine';
import type { CatalogKey, TranslationStatus } from './localebridge/types';

// ---- small helpers ----

function statusLabel(s: TranslationStatus): string {
  if (s === 'translated') return 'ok';
  if (s === 'stale') return 'stale';
  if (s === 'placeholder_mismatch') return 'mismatch';
  return 'missing';
}

function statusClass(s: TranslationStatus): string {
  if (s === 'translated') return 'lbapp__st--ok';
  if (s === 'stale') return 'lbapp__st--stale';
  if (s === 'placeholder_mismatch') return 'lbapp__st--mismatch';
  return 'lbapp__st--missing';
}

// ---- sub-components ----

type KeyRowProps = {
  k: CatalogKey;
  activeLocale: string;
  onEdit: (id: string, base: string) => void;
};

function KeyRow({ k, activeLocale, onEdit }: KeyRowProps) {
  const [editingBase, setEditingBase] = useState(false);
  const [draftBase, setDraftBase] = useState(k.baseValue);
  const [draftTx, setDraftTx] = useState(
    k.translations[activeLocale]?.value ?? '',
  );
  const baseRef = useRef<HTMLInputElement>(null);

  const entry = k.translations[activeLocale];
  const txStatus: TranslationStatus = entry?.value
    ? effectiveStatus(entry, k.baseRevision)
    : 'untranslated';

  function commitBase() {
    if (draftBase.trim() && draftBase.trim() !== k.baseValue) {
      onEdit(k.id, draftBase.trim());
    }
    setEditingBase(false);
  }

  function commitTx(val: string) {
    setDraftTx(val);
    setTranslation(k.id, activeLocale, val);
  }

  return (
    <div className="lbapp__row" role="row">
      <div className="lbapp__row-key" aria-label="key name">
        <code className="lbapp__key-name">{k.key}</code>
        <button
          className="lbapp__icon-btn"
          aria-label={`Delete key ${k.key}`}
          onClick={() => deleteKey(k.id)}
        >
          x
        </button>
      </div>

      <div className="lbapp__row-base" aria-label="base value">
        {editingBase ? (
          <input
            ref={baseRef}
            className="lbapp__input"
            value={draftBase}
            onChange={(e) => setDraftBase(e.target.value)}
            onBlur={commitBase}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitBase();
              if (e.key === 'Escape') {
                setDraftBase(k.baseValue);
                setEditingBase(false);
              }
            }}
            aria-label={`Edit base value for ${k.key}`}
          />
        ) : (
          <button
            className="lbapp__value-btn"
            onClick={() => {
              setDraftBase(k.baseValue);
              setEditingBase(true);
              setTimeout(() => baseRef.current?.focus(), 0);
            }}
            aria-label={`Base value: ${k.baseValue}. Click to edit.`}
          >
            {k.baseValue}
          </button>
        )}
      </div>

      <div className="lbapp__row-tx" aria-label={`Translation for ${activeLocale}`}>
        <input
          className="lbapp__input"
          value={draftTx}
          placeholder="Enter translation..."
          onChange={(e) => commitTx(e.target.value)}
          aria-label={`Translation of ${k.key} into ${activeLocale}`}
        />
      </div>

      <div className="lbapp__row-status" aria-label="status">
        <span className={`lbapp__st ${statusClass(txStatus)}`}>
          {statusLabel(txStatus)}
        </span>
      </div>
    </div>
  );
}

// ---- main component ----

type Tab = 'catalog' | 'health' | 'export';

export default function LocalebridgeDemo() {
  const reduce = useReducedMotion();
  const catalog = useCatalog();
  const [tab, setTab] = useState<Tab>('catalog');
  const [activeLocale, setActiveLocale] = useState<string>(
    catalog.locales[0] ?? 'es',
  );
  const [newKey, setNewKey] = useState('');
  const [newBase, setNewBase] = useState('');
  const [newLocale, setNewLocale] = useState('');
  const [copied, setCopied] = useState(false);

  const stats = computeStats(catalog);
  const issues = collectIssues(catalog);

  // Keep activeLocale valid when locales change.
  const safeLocale = catalog.locales.includes(activeLocale)
    ? activeLocale
    : catalog.locales[0] ?? '';

  function handleAddKey(e: React.FormEvent) {
    e.preventDefault();
    addKey(newKey, newBase);
    setNewKey('');
    setNewBase('');
  }

  function handleAddLocale(e: React.FormEvent) {
    e.preventDefault();
    addLocale(newLocale);
    setNewLocale('');
  }

  function handleCopy() {
    const json = JSON.stringify(exportLocale(catalog, safeLocale), null, 2);
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  const summary = exportSummary(catalog, safeLocale);
  const exportJson = JSON.stringify(exportLocale(catalog, safeLocale), null, 2);

  return (
    <div
      className="demo lbapp"
      aria-label="localebridge translation management demo"
      data-reduce={reduce ? 'true' : 'false'}
    >
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Localebridge</h3>
      <p className="demo__lede">
        Manage a translation catalog in your browser. Add keys with base
        (English) values, translate them per locale, and see live completeness
        and validation. Stale keys highlight when the base value changes after a
        translation was set. Placeholder tokens must match or the entry is
        flagged. Export merged JSON for any locale.
      </p>

      {/* Tabs */}
      <div className="lbapp__tabs" role="tablist" aria-label="App sections">
        {(['catalog', 'health', 'export'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`lbapp__tab${tab === t ? ' lbapp__tab--on' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ---- CATALOG TAB ---- */}
      {tab === 'catalog' && (
        <div className="lbapp__panel">
          {/* locale switcher */}
          <div className="lbapp__locale-row" role="group" aria-label="Target locale">
            <span className="lbapp__locale-label">locale:</span>
            {catalog.locales.map((l) => (
              <button
                key={l}
                className={`lbapp__locale-btn${safeLocale === l ? ' lbapp__locale-btn--on' : ''}`}
                onClick={() => setActiveLocale(l)}
                aria-pressed={safeLocale === l}
              >
                {l}
              </button>
            ))}
            <form
              className="lbapp__add-locale-form"
              onSubmit={handleAddLocale}
              aria-label="Add target locale"
            >
              <input
                className="lbapp__input lbapp__input--sm"
                value={newLocale}
                onChange={(e) => setNewLocale(e.target.value)}
                placeholder="+ locale"
                aria-label="New locale code"
                maxLength={12}
              />
              <button
                className="lbapp__ghost-btn"
                type="submit"
                aria-label="Add locale"
              >
                Add
              </button>
            </form>
            {catalog.locales.length > 1 && (
              <button
                className="lbapp__ghost-btn lbapp__ghost-btn--danger"
                onClick={() => removeLocale(safeLocale)}
                aria-label={`Remove locale ${safeLocale}`}
              >
                Remove {safeLocale}
              </button>
            )}
          </div>

          {/* column headers */}
          <div className="lbapp__header" role="rowgroup" aria-hidden="true">
            <span>key</span>
            <span>base (en)</span>
            <span>{safeLocale}</span>
            <span>status</span>
          </div>

          {/* key rows */}
          <div className="lbapp__rows" role="table" aria-label="Translation keys">
            {catalog.keys.length === 0 && (
              <p className="lbapp__empty">No keys yet. Add one below.</p>
            )}
            {catalog.keys.map((k) => (
              <KeyRow
                key={k.id + safeLocale}
                k={k}
                activeLocale={safeLocale}
                onEdit={editBaseValue}
              />
            ))}
          </div>

          {/* add key form */}
          <form className="lbapp__add-form" onSubmit={handleAddKey} aria-label="Add new key">
            <input
              className="lbapp__input"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="key.name"
              aria-label="New key name"
              maxLength={80}
            />
            <input
              className="lbapp__input lbapp__input--wide"
              value={newBase}
              onChange={(e) => setNewBase(e.target.value)}
              placeholder="Base value (English)"
              aria-label="Base value"
              maxLength={200}
            />
            <button
              className="demo__btn"
              type="submit"
              disabled={!newKey.trim() || !newBase.trim()}
            >
              Add key
            </button>
          </form>
        </div>
      )}

      {/* ---- HEALTH TAB ---- */}
      {tab === 'health' && (
        <div className="lbapp__panel">
          <div className="lbapp__health-grid">
            {stats.map((s) => (
              <div
                key={s.locale}
                className={`lbapp__health-card${s.percent === 100 ? ' lbapp__health-card--full' : s.percent < 50 ? ' lbapp__health-card--low' : ''}`}
              >
                <div className="lbapp__health-head">
                  <span className="lbapp__health-code">{s.locale}</span>
                  <span className="lbapp__health-pct">{s.percent}%</span>
                </div>
                <div
                  className="lbapp__bar-track"
                  role="progressbar"
                  aria-valuenow={s.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${s.locale} completeness ${s.percent}%`}
                >
                  <div
                    className="lbapp__bar-fill"
                    style={{ width: `${s.percent}%` }}
                  />
                </div>
                <div className="lbapp__health-counts">
                  <span className="lbapp__hc lbapp__hc--ok">{s.translated} ok</span>
                  {s.missing > 0 && (
                    <span className="lbapp__hc lbapp__hc--missing">{s.missing} missing</span>
                  )}
                  {s.stale > 0 && (
                    <span className="lbapp__hc lbapp__hc--stale">{s.stale} stale</span>
                  )}
                  {s.mismatch > 0 && (
                    <span className="lbapp__hc lbapp__hc--mismatch">{s.mismatch} mismatch</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {issues.length === 0 ? (
            <div className="lbapp__all-good">
              All keys translated across all locales.
            </div>
          ) : (
            <div className="lbapp__issues" aria-label="Validation issues">
              <div className="lbapp__issues-head">
                {issues.length} issue{issues.length !== 1 ? 's' : ''}
              </div>
              <ul className="lbapp__issue-list">
                {issues.map((issue, i) => (
                  <li
                    key={i}
                    className={`lbapp__issue lbapp__issue--${issue.kind}`}
                  >
                    <span className="lbapp__issue-kind">{issue.kind}</span>
                    <span className="lbapp__issue-key">{issue.key}</span>
                    <span className="lbapp__issue-locale">[{issue.locale}]</span>
                    <span className="lbapp__issue-detail">{issue.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ---- EXPORT TAB ---- */}
      {tab === 'export' && (
        <div className="lbapp__panel">
          <div className="lbapp__export-locale-row" role="group" aria-label="Export locale">
            <span className="lbapp__locale-label">export locale:</span>
            {catalog.locales.map((l) => (
              <button
                key={l}
                className={`lbapp__locale-btn${safeLocale === l ? ' lbapp__locale-btn--on' : ''}`}
                onClick={() => setActiveLocale(l)}
                aria-pressed={safeLocale === l}
              >
                {l}
              </button>
            ))}
          </div>

          {/* dry validation summary */}
          <div className="lbapp__export-summary" aria-label="Validation summary">
            <div className="lbapp__export-summary-head">Dry-run validation</div>
            <ul className="lbapp__summary-list">
              {summary.map((row) => (
                <li key={row.key} className="lbapp__summary-row">
                  <code className="lbapp__key-name">{row.key}</code>
                  <span className={`lbapp__st ${statusClass(row.status)}`}>
                    {statusLabel(row.status)}
                  </span>
                  <span className="lbapp__summary-value">{row.value}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* JSON output */}
          <div className="lbapp__export-block">
            <div className="lbapp__export-head">
              <span>{safeLocale}.json</span>
              <button
                className="lbapp__ghost-btn"
                onClick={handleCopy}
                aria-label="Copy JSON to clipboard"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="lbapp__json" aria-label="Exported JSON">{exportJson}</pre>
          </div>

          <div className="demo__controls">
            <button
              className="demo__btn demo__btn--ghost"
              onClick={() => {
                resetCatalog();
                setActiveLocale('es');
                setTab('catalog');
              }}
              aria-label="Reset catalog to defaults"
            >
              Reset catalog
            </button>
            <span className="demo__hint">
              Clears localStorage and restores defaults.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
