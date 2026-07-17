import { useState } from 'react'
import { updateLabel } from '../../api/labelApi'

const DEFAULT_COLOR = '#42526E'
const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * LabelPicker (JL-32 UI, JL-199 inline edit).
 *
 * Renders the assigned-label chips, catalog suggestions, an add/create row,
 * and — new in JL-199 — inline edit (rename + recolor) for catalog labels.
 *
 * State (assigned labels / catalog / input) is owned by the parent so the
 * picker stays a controlled presentational component. When a catalog label is
 * edited the picker persists via updateLabel() and hands the fresh row back up
 * through onCatalogLabelUpdated so the parent can refresh both the catalog and
 * any assigned chips that reference it.
 */
export default function LabelPicker({
  labels = [],
  projectLabels = [],
  projectId,
  labelInput = '',
  onLabelInputChange,
  onAdd,
  onToggle,
  onRemove,
  onCatalogLabelUpdated,
}) {
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState(DEFAULT_COLOR)
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)

  function beginEdit(label) {
    setEditingId(label.id)
    setEditName(label.name)
    setEditColor(HEX.test(label.color || '') ? label.color : DEFAULT_COLOR)
    setEditError('')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditError('')
  }

  async function saveEdit(label) {
    const name = editName.trim()
    if (!name) { setEditError('Name is required'); return }
    if (!HEX.test(editColor)) { setEditError('Invalid color'); return }
    setSaving(true)
    setEditError('')
    try {
      const updated = await updateLabel(projectId, label.id, { name, color: editColor })
      onCatalogLabelUpdated?.(updated || { ...label, name, color: editColor })
      setEditingId(null)
    } catch (err) {
      setEditError(err?.data?.error || 'Could not save label')
    } finally {
      setSaving(false)
    }
  }

  const suggestions = projectLabels.filter((pl) => !labels.some((l) => l.id === pl.id))

  return (
    <div className="id-labels-editor">
      <div className="id-labels-list">
        {labels.map((l) => (
          <span key={l.id} className="id-label-chip" style={{ background: `${l.color}22`, color: l.color }}>
            {l.name}
            <button type="button" className="id-label-remove" onClick={() => onRemove?.(l)}>&times;</button>
          </span>
        ))}
      </div>

      {projectLabels.length > 0 && (
        <div className="id-label-catalog">
          {projectLabels.map((pl) => (
            editingId === pl.id ? (
              <div key={pl.id} className="id-label-edit-row" role="group" aria-label={`Edit label ${pl.name}`}>
                <input
                  type="color"
                  className="id-label-color-input"
                  aria-label="Label color"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                />
                <input
                  className="id-inline-input"
                  aria-label="Label name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); saveEdit(pl) }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
                  }}
                />
                <button type="button" className="id-label-add-btn" disabled={saving} onClick={() => saveEdit(pl)}>Save</button>
                <button type="button" className="id-label-remove" aria-label="Cancel edit" onClick={cancelEdit}>&times;</button>
                {editError && <span className="id-label-edit-error" role="alert">{editError}</span>}
              </div>
            ) : (
              <div key={pl.id} className="id-label-catalog-item">
                {suggestions.some((s) => s.id === pl.id) ? (
                  <button type="button" className="id-label-suggestion" style={{ color: pl.color }} onClick={() => onToggle?.(pl)}>
                    + {pl.name}
                  </button>
                ) : (
                  <span className="id-label-suggestion" style={{ color: pl.color }}>{pl.name}</span>
                )}
                <button
                  type="button"
                  className="id-label-edit-btn"
                  aria-label={`Edit label ${pl.name}`}
                  title="Edit label"
                  onClick={() => beginEdit(pl)}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
              </div>
            )
          ))}
        </div>
      )}

      <div className="id-label-add-row">
        <input
          className="id-inline-input"
          value={labelInput}
          onChange={(e) => onLabelInputChange?.(e.target.value)}
          placeholder="Add or create label..."
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd?.() } }}
        />
        <button className="id-label-add-btn" type="button" onClick={() => onAdd?.()}>Add</button>
      </div>
    </div>
  )
}
