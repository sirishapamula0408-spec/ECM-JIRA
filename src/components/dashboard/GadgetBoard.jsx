import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchGadgetCatalog, fetchGadgetData } from '../../api/dashboardGadgetApi'
import { SvgBarChart } from '../charts/SvgBarChart'
import './GadgetBoard.css'

let idCounter = 0
const nextId = () => `g-${Date.now()}-${idCounter++}`

const BAR_FIELD = {
  issues_by_status: 'status',
  issues_by_assignee: 'assignee',
  issues_by_priority: 'priority',
}

/**
 * GadgetBoard — a configurable grid of dashboard gadgets (JL-152).
 * Persists the placed-gadget layout back to the shared dashboard via `onSave`.
 *
 * Props:
 *   layout: Array<{ id, type, config, x, y, w, h }>
 *   onSave: (layout) => Promise|void
 *   readOnly: boolean — hide add/remove controls
 */
export function GadgetBoard({ layout = [], onSave, readOnly = false }) {
  const [gadgets, setGadgets] = useState(() => (Array.isArray(layout) ? layout : []))
  const [catalog, setCatalog] = useState([])
  const [showPicker, setShowPicker] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setGadgets(Array.isArray(layout) ? layout : [])
    setDirty(false)
  }, [layout])

  useEffect(() => {
    fetchGadgetCatalog()
      .then((res) => setCatalog(Array.isArray(res?.gadgets) ? res.gadgets : []))
      .catch(() => setCatalog([]))
  }, [])

  const addGadget = useCallback((entry) => {
    setGadgets((prev) => [
      ...prev,
      { id: nextId(), type: entry.type, config: {}, x: 0, y: prev.length, w: 1, h: 1 },
    ])
    setShowPicker(false)
    setDirty(true)
  }, [])

  const removeGadget = useCallback((id) => {
    setGadgets((prev) => prev.filter((g) => g.id !== id))
    setDirty(true)
  }, [])

  const move = useCallback((id, dir) => {
    setGadgets((prev) => {
      const i = prev.findIndex((g) => g.id === id)
      if (i < 0) return prev
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const copy = [...prev]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    })
    setDirty(true)
  }, [])

  const save = useCallback(async () => {
    if (!onSave) return
    setSaving(true)
    try {
      await onSave(gadgets)
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }, [gadgets, onSave])

  return (
    <div className="gadget-board">
      {!readOnly && (
        <div className="gadget-board-toolbar">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowPicker((s) => !s)}>
            + Add gadget
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!dirty || saving}
            onClick={save}
          >
            {saving ? 'Saving…' : dirty ? 'Save layout' : 'Saved'}
          </button>
        </div>
      )}

      {showPicker && (
        <div className="gadget-picker" role="listbox" aria-label="Gadget library">
          {catalog.length === 0 ? (
            <p className="gadget-picker-empty">No gadgets available.</p>
          ) : (
            catalog.map((entry) => (
              <button
                key={entry.type}
                type="button"
                className="gadget-picker-item"
                onClick={() => addGadget(entry)}
              >
                <strong>{entry.name}</strong>
                <span className="gadget-picker-cat">{entry.category}</span>
                <span className="gadget-picker-desc">{entry.description}</span>
              </button>
            ))
          )}
        </div>
      )}

      {gadgets.length === 0 ? (
        <p className="gadget-board-empty">No gadgets yet. Add one from the library to get started.</p>
      ) : (
        <div className="gadget-grid">
          {gadgets.map((g, i) => (
            <GadgetCard
              key={g.id}
              gadget={g}
              catalog={catalog}
              readOnly={readOnly}
              onRemove={() => removeGadget(g.id)}
              onMoveUp={i > 0 ? () => move(g.id, -1) : null}
              onMoveDown={i < gadgets.length - 1 ? () => move(g.id, 1) : null}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function GadgetCard({ gadget, catalog, readOnly, onRemove, onMoveUp, onMoveDown }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  const meta = useMemo(
    () => catalog.find((c) => c.type === gadget.type),
    [catalog, gadget.type],
  )
  const configKey = JSON.stringify(gadget.config || {})

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(false)
    fetchGadgetData(gadget.type, gadget.config || {})
      .then((res) => { if (active) setData(res?.data) })
      .catch(() => { if (active) setError(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [gadget.type, configKey])

  return (
    <div className="gadget-card">
      <div className="gadget-card-header">
        <span className="gadget-card-title">{meta?.name || gadget.type}</span>
        {!readOnly && (
          <div className="gadget-card-controls">
            {onMoveUp && <button type="button" className="gadget-btn" title="Move up" onClick={onMoveUp}>↑</button>}
            {onMoveDown && <button type="button" className="gadget-btn" title="Move down" onClick={onMoveDown}>↓</button>}
            <button type="button" className="gadget-btn gadget-btn-danger" title="Remove" onClick={onRemove}>×</button>
          </div>
        )}
      </div>
      <div className="gadget-card-body">
        {loading && <p className="gadget-muted">Loading…</p>}
        {!loading && error && <p className="gadget-muted">Failed to load.</p>}
        {!loading && !error && <GadgetContent type={gadget.type} data={data} />}
      </div>
    </div>
  )
}

function GadgetContent({ type, data }) {
  if (data == null) return <p className="gadget-muted">No data.</p>

  if (type === 'issue_count') {
    return <div className="gadget-stat">{Number(data.count ?? 0)}</div>
  }

  if (BAR_FIELD[type]) {
    const field = BAR_FIELD[type]
    const rows = Array.isArray(data)
      ? data.map((d) => ({ label: String(d[field] ?? '—'), count: Number(d.count) || 0 }))
      : []
    if (rows.length === 0) return <p className="gadget-muted">No issues.</p>
    return (
      <SvgBarChart
        data={rows}
        series={[{ key: 'count', name: 'Issues', color: '#4c9aff' }]}
        width={360}
        height={200}
        ariaLabel={`${field} breakdown`}
      />
    )
  }

  if (type === 'recent_activity') {
    const rows = Array.isArray(data) ? data : []
    if (rows.length === 0) return <p className="gadget-muted">No recent activity.</p>
    return (
      <ul className="gadget-activity">
        {rows.map((a) => (
          <li key={a.id}>
            <strong>{a.actor}</strong> {a.action}
          </li>
        ))}
      </ul>
    )
  }

  if (type === 'filter_results') {
    const rows = Array.isArray(data?.issues) ? data.issues : []
    if (rows.length === 0) return <p className="gadget-muted">No matching issues.</p>
    return (
      <ul className="gadget-list">
        {rows.map((it) => (
          <li key={it.id}>
            <span className="gadget-list-key">{it.issue_key}</span> {it.title}
            <span className="gadget-list-status">{it.status}</span>
          </li>
        ))}
      </ul>
    )
  }

  return <p className="gadget-muted">Unsupported gadget.</p>
}

export default GadgetBoard
