import { useCallback, useMemo, useState } from 'react';
import '../styles/demo.css';
import './equipfleet.css';
import { useStore } from './equipfleet/state';
import type { Asset, AssetCategory, AssetStatus, SortDir, SortField } from './equipfleet/types';
import {
  filterByCategory,
  filterByStatus,
  searchAssets,
  sortAssets,
  maintenanceDue,
  statusSummary,
  canTransition,
} from './equipfleet/engine';
import {
  assignAsset,
  completeMaintenance,
  retireAsset,
  scheduleMaintenance,
  unassignAsset,
  resetAll,
} from './equipfleet/store';

// ---- constants ----

const STATUSES: AssetStatus[] = ['available', 'assigned', 'maintenance', 'retired'];
const CATEGORIES: AssetCategory[] = ['vehicle', 'machinery', 'electronics', 'tools', 'safety', 'other'];

const STATUS_LABEL: Record<AssetStatus, string> = {
  available: 'Available',
  assigned: 'Assigned',
  maintenance: 'Maintenance',
  retired: 'Retired',
};

const CATEGORY_LABEL: Record<AssetCategory, string> = {
  vehicle: 'Vehicle',
  machinery: 'Machinery',
  electronics: 'Electronics',
  tools: 'Tools',
  safety: 'Safety',
  other: 'Other',
};

type View = 'list' | 'detail' | 'dashboard';

// ---- main component ----

export default function EquipfleetDemo() {
  const { assets } = useStore();

  // view state
  const [view, setView] = useState<View>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // list filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<AssetStatus | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<AssetCategory | 'all'>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // action feedback
  const [toast, setToast] = useState<string | null>(null);
  const [assignInput, setAssignInput] = useState('');
  const [confirmRetire, setConfirmRetire] = useState(false);

  // derived data
  const filtered = useMemo(() => {
    let list = searchAssets(assets, search);
    list = filterByStatus(list, statusFilter);
    list = filterByCategory(list, categoryFilter);
    return sortAssets(list, sortField, sortDir);
  }, [assets, search, statusFilter, categoryFilter, sortField, sortDir]);

  const counts = useMemo(() => statusSummary(assets), [assets]);
  const dueSoon = useMemo(() => maintenanceDue(assets), [assets]);
  const selected = useMemo(
    () => (selectedId ? assets.find((a) => a.id === selectedId) ?? null : null),
    [assets, selectedId],
  );

  // helpers
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  }, []);

  const openDetail = useCallback((id: string) => {
    setSelectedId(id);
    setAssignInput('');
    setConfirmRetire(false);
    setView('detail');
  }, []);

  const toggleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('asc');
      }
    },
    [sortField],
  );

  const handleAssign = useCallback(
    (asset: Asset) => {
      const name = assignInput.trim();
      if (!name) {
        showToast('Enter a name to assign this asset.');
        return;
      }
      if (assignAsset(asset.id, name)) {
        setAssignInput('');
        showToast(`Assigned to ${name}.`);
      } else {
        showToast(`Cannot assign from "${STATUS_LABEL[asset.status]}" status.`);
      }
    },
    [assignInput, showToast],
  );

  const handleUnassign = useCallback(
    (asset: Asset) => {
      if (unassignAsset(asset.id)) {
        showToast('Returned to available.');
      } else {
        showToast('Only assigned assets can be unassigned.');
      }
    },
    [showToast],
  );

  const handleCompleteMaintenance = useCallback(
    (asset: Asset) => {
      if (completeMaintenance(asset.id)) {
        showToast('Maintenance complete. Next date bumped 90 days.');
      } else {
        showToast('Asset is not in maintenance.');
      }
    },
    [showToast],
  );

  const handleScheduleMaintenance = useCallback(
    (asset: Asset) => {
      if (scheduleMaintenance(asset.id)) {
        showToast('Sent to maintenance.');
      } else {
        showToast(`Cannot send "${STATUS_LABEL[asset.status]}" to maintenance.`);
      }
    },
    [showToast],
  );

  const handleRetire = useCallback(
    (asset: Asset) => {
      if (retireAsset(asset.id)) {
        showToast('Asset retired.');
      } else {
        showToast('Retired assets cannot change status.');
      }
    },
    [showToast],
  );

  const handleReset = useCallback(() => {
    resetAll();
    setSelectedId(null);
    setView('list');
    showToast('Fleet data reset to defaults.');
  }, [showToast]);

  // ---- sort indicator ----
  const sortArrow = (field: SortField) => {
    if (sortField !== field) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  // ---- render ----

  return (
    <div className="demo efd" role="main" aria-label="EquipFleet asset manager">
      <span className="demo__tag">Working app</span>
      <h3 className="demo__title" id="efd-heading">EquipFleet, a fleet asset manager</h3>
      <p className="demo__lede">
        Track equipment across a construction fleet. Filter, sort, assign assets
        to people, schedule and complete maintenance, retire old gear, and view
        a dashboard of fleet health. Everything persists in your browser.
      </p>

      {/* navigation tabs */}
      <nav className="efd__nav" aria-label="App sections">
        <div className="efd__tabs" role="tablist">
          {(['list', 'dashboard'] as View[]).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v || (view === 'detail' && v === 'list')}
              className={`efd__tab${view === v || (view === 'detail' && v === 'list') ? ' efd__tab--on' : ''}`}
              onClick={() => {
                setView(v);
                if (v !== 'detail') setSelectedId(null);
              }}
            >
              {v === 'list' ? 'Fleet' : 'Dashboard'}
            </button>
          ))}
        </div>
      </nav>

      {/* toast */}
      {toast && (
        <div className="efd__toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}

      {/* ---- LIST VIEW ---- */}
      {(view === 'list' || view === 'detail') && view === 'list' && (
        <section className="efd__list" aria-label="Fleet list">
          {/* search + filters */}
          <div className="efd__filters">
            <input
              className="efd__search"
              type="search"
              placeholder="Search name, serial, assignee, location..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search assets"
            />
            <select
              className="efd__select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AssetStatus | 'all')}
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
            <select
              className="efd__select"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as AssetCategory | 'all')}
              aria-label="Filter by category"
            >
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
              ))}
            </select>
          </div>

          {/* table */}
          <div className="efd__table-wrap glass" role="region" aria-label="Asset table" tabIndex={0}>
            <table className="efd__table">
              <thead>
                <tr>
                  {([
                    ['name', 'Name'],
                    ['serial', 'Serial'],
                    ['category', 'Category'],
                    ['status', 'Status'],
                    ['nextMaintenance', 'Next Maint.'],
                  ] as [SortField, string][]).map(([f, label]) => (
                    <th key={f} scope="col">
                      <button
                        className="efd__sort-btn"
                        onClick={() => toggleSort(f)}
                        aria-label={`Sort by ${label}`}
                      >
                        {label}{sortArrow(f)}
                      </button>
                    </th>
                  ))}
                  <th scope="col">Assignee</th>
                  <th scope="col">Location</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="efd__empty">No matching assets.</td>
                  </tr>
                )}
                {filtered.map((a) => (
                  <tr
                    key={a.id}
                    className="efd__row"
                    onClick={() => openDetail(a.id)}
                    tabIndex={0}
                    role="button"
                    aria-label={`View ${a.name}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openDetail(a.id);
                      }
                    }}
                  >
                    <td className="efd__cell-name">{a.name}</td>
                    <td className="efd__cell-serial">{a.serial}</td>
                    <td>{CATEGORY_LABEL[a.category]}</td>
                    <td>
                      <span className={`efd__badge efd__badge--${a.status}`}>
                        {STATUS_LABEL[a.status]}
                      </span>
                    </td>
                    <td className="efd__cell-date">{a.nextMaintenance ?? 'N/A'}</td>
                    <td>{a.assignee ?? ''}</td>
                    <td>{a.location}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="efd__count">
            {filtered.length} of {assets.length} assets shown
          </p>
        </section>
      )}

      {/* ---- DETAIL VIEW ---- */}
      {view === 'detail' && selected && (
        <section className="efd__detail" aria-label={`Asset detail: ${selected.name}`}>
          <button
            className="efd__back"
            onClick={() => setView('list')}
            aria-label="Back to list"
          >
            Back to list
          </button>

          <div className="efd__detail-header">
            <h4 className="efd__detail-name">{selected.name}</h4>
            <span className={`efd__badge efd__badge--${selected.status}`}>
              {STATUS_LABEL[selected.status]}
            </span>
          </div>

          <dl className="efd__detail-grid glass">
            <div className="efd__dl-pair">
              <dt>ID</dt>
              <dd>{selected.id}</dd>
            </div>
            <div className="efd__dl-pair">
              <dt>Serial</dt>
              <dd>{selected.serial}</dd>
            </div>
            <div className="efd__dl-pair">
              <dt>Category</dt>
              <dd>{CATEGORY_LABEL[selected.category]}</dd>
            </div>
            <div className="efd__dl-pair">
              <dt>Location</dt>
              <dd>{selected.location}</dd>
            </div>
            <div className="efd__dl-pair">
              <dt>Assignee</dt>
              <dd>{selected.assignee ?? 'None'}</dd>
            </div>
            <div className="efd__dl-pair">
              <dt>Next maintenance</dt>
              <dd>{selected.nextMaintenance ?? 'Not scheduled'}</dd>
            </div>
            <div className="efd__dl-pair">
              <dt>Added</dt>
              <dd>{new Date(selected.createdAt).toLocaleDateString()}</dd>
            </div>
            <div className="efd__dl-pair">
              <dt>Valid transitions</dt>
              <dd>
                {STATUSES.filter((s) => canTransition(selected.status, s)).length === 0
                  ? 'None (terminal state)'
                  : STATUSES.filter((s) => canTransition(selected.status, s))
                      .map((s) => STATUS_LABEL[s])
                      .join(', ')}
              </dd>
            </div>
          </dl>

          {/* actions */}
          <div className="efd__actions glass" aria-label="Asset actions">
            <h5 className="efd__actions-title">Actions</h5>

            {selected.status === 'retired' && (
              <p className="efd__actions-note">Retired assets have no available actions.</p>
            )}

            {/* Assign */}
            {canTransition(selected.status, 'assigned') && (
              <div className="efd__action-row">
                <input
                  className="efd__assign-input"
                  type="text"
                  placeholder="Assignee name"
                  value={assignInput}
                  onChange={(e) => setAssignInput(e.target.value)}
                  aria-label="Assignee name"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAssign(selected);
                  }}
                />
                <button className="demo__btn" onClick={() => handleAssign(selected)}>
                  Assign
                </button>
              </div>
            )}

            {/* Unassign */}
            {selected.status === 'assigned' && (
              <button className="demo__btn demo__btn--ghost" onClick={() => handleUnassign(selected)}>
                Return to available
              </button>
            )}

            {/* Complete maintenance */}
            {selected.status === 'maintenance' && (
              <button className="demo__btn" onClick={() => handleCompleteMaintenance(selected)}>
                Complete maintenance
              </button>
            )}

            {/* Schedule maintenance */}
            {canTransition(selected.status, 'maintenance') && (
              <button className="demo__btn demo__btn--ghost" onClick={() => handleScheduleMaintenance(selected)}>
                Send to maintenance
              </button>
            )}

            {/* Retire (two-step confirmation) */}
            {canTransition(selected.status, 'retired') && !confirmRetire && (
              <button className="efd__retire-btn" onClick={() => setConfirmRetire(true)}>
                Retire asset
              </button>
            )}
            {canTransition(selected.status, 'retired') && confirmRetire && (
              <div className="efd__action-row">
                <span className="efd__confirm-label">Retire is permanent.</span>
                <button className="efd__retire-btn" onClick={() => handleRetire(selected)}>
                  Confirm retire
                </button>
                <button className="demo__btn demo__btn--ghost" onClick={() => setConfirmRetire(false)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ---- DASHBOARD VIEW ---- */}
      {view === 'dashboard' && (
        <section className="efd__dash" aria-label="Fleet dashboard">
          {/* fleet total */}
          <div className="efd__fleet-total glass">
            <span className="efd__fleet-total-count">{assets.length}</span>
            <span className="efd__fleet-total-label">total assets in fleet</span>
          </div>

          {/* summary cards */}
          <div className="efd__summary">
            {STATUSES.map((s) => (
              <div key={s} className={`efd__summary-card efd__summary-card--${s}`}>
                <span className="efd__summary-count">{counts[s]}</span>
                <span className="efd__summary-label">{STATUS_LABEL[s]}</span>
              </div>
            ))}
          </div>

          {/* maintenance alerts */}
          <div className="efd__alerts glass">
            <h5 className="efd__alerts-title">Maintenance due</h5>
            {dueSoon.length === 0 ? (
              <p className="efd__alerts-none">No assets overdue for maintenance.</p>
            ) : (
              <ul className="efd__alerts-list">
                {dueSoon.map((a) => (
                  <li key={a.id} className="efd__alert-item">
                    <button
                      className="efd__alert-link"
                      onClick={() => openDetail(a.id)}
                    >
                      <span className="efd__alert-name">{a.name}</span>
                      <span className="efd__alert-date">due {a.nextMaintenance}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* utilization */}
          <div className="efd__util glass">
            <h5 className="efd__util-title">Utilization breakdown</h5>
            <div className="efd__util-bar" role="img" aria-label="Status distribution bar">
              {STATUSES.map((s) => {
                const pct = assets.length > 0 ? (counts[s] / assets.length) * 100 : 0;
                if (pct === 0) return null;
                return (
                  <span
                    key={s}
                    className={`efd__util-seg efd__util-seg--${s}`}
                    style={{ width: `${pct}%` }}
                    title={`${STATUS_LABEL[s]}: ${counts[s]} (${pct.toFixed(0)}%)`}
                  />
                );
              })}
            </div>
            <div className="efd__util-legend">
              {STATUSES.map((s) => {
                const pct = assets.length > 0 ? (counts[s] / assets.length) * 100 : 0;
                return (
                  <span key={s} className="efd__util-legend-item">
                    <span className={`efd__util-dot efd__util-dot--${s}`} />
                    {STATUS_LABEL[s]} {pct.toFixed(0)}%
                  </span>
                );
              })}
            </div>
          </div>

          {/* category breakdown */}
          <div className="efd__catbreak glass">
            <h5 className="efd__catbreak-title">By category</h5>
            <div className="efd__catbreak-grid">
              {CATEGORIES.map((c) => {
                const n = assets.filter((a) => a.category === c).length;
                if (n === 0) return null;
                return (
                  <div key={c} className="efd__catbreak-item">
                    <span className="efd__catbreak-count">{n}</span>
                    <span className="efd__catbreak-label">{CATEGORY_LABEL[c]}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* controls */}
      <div className="demo__controls">
        <button className="demo__btn demo__btn--ghost" onClick={handleReset}>
          Reset fleet data
        </button>
        <span className="demo__hint">
          {assets.length} assets in localStorage
        </span>
      </div>
    </div>
  );
}
