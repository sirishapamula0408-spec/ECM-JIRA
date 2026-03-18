import { useEffect, useState, useCallback } from 'react'
import {
  fetchSharedDashboards, createSharedDashboard, updateSharedDashboard,
  deleteSharedDashboard, cloneSharedDashboard,
} from '../../api/sharedDashboardApi'
import { useAuth } from '../../context/AuthContext'
import './SharedDashboardsPage.css'

export function SharedDashboardsPage() {
  const { authUser } = useAuth()
  const [dashboards, setDashboards] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', visibility: 'private' })
  const [editing, setEditing] = useState(null)

  const load = useCallback(() => {
    fetchSharedDashboards()
      .then((data) => setDashboards(Array.isArray(data) ? data : []))
      .catch(() => setDashboards([]))
  }, [])

  useEffect(load, [load])

  async function handleCreate() {
    if (!form.name.trim()) return
    try {
      await createSharedDashboard(form)
      setShowCreate(false)
      setForm({ name: '', description: '', visibility: 'private' })
      load()
    } catch {
      // ignore
    }
  }

  async function handleUpdate() {
    if (!editing) return
    try {
      await updateSharedDashboard(editing.id, {
        name: form.name,
        description: form.description,
        visibility: form.visibility,
      })
      setEditing(null)
      setForm({ name: '', description: '', visibility: 'private' })
      load()
    } catch {
      // ignore
    }
  }

  async function handleDelete(id) {
    await deleteSharedDashboard(id)
    load()
  }

  async function handleClone(id) {
    await cloneSharedDashboard(id)
    load()
  }

  function startEdit(d) {
    setEditing(d)
    setForm({ name: d.name, description: d.description, visibility: d.visibility })
  }

  const myDashboards = dashboards.filter((d) => d.owner_email === authUser?.email)
  const sharedWithMe = dashboards.filter((d) => d.owner_email !== authUser?.email)

  return (
    <section className="page shared-dashboards-page">
      <div className="sd-header">
        <h1>Shared Dashboards</h1>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + New Dashboard
        </button>
      </div>

      {(showCreate || editing) && (
        <div className="sd-form">
          <h3>{editing ? 'Edit Dashboard' : 'New Dashboard'}</h3>
          <input className="sd-input" placeholder="Dashboard name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <input className="sd-input" placeholder="Description (optional)" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          <select className="sd-input" value={form.visibility} onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.value }))}>
            <option value="private">Private</option>
            <option value="public">Public (visible to all)</option>
          </select>
          <div className="sd-form-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={editing ? handleUpdate : handleCreate}>
              {editing ? 'Save' : 'Create'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShowCreate(false); setEditing(null) }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="sd-section">
        <h2>My Dashboards</h2>
        {myDashboards.length === 0 ? (
          <p className="sd-empty">No dashboards yet. Create one to get started.</p>
        ) : (
          <div className="sd-grid">
            {myDashboards.map((d) => (
              <div key={d.id} className="sd-card">
                <div className="sd-card-header">
                  <strong>{d.name}</strong>
                  <span className={`sd-visibility-badge sd-visibility-badge--${d.visibility}`}>{d.visibility}</span>
                </div>
                {d.description && <p className="sd-card-desc">{d.description}</p>}
                <div className="sd-card-meta">
                  Updated {new Date(d.updated_at).toLocaleDateString()}
                </div>
                <div className="sd-card-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(d)}>Edit</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleClone(d.id)}>Clone</button>
                  <button type="button" className="btn btn-ghost btn-sm sd-delete-btn" onClick={() => handleDelete(d.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {sharedWithMe.length > 0 && (
        <div className="sd-section">
          <h2>Shared with Me</h2>
          <div className="sd-grid">
            {sharedWithMe.map((d) => (
              <div key={d.id} className="sd-card">
                <div className="sd-card-header">
                  <strong>{d.name}</strong>
                  <span className="sd-visibility-badge sd-visibility-badge--public">shared</span>
                </div>
                {d.description && <p className="sd-card-desc">{d.description}</p>}
                <div className="sd-card-meta">
                  By {d.owner_email} &middot; Updated {new Date(d.updated_at).toLocaleDateString()}
                </div>
                <div className="sd-card-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleClone(d.id)}>Clone</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
