import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchProjects } from '../../api/projectApi'
import {
  fetchProjectReleases, createRelease, deleteRelease,
  fetchReleaseProgress, fetchReleaseNotes, updateRelease,
  fetchReleaseCheck, runReleaseCheck,
} from '../../api/releaseApi'
import { usePermissions } from '../../hooks/usePermissions'
import { useConfirm } from '../../components/common/useConfirm'
import { EmptyState } from '../../components/common/EmptyState'
import './ReleasesPage.css'
import { usePageTitle } from '../../hooks/usePageTitle'

const EMPTY = { name: '', description: '', releaseDate: '', status: 'unreleased' }

export function ReleasesPage() {
  usePageTitle('Releases')
  const { projectId: routeProjectId } = useParams()
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState(routeProjectId ? Number(routeProjectId) : null)
  const [releases, setReleases] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [progress, setProgress] = useState(null)
  const [notes, setNotes] = useState(null)
  // undefined = loading, null = never checked
  const [check, setCheck] = useState(undefined)
  const [checking, setChecking] = useState(false)
  const { canCreateIssue, isAdmin, projectRole } = usePermissions(projectId)
  // JL-488: project Member+ or the read-only Release Monitor role may re-run a check.
  const canRunCheck = canCreateIssue || projectRole === 'Release Monitor'
  const { confirm, confirmDialog } = useConfirm()

  useEffect(() => {
    if (routeProjectId) return
    fetchProjects().then((data) => {
      setProjects(data || [])
      if (!projectId && data?.length) setProjectId(data[0].id)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeProjectId])

  // JL-407: `reload` is memoised on projectId and the effect depends on the memo.
  // It used to be a plain function redeclared every render, with the effect
  // depending on `projectId` instead — which worked, but only because the stale
  // closure happened to be equivalent to a fresh one. Naming `reload` as the
  // dependency is what the rule asked for, and the useCallback is what makes that
  // safe: without it the identity changes every render and the effect refetches
  // in a loop.
  const reload = useCallback(() => {
    if (!projectId) return
    fetchProjectReleases(projectId)
      .then((d) => setReleases(Array.isArray(d) ? d : []))
      .catch(() => setReleases([]))
  }, [projectId])
  useEffect(() => { reload() }, [reload])

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
    setCheck(undefined)
    const [p, n, c] = await Promise.all([
      fetchReleaseProgress(rel.id).catch(() => null),
      fetchReleaseNotes(rel.id).catch(() => null),
      fetchReleaseCheck(rel.id).catch(() => null),
    ])
    setProgress(p)
    setNotes(n)
    setCheck(c)
  }

  async function markReleased(rel) {
    const updated = await updateRelease(rel.id, { status: rel.status === 'released' ? 'unreleased' : 'released' }).catch(() => null)
    reload()
    // JL-488: releasing runs the check on the server; show its result straight away.
    if (updated?.check) openRelease(updated)
    else if (selected?.id === rel.id && updated) setSelected(updated)
  }

  async function recheck() {
    if (!selected) return
    setChecking(true)
    try { setCheck(await runReleaseCheck(selected.id)) } catch { /* the client shows the error */ } finally { setChecking(false) }
  }

  async function remove(rel) {
    if (!(await confirm({ title: 'Delete release?', message: `Delete release "${rel.name}"? Issues will be unassigned.`, confirmLabel: 'Delete', danger: true }))) return
    await deleteRelease(rel.id).catch(() => {})
    if (selected?.id === rel.id) { setSelected(null); setProgress(null); setNotes(null) }
    reload()
  }

  return (
    <section className="page releases-page">
      {confirmDialog}
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
          {releases.length === 0 && (
            <EmptyState
              icon="🚀"
              title="No releases yet"
              description={canCreateIssue
                ? 'Create your first release above to plan versions, track readiness, and generate release notes.'
                : 'Releases will appear here once a team member creates one.'}
            />
          )}
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

              {selected.status === 'released' && (
                <section className={`rel-check${check ? (check.ok ? ' rel-check--ok' : ' rel-check--fail') : ''}`} aria-label="Release check">
                  <div className="rel-check-head">
                    <h3 className="rel-section-title">Release check</h3>
                    {canRunCheck && (
                      <button className="btn btn-ghost btn-sm" type="button" onClick={recheck} disabled={checking}>
                        {checking ? 'Checking…' : 'Run check again'}
                      </button>
                    )}
                  </div>
                  {check === undefined && <p className="rel-empty">Loading…</p>}
                  {check === null && <p className="rel-empty">Not checked yet.</p>}
                  {check && (
                    <>
                      <p className="rel-check-verdict">
                        {check.ok ? 'Passed' : 'Failed'}: {check.passed} of {check.total} work items Done
                        <span className="rel-meta"> · {new Date(check.checkedAt).toLocaleString()}</span>
                      </p>
                      {check.failed.length > 0 && (
                        <ul>
                          {check.failed.map((i) => (
                            <li key={i.id}><strong>{i.key}</strong> {i.title} <em>({i.status})</em></li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </section>
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
