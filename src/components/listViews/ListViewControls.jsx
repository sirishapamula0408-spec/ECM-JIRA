import { useEffect, useRef, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import {
  fetchListViews,
  createListView,
  updateListView,
  deleteListView,
  DEFAULT_COLUMNS,
  COLUMN_LABELS,
} from '../../api/listViewApi'
import './ListViewControls.css'

const ALL_COLUMNS = Object.keys(COLUMN_LABELS)

/**
 * Column picker (checkbox list + up/down reorder) and saved-views dropdown for
 * the issue list / search results (JL-122).
 *
 * Props:
 *  - columns: string[]  currently visible column keys (ordered)
 *  - onColumnsChange: (cols) => void
 *  - filterJql?: string  optional JQL to persist with a saved view
 *  - onApplyView?: (view) => void  called when a saved view is switched to
 */
export function ListViewControls({ columns, onColumnsChange, filterJql = null, onApplyView }) {
  const [views, setViews] = useState([])
  const [activeViewId, setActiveViewId] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [viewsOpen, setViewsOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const pickerRef = useRef(null)
  const viewsRef = useRef(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError('')
    fetchListViews()
      .then((data) => {
        if (!active) return
        setViews(Array.isArray(data) ? data : [])
      })
      .catch((err) => {
        if (!active) return
        setLoadError(err?.message || 'Could not load saved views')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  // Apply the user's default view (if any) once on first load.
  useEffect(() => {
    const def = views.find((v) => v.isDefault)
    if (def && activeViewId === null) {
      setActiveViewId(def.id)
      if (Array.isArray(def.columns) && def.columns.length) onColumnsChange(def.columns)
      if (onApplyView) onApplyView(def)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views])

  useEffect(() => {
    function onClick(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false)
      if (viewsRef.current && !viewsRef.current.contains(e.target)) setViewsOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function toggleColumn(key) {
    if (columns.includes(key)) {
      if (columns.length === 1) return // keep at least one column
      onColumnsChange(columns.filter((c) => c !== key))
    } else {
      onColumnsChange([...columns, key])
    }
    setActiveViewId(null)
  }

  function move(index, delta) {
    const next = [...columns]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onColumnsChange(next)
    setActiveViewId(null)
  }

  function resetColumns() {
    onColumnsChange([...DEFAULT_COLUMNS])
    setActiveViewId(null)
  }

  function applyView(view) {
    setActiveViewId(view.id)
    if (Array.isArray(view.columns) && view.columns.length) onColumnsChange(view.columns)
    if (onApplyView) onApplyView(view)
    setViewsOpen(false)
  }

  async function handleSaveView(e) {
    e.preventDefault()
    setError('')
    if (!saveName.trim()) { setError('View name is required'); return }
    setSaving(true)
    try {
      const created = await createListView({ name: saveName.trim(), columns, filterJql })
      setViews((prev) => [created, ...prev])
      setActiveViewId(created.id)
      setSaveName('')
    } catch (err) {
      setError(err.message || 'Could not save view')
    } finally {
      setSaving(false)
    }
  }

  async function handleSetDefault(view) {
    try {
      const updated = await updateListView(view.id, { isDefault: true })
      setViews((prev) => prev.map((v) => ({ ...v, isDefault: v.id === updated.id })))
    } catch (err) {
      setError(err?.message || 'Could not set default view')
    }
  }

  async function confirmDeleteView() {
    if (!deleteTarget) return
    setDeleteBusy(true)
    try {
      await deleteListView(deleteTarget.id)
      setViews((prev) => prev.filter((v) => v.id !== deleteTarget.id))
      if (activeViewId === deleteTarget.id) setActiveViewId(null)
      setDeleteTarget(null)
    } catch (err) {
      setError(err?.message || 'Could not delete view')
    } finally {
      setDeleteBusy(false)
    }
  }

  const activeView = views.find((v) => v.id === activeViewId)

  return (
    <div className="lvc">
      {/* Saved views dropdown */}
      <div className="lvc-dropdown" ref={viewsRef}>
        <button
          type="button"
          className="btn btn-ghost lvc-trigger"
          onClick={() => setViewsOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={viewsOpen}
        >
          {activeView ? `View: ${activeView.name}` : 'Views'}
          <span className="lvc-caret" aria-hidden="true">▾</span>
        </button>
        {viewsOpen && (
          <div className="lvc-menu">
            <div className="lvc-menu-title">Saved views</div>
            {loading ? (
              <div className="lvc-menu-empty" role="status">Loading views…</div>
            ) : loadError ? (
              <p className="lvc-error" role="alert">{loadError}</p>
            ) : views.length === 0 ? (
              <div className="lvc-menu-empty">No saved views yet</div>
            ) : (
              <ul className="lvc-view-list">
                {views.map((v) => (
                  <li key={v.id} className={`lvc-view-item ${v.id === activeViewId ? 'lvc-view-item--active' : ''}`}>
                    <button type="button" className="lvc-view-name" onClick={() => applyView(v)}>
                      {v.name}
                      {v.isDefault && <span className="lvc-default-badge">default</span>}
                    </button>
                    <span className="lvc-view-actions">
                      {!v.isDefault && (
                        <button type="button" className="link-btn" onClick={() => handleSetDefault(v)} title="Set as default" aria-label={`Set "${v.name}" as default view`}>★</button>
                      )}
                      <button type="button" className="link-btn lvc-del" onClick={() => setDeleteTarget(v)} title="Delete view" aria-label={`Delete view "${v.name}"`}>✕</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <form className="lvc-save-form" onSubmit={handleSaveView}>
              <input
                className="lvc-save-input"
                type="text"
                placeholder="Save current as…"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
              />
              <button className="btn btn-primary lvc-save-btn" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </form>
            {error && <p className="lvc-error" role="alert">{error}</p>}
          </div>
        )}
      </div>

      {/* Column picker dropdown */}
      <div className="lvc-dropdown" ref={pickerRef}>
        <button
          type="button"
          className="btn btn-ghost lvc-trigger"
          onClick={() => setPickerOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={pickerOpen}
        >
          Columns
          <span className="lvc-caret" aria-hidden="true">▾</span>
        </button>
        {pickerOpen && (
          <div className="lvc-menu lvc-menu--picker">
            <div className="lvc-menu-title">Visible columns</div>
            <ul className="lvc-col-list">
              {/* Selected columns first, in order, with reorder controls */}
              {columns.map((key, i) => (
                <li key={key} className="lvc-col-item">
                  <label className="lvc-col-label">
                    <input type="checkbox" checked onChange={() => toggleColumn(key)} />
                    {COLUMN_LABELS[key] || key}
                  </label>
                  <span className="lvc-col-reorder">
                    <button type="button" className="link-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Move up" aria-label={`Move ${COLUMN_LABELS[key] || key} up`}>↑</button>
                    <button type="button" className="link-btn" disabled={i === columns.length - 1} onClick={() => move(i, 1)} title="Move down" aria-label={`Move ${COLUMN_LABELS[key] || key} down`}>↓</button>
                  </span>
                </li>
              ))}
              {/* Unselected columns */}
              {ALL_COLUMNS.filter((k) => !columns.includes(k)).map((key) => (
                <li key={key} className="lvc-col-item lvc-col-item--off">
                  <label className="lvc-col-label">
                    <input type="checkbox" checked={false} onChange={() => toggleColumn(key)} />
                    {COLUMN_LABELS[key] || key}
                  </label>
                </li>
              ))}
            </ul>
            <button type="button" className="link-btn lvc-reset" onClick={resetColumns}>Reset to default</button>
          </div>
        )}
      </div>

      {/* In-app delete confirmation (replaces window.confirm) */}
      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => (deleteBusy ? null : setDeleteTarget(null))}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete view?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {deleteTarget ? `Delete the saved view "${deleteTarget.name}"? This cannot be undone.` : ''}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>Cancel</Button>
          <Button onClick={confirmDeleteView} color="error" variant="contained" disabled={deleteBusy}>
            {deleteBusy ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}

export default ListViewControls
