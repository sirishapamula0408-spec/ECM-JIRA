import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchProjects } from '../../api/projectApi'
import {
  fetchProjectReleases, createRelease, deleteRelease,
  fetchReleaseProgress, fetchReleaseNotes, updateRelease,
} from '../../api/releaseApi'
import { usePermissions } from '../../hooks/usePermissions'
import './ReleasesPage.css'

const EMPTY = { name: '', description: '', releaseDate: '', status: 'unreleased' }

export function ReleasesPage() {
  const { projectId: routeProjectId } = useParams()
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState(routeProjectId ? Number(routeProjectId) : null)
  const [releases, setReleases] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [progress, setProgress] = useState(null)
  const [notes, setNotes] = useState(null)
  const { canCreateIssue, isAdmin } = usePermissions(projectId)

  useEffect(() => {
    if (routeProjectId) return
    fetchProjects().then((data) => {
      setProjects(data || [])
      if (!projectId && data?.length) setProjectId(data[0].id)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeProjectId])

  function reload() {
    if (!projectId) return
    fetchProjectReleases(projectId)
      .then((d) => setReleases(Array.isArray(d) ? d : []))
      .catch(() => setReleases([]))
  }
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId])

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    try {
      await createRelease(projectId, form)
      setForm(EMPTY)
      reload()
    } catch (err) {
      setError(err?.message || 'Failed to create release')
    }
  }

  async function openRelease(rel) {
    setSelected(rel)
    setProgress(null)
    setNotes(null)
    const [p, n] = await Promise.all([
      fetchReleaseProgress(rel.id).catch(() => null),
      fetchReleaseNotes(rel.id).catch(() => null),
    ])
    setProgress(p)
    setNotes(n)
  }

  async function markReleased(rel) {
    await updateRelease(rel.id, { status: rel.status === 'released' ? 'unreleased' : 'released' }).catch(() => {})
    reload()
  }

  async function remove(rel) {
    if (!window.confirm(`Delete release "${rel.name}"? Issues will be unassigned.`)) return
    await deleteRelease(rel.id).catch(() => {})
    if (selected?.id === rel.id) { setSelected(null); setProgress(null); setNotes(null) }
    reload()
  }

  return (
    <section className="page releases-page">
      <div className="rel-header">
        <h1>Releases</h1>
        {!routeProjectId && projects.length > 0 && (
          <select className="rel-input" value={projectId || ''} onChange={(e) => setProjectId(Number(e.target.value))}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>
      <p className="rel-sub">Plan named releases, track readiness, and generate release notes.</p>

      {canCreateIssue && (
        <form className="rel-builder" onSubmit={handleCreate}>
          <input className="rel-input rel-name" placeholder="Release name (e.g. v1.2.0)" value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          <input className="rel-input" type="date" value={form.releaseDate}
            onChange={(e) => setForm((f) => ({ ...f, releaseDate: e.target.value }))} />
          <input className="rel-input rel-desc" placeholder="Description (optional)" value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          <button className="btn btn-primary" type="submit">Create release</button>
          {error && <p className="rel-error">{error}</p>}
        </form>
      )}

      <div className="rel-body">
        <div className="rel-list">
          <h3 className="rel-section-title">Release history ({releases.length})</h3>
          {releases.length === 0 && <p className="rel-empty">No releases yet.</p>}
          {releases.map((r) => (
            <div key={r.id} className={`rel-card${selected?.id === r.id ? ' rel-card--active' : ''}`}>
              <button type="button" className="rel-card-main" onClick={() => openRelease(r)}>
                <strong>{r.name}</strong>
                <span className={`rel-badge rel-badge--${r.status}`}>{r.status}</span>
                <span className="rel-meta">
                  {r.releaseDate ? new Date(r.releaseDate).toLocaleDateString() : 'No date'} · {r.issueCount ?? 0} issues
                </span>
              </button>
              {canCreateIssue && (
                <div className="rel-card-actions">
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => markReleased(r)}>
                    {r.status === 'released' ? 'Reopen' : 'Release'}
                  </button>
                  {isAdmin && <button className="btn btn-ghost btn-sm" type="button" onClick={() => remove(r)}>Delete</button>}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="rel-detail">
          {!selected && <p className="rel-empty">Select a release to view progress and notes.</p>}
          {selected && (
            <>
              <h3 className="rel-section-title">{selected.name} — progress</h3>
              {progress && (
                <div className="rel-progress">
                  <div className="rel-bar">
                    <div className="rel-bar-fill" style={{ width: `${progress.percentComplete}%` }} />
                  </div>
                  <p className="rel-progress-text">
                    {progress.percentComplete}% complete · {progress.done}/{progress.total} done ·
                    {' '}{progress.unresolvedCount} unresolved
                    {progress.ready && <span className="rel-ready"> · Ready to release</span>}
                  </p>
                  {progress.unresolvedIssues?.length > 0 && (
                    <div className="rel-readiness">
                      <h4>Unresolved issues (readiness)</h4>
                      <ul>
                        {progress.unresolvedIssues.map((i) => (
                          <li key={i.id}><strong>{i.issue_key}</strong> {i.title} <em>({i.status})</em></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <h3 className="rel-section-title">Release notes</h3>
              {notes && notes.totalIssues === 0 && <p className="rel-empty">No issues assigned yet.</p>}
              {notes && Object.entries(notes.groups).map(([type, items]) => (
                <div key={type} className="rel-notes-group">
                  <h4>{type} ({items.length})</h4>
                  <ul>
                    {items.map((i) => (
                      <li key={i.id}><strong>{i.issueKey}</strong> {i.title}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
