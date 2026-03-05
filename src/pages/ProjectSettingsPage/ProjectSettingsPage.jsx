import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchProjectById, updateProject, fetchProjectMembers, addProjectMember, removeProjectMember } from '../../api/projectApi'
import { useMembers } from '../../context/MemberContext'
import './ProjectSettingsPage.css'

const SECTIONS = { DETAILS: 'details', ACCESS: 'access' }

export function ProjectSettingsPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { members } = useMembers()

  const [project, setProject] = useState(null)
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState({ type: '', message: '' })
  const [activeSection, setActiveSection] = useState(SECTIONS.DETAILS)

  // Access tab state
  const [projectMembers, setProjectMembers] = useState([])
  const [addMemberId, setAddMemberId] = useState('')
  const [addRole, setAddRole] = useState('Member')
  const [accessBusy, setAccessBusy] = useState(false)

  const loadProjectMembers = useCallback(() => {
    fetchProjectMembers(projectId)
      .then(setProjectMembers)
      .catch(() => {})
  }, [projectId])

  useEffect(() => {
    fetchProjectById(projectId)
      .then((data) => {
        setProject(data)
        setForm({ name: data.name, key: data.key, type: data.type, lead: data.lead })
      })
      .catch(() => setBanner({ type: 'error', message: 'Failed to load project.' }))
      .finally(() => setLoading(false))
    loadProjectMembers()
  }, [projectId, loadProjectMembers])

  if (loading) return <div className="page ps-layout"><p style={{ padding: 24 }}>Loading...</p></div>
  if (!project || !form) return <div className="page ps-layout"><p style={{ padding: 24 }}>Project not found.</p></div>

  const isDirty =
    form.name !== project.name ||
    form.type !== project.type ||
    form.lead !== project.lead

  async function handleSave() {
    setSaving(true)
    setBanner({ type: '', message: '' })
    try {
      const updated = await updateProject(projectId, {
        name: form.name,
        type: form.type,
        lead: form.lead,
      })
      setProject(updated)
      setForm({ name: updated.name, key: updated.key, type: updated.type, lead: updated.lead })
      setBanner({ type: 'success', message: 'Project details saved.' })
    } catch (err) {
      setBanner({ type: 'error', message: err.message || 'Failed to save.' })
    } finally {
      setSaving(false)
    }
  }

  function handleDiscard() {
    setForm({ name: project.name, key: project.key, type: project.type, lead: project.lead })
    setBanner({ type: '', message: '' })
  }

  const assignedIds = new Set(projectMembers.map((pm) => pm.id))
  const availableMembers = members.filter((m) => !assignedIds.has(m.id))

  async function handleAddMember() {
    if (!addMemberId) return
    setAccessBusy(true)
    try {
      const row = await addProjectMember(projectId, { memberId: Number(addMemberId), role: addRole })
      setProjectMembers((prev) => [...prev, row])
      setAddMemberId('')
      setAddRole('Member')
    } catch { /* ignore */ }
    setAccessBusy(false)
  }

  async function handleRemoveMember(memberId) {
    setAccessBusy(true)
    try {
      await removeProjectMember(projectId, memberId)
      setProjectMembers((prev) => prev.filter((pm) => pm.id !== memberId))
    } catch { /* ignore */ }
    setAccessBusy(false)
  }

  const isLead = (memberName) => project && memberName === project.lead

  return (
    <section className="page ps-layout">
      {/* ── Sidebar ── */}
      <nav className="ps-sidebar">
        <button className="ps-back-link" type="button" onClick={() => navigate(`/projects/${projectId}`)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          Back to project
        </button>

        <div className="ps-project-header">
          <span className="ps-project-avatar-sm" style={{ background: project.avatar_color || '#0052cc' }}>
            {project.key.charAt(0)}
          </span>
          <div className="ps-project-meta">
            <strong>{project.name}</strong>
            <span>Software project</span>
          </div>
        </div>

        <div className="ps-sidebar-divider" />

        <div className="ps-sidebar-nav">
          <button
            className={`ps-nav-link${activeSection === SECTIONS.DETAILS ? ' active' : ''}`}
            type="button"
            onClick={() => setActiveSection(SECTIONS.DETAILS)}
          >
            <span className="ps-nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </span>
            Details
          </button>

          <button
            className={`ps-nav-link${activeSection === SECTIONS.ACCESS ? ' active' : ''}`}
            type="button"
            onClick={() => setActiveSection(SECTIONS.ACCESS)}
          >
            <span className="ps-nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </span>
            Access
          </button>
        </div>
      </nav>

      {/* ── Content ── */}
      <div className="ps-content">
        {activeSection === SECTIONS.DETAILS && (
          <>
            <h1>Details</h1>

            <div
              className="ps-avatar-display"
              style={{ background: project.avatar_color || '#0052cc' }}
            >
              {project.key.charAt(0)}
            </div>

            {banner.message && (
              <p className={`banner${banner.type === 'error' ? ' error' : ''}`}>{banner.message}</p>
            )}

            <article className="panel">
              <div className="ps-form-grid">
                <label>
                  Name
                  <input
                    value={form.name}
                    onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                    required
                  />
                </label>

                <label>
                  Key
                  <input value={form.key} disabled />
                </label>

                <label>
                  Project Type
                  <select
                    value={form.type}
                    onChange={(e) => setForm((c) => ({ ...c, type: e.target.value }))}
                  >
                    <option>Scrum</option>
                    <option>Kanban</option>
                    <option>Bug tracking</option>
                  </select>
                </label>

                <label>
                  Project Lead
                  <select
                    value={form.lead}
                    onChange={(e) => setForm((c) => ({ ...c, lead: e.target.value }))}
                  >
                    {members.length > 0 ? (
                      members.map((m) => (
                        <option key={m.id} value={m.name}>{m.name}</option>
                      ))
                    ) : (
                      <option value={form.lead}>{form.lead}</option>
                    )}
                  </select>
                </label>
              </div>

              <div className="ps-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={handleSave}
                  disabled={!isDirty || saving}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={handleDiscard}
                  disabled={!isDirty || saving}
                >
                  Discard
                </button>
              </div>
            </article>
          </>
        )}

        {activeSection === SECTIONS.ACCESS && (
          <>
            <h1>Access</h1>
            <article className="panel">
              <h3>Add People</h3>
              <p className="muted">Assign members to this project.</p>
              <div className="ps-add-member-row">
                <select
                  value={addMemberId}
                  onChange={(e) => setAddMemberId(e.target.value)}
                  disabled={accessBusy}
                >
                  <option value="">Select a member...</option>
                  {availableMembers.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.email})</option>
                  ))}
                </select>
                <select
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value)}
                  disabled={accessBusy}
                  className="ps-role-select"
                >
                  <option>Admin</option>
                  <option>Member</option>
                  <option>Viewer</option>
                </select>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={handleAddMember}
                  disabled={!addMemberId || accessBusy}
                >
                  Add
                </button>
              </div>
            </article>

            <article className="panel" style={{ marginTop: 16 }}>
              <h3>Project Members</h3>
              <table className="table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    <th style={{ width: 80 }} />
                  </tr>
                </thead>
                <tbody>
                  {projectMembers.length > 0 ? projectMembers.map((pm) => (
                    <tr key={pm.id}>
                      <td>
                        <div className="member-cell">
                          <span className="member-avatar">{pm.name.slice(0, 2).toUpperCase()}</span>
                          <div>
                            <strong>{pm.name}</strong>
                            {isLead(pm.name) && <span className="ps-lead-badge">Lead</span>}
                            <small>{pm.email}</small>
                          </div>
                        </div>
                      </td>
                      <td><span className="pill">{pm.project_role}</span></td>
                      <td>
                        {!isLead(pm.name) && (
                          <button
                            className="btn btn-ghost btn-sm ps-remove-btn"
                            type="button"
                            onClick={() => handleRemoveMember(pm.id)}
                            disabled={accessBusy}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan="3" className="muted">No members assigned to this project.</td></tr>
                  )}
                </tbody>
              </table>
            </article>
          </>
        )}
      </div>
    </section>
  )
}
