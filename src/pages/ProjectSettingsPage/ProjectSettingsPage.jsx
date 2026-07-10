import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchProjectById, updateProject, fetchProjectMembers, addProjectMember, removeProjectMember } from '../../api/projectApi'
import {
  fetchProjectPriorities, createPriority, deletePriority,
  fetchProjectStatuses, createStatus, deleteStatus,
} from '../../api/issueConfigApi'
import {
  fetchPermissionSchemes, fetchPermissionScheme, createPermissionScheme,
  addPermissionGrant, deletePermissionGrant, assignPermissionScheme,
  fetchEffectivePermissions, PERMISSION_KEYS, SCHEME_ROLES,
} from '../../api/schemesApi'
import { fetchProjectComponents, createComponent, deleteComponent } from '../../api/componentApi'
import { useMembers } from '../../context/MemberContext'
import './ProjectSettingsPage.css'

const SECTIONS = { DETAILS: 'details', ACCESS: 'access', FIELDS: 'fields', PERMISSIONS: 'permissions' }
const STATUS_CATEGORIES = ['todo', 'inprogress', 'done']

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

  // Statuses & Priorities tab state
  const [priorities, setPriorities] = useState([])
  const [statuses, setStatuses] = useState([])
  const [newPriority, setNewPriority] = useState({ name: '', color: '#42526E' })
  const [newStatus, setNewStatus] = useState({ name: '', color: '#42526E', category: 'todo' })
  const [fieldsBusy, setFieldsBusy] = useState(false)
  const [fieldsError, setFieldsError] = useState('')

  // Components (JL-111)
  const [components, setComponents] = useState([])
  const [newComponent, setNewComponent] = useState({ name: '', description: '', lead: '' })

  // Permissions tab state
  const [schemes, setSchemes] = useState([])
  const [assignedSchemeId, setAssignedSchemeId] = useState('') // '' = using default (fallback)
  const [viewScheme, setViewScheme] = useState(null) // { ...scheme, grants }
  const [effective, setEffective] = useState(null)
  const [newSchemeName, setNewSchemeName] = useState('')
  const [permsBusy, setPermsBusy] = useState(false)
  const [permsError, setPermsError] = useState('')

  const loadViewScheme = useCallback((schemeId) => {
    if (!schemeId) { setViewScheme(null); return }
    fetchPermissionScheme(schemeId).then(setViewScheme).catch(() => {})
  }, [])

  const loadSchemes = useCallback(() => {
    fetchPermissionSchemes().then(setSchemes).catch(() => {})
    fetchEffectivePermissions(projectId)
      .then((data) => {
        setEffective(data)
        // fallback=true means the project has no explicit assignment (using default)
        setAssignedSchemeId(data.fallback ? '' : String(data.schemeId || ''))
        loadViewScheme(data.schemeId)
      })
      .catch(() => {})
  }, [projectId, loadViewScheme])

  const loadProjectMembers = useCallback(() => {
    fetchProjectMembers(projectId)
      .then(setProjectMembers)
      .catch(() => {})
  }, [projectId])

  const loadFieldConfig = useCallback(() => {
    fetchProjectPriorities(projectId).then(setPriorities).catch(() => {})
    fetchProjectStatuses(projectId).then(setStatuses).catch(() => {})
    fetchProjectComponents(projectId).then(setComponents).catch(() => {})
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
    loadFieldConfig()
    loadSchemes()
  }, [projectId, loadProjectMembers, loadFieldConfig, loadSchemes])

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

  async function handleAddPriority() {
    const name = newPriority.name.trim()
    if (!name) return
    setFieldsBusy(true)
    setFieldsError('')
    try {
      const row = await createPriority(projectId, { ...newPriority, name, position: priorities.length })
      setPriorities((prev) => [...prev, row])
      setNewPriority({ name: '', color: '#42526E' })
    } catch (err) {
      setFieldsError(err.message || 'Failed to add priority.')
    }
    setFieldsBusy(false)
  }

  async function handleDeletePriority(id) {
    setFieldsBusy(true)
    try {
      await deletePriority(id)
      setPriorities((prev) => prev.filter((p) => p.id !== id))
    } catch { /* ignore */ }
    setFieldsBusy(false)
  }

  async function handleAddStatus() {
    const name = newStatus.name.trim()
    if (!name) return
    setFieldsBusy(true)
    setFieldsError('')
    try {
      const row = await createStatus(projectId, { ...newStatus, name, position: statuses.length })
      setStatuses((prev) => [...prev, row])
      setNewStatus({ name: '', color: '#42526E', category: 'todo' })
    } catch (err) {
      setFieldsError(err.message || 'Failed to add status.')
    }
    setFieldsBusy(false)
  }

  async function handleDeleteStatus(id) {
    setFieldsBusy(true)
    try {
      await deleteStatus(id)
      setStatuses((prev) => prev.filter((s) => s.id !== id))
    } catch { /* ignore */ }
    setFieldsBusy(false)
  }

  async function handleAddComponent() {
    const name = newComponent.name.trim()
    if (!name) return
    setFieldsBusy(true)
    setFieldsError('')
    try {
      const row = await createComponent(projectId, {
        name,
        description: newComponent.description.trim(),
        lead: newComponent.lead.trim(),
      })
      setComponents((prev) => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)))
      setNewComponent({ name: '', description: '', lead: '' })
    } catch (err) {
      setFieldsError(err.message || 'Failed to add component.')
    }
    setFieldsBusy(false)
  }

  async function handleDeleteComponent(id) {
    setFieldsBusy(true)
    try {
      await deleteComponent(projectId, id)
      setComponents((prev) => prev.filter((c) => c.id !== id))
    } catch { /* ignore */ }
    setFieldsBusy(false)
  }

  // A row is a global default (not project-specific) when project_id is null.
  const isGlobal = (row) => row.project_id === null || row.project_id === undefined

  // ── Permissions tab handlers ──
  async function handleAssignScheme(schemeId) {
    setAssignedSchemeId(schemeId)
    setPermsBusy(true)
    setPermsError('')
    try {
      await assignPermissionScheme(projectId, schemeId ? Number(schemeId) : null)
      const data = await fetchEffectivePermissions(projectId)
      setEffective(data)
      loadViewScheme(data.schemeId)
    } catch (err) {
      setPermsError(err.message || 'Failed to assign scheme.')
    }
    setPermsBusy(false)
  }

  async function handleCreateScheme() {
    const name = newSchemeName.trim()
    if (!name) return
    setPermsBusy(true)
    setPermsError('')
    try {
      const created = await createPermissionScheme({ name })
      setSchemes((prev) => [...prev, created])
      setNewSchemeName('')
    } catch (err) {
      setPermsError(err.message || 'Failed to create scheme.')
    }
    setPermsBusy(false)
  }

  async function handleToggleGrant(permissionKey, role, currentlyGranted) {
    if (!viewScheme) return
    setPermsBusy(true)
    setPermsError('')
    try {
      if (currentlyGranted) {
        const grant = viewScheme.grants.find((g) => g.permission_key === permissionKey && g.role === role)
        if (grant) await deletePermissionGrant(grant.id)
      } else {
        await addPermissionGrant(viewScheme.id, { permissionKey, role })
      }
      const refreshed = await fetchPermissionScheme(viewScheme.id)
      setViewScheme(refreshed)
      // Effective map may change if this is the project's active scheme.
      fetchEffectivePermissions(projectId).then(setEffective).catch(() => {})
    } catch (err) {
      setPermsError(err.message || 'Failed to update grant.')
    }
    setPermsBusy(false)
  }

  const hasGrant = (permissionKey, role) =>
    Boolean(viewScheme?.grants?.some((g) => g.permission_key === permissionKey && g.role === role))

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

          <button
            className={`ps-nav-link${activeSection === SECTIONS.FIELDS ? ' active' : ''}`}
            type="button"
            onClick={() => setActiveSection(SECTIONS.FIELDS)}
          >
            <span className="ps-nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" />
                <line x1="9" y1="8" x2="15" y2="8" />
                <line x1="17" y1="16" x2="23" y2="16" />
              </svg>
            </span>
            Statuses &amp; Priorities
          </button>

          <button
            className={`ps-nav-link${activeSection === SECTIONS.PERMISSIONS ? ' active' : ''}`}
            type="button"
            onClick={() => setActiveSection(SECTIONS.PERMISSIONS)}
          >
            <span className="ps-nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            Permissions
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

        {activeSection === SECTIONS.FIELDS && (
          <>
            <h1>Statuses &amp; Priorities</h1>
            <p className="muted">
              Customize the priorities and statuses used by this project. Global defaults apply
              until you add project-specific values.
            </p>

            {fieldsError && <p className="banner error">{fieldsError}</p>}

            <article className="panel">
              <h3>Priorities</h3>
              <table className="table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Color</th>
                    <th>Name</th>
                    <th>Scope</th>
                    <th style={{ width: 80 }} />
                  </tr>
                </thead>
                <tbody>
                  {priorities.length > 0 ? priorities.map((p) => (
                    <tr key={p.id}>
                      <td><span className="ps-color-swatch" style={{ background: p.color }} /></td>
                      <td><strong>{p.name}</strong></td>
                      <td><span className="pill">{isGlobal(p) ? 'Global default' : 'Project'}</span></td>
                      <td>
                        {!isGlobal(p) && (
                          <button
                            className="btn btn-ghost btn-sm ps-remove-btn"
                            type="button"
                            onClick={() => handleDeletePriority(p.id)}
                            disabled={fieldsBusy}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan="4" className="muted">No priorities configured.</td></tr>
                  )}
                </tbody>
              </table>
              <div className="ps-add-member-row" style={{ marginTop: 12 }}>
                <input
                  type="color"
                  value={newPriority.color}
                  onChange={(e) => setNewPriority((c) => ({ ...c, color: e.target.value }))}
                  disabled={fieldsBusy}
                  style={{ width: 44, padding: 2 }}
                />
                <input
                  placeholder="New priority name"
                  value={newPriority.name}
                  onChange={(e) => setNewPriority((c) => ({ ...c, name: e.target.value }))}
                  disabled={fieldsBusy}
                />
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={handleAddPriority}
                  disabled={!newPriority.name.trim() || fieldsBusy}
                >
                  Add
                </button>
              </div>
            </article>

            <article className="panel" style={{ marginTop: 16 }}>
              <h3>Statuses</h3>
              <table className="table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Color</th>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Scope</th>
                    <th style={{ width: 80 }} />
                  </tr>
                </thead>
                <tbody>
                  {statuses.length > 0 ? statuses.map((s) => (
                    <tr key={s.id}>
                      <td><span className="ps-color-swatch" style={{ background: s.color }} /></td>
                      <td><strong>{s.name}</strong></td>
                      <td><span className="pill">{s.category}</span></td>
                      <td><span className="pill">{isGlobal(s) ? 'Global default' : 'Project'}</span></td>
                      <td>
                        {!isGlobal(s) && (
                          <button
                            className="btn btn-ghost btn-sm ps-remove-btn"
                            type="button"
                            onClick={() => handleDeleteStatus(s.id)}
                            disabled={fieldsBusy}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan="5" className="muted">No statuses configured.</td></tr>
                  )}
                </tbody>
              </table>
              <div className="ps-add-member-row" style={{ marginTop: 12 }}>
                <input
                  type="color"
                  value={newStatus.color}
                  onChange={(e) => setNewStatus((c) => ({ ...c, color: e.target.value }))}
                  disabled={fieldsBusy}
                  style={{ width: 44, padding: 2 }}
                />
                <input
                  placeholder="New status name"
                  value={newStatus.name}
                  onChange={(e) => setNewStatus((c) => ({ ...c, name: e.target.value }))}
                  disabled={fieldsBusy}
                />
                <select
                  value={newStatus.category}
                  onChange={(e) => setNewStatus((c) => ({ ...c, category: e.target.value }))}
                  disabled={fieldsBusy}
                  className="ps-role-select"
                >
                  {STATUS_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={handleAddStatus}
                  disabled={!newStatus.name.trim() || fieldsBusy}
                >
                  Add
                </button>
              </div>
            </article>

            <article className="panel" style={{ marginTop: 16 }}>
              <h3>Components</h3>
              <p className="muted" style={{ marginTop: 4 }}>
                First-class components for this project. Assign them to issues from the issue detail page.
              </p>
              <table className="table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Description</th>
                    <th>Lead</th>
                    <th style={{ width: 80 }}>Issues</th>
                    <th style={{ width: 80 }} />
                  </tr>
                </thead>
                <tbody>
                  {components.length > 0 ? components.map((c) => (
                    <tr key={c.id}>
                      <td><strong>{c.name}</strong></td>
                      <td className="muted">{c.description || '—'}</td>
                      <td className="muted">{c.lead || '—'}</td>
                      <td><span className="pill">{c.issueCount}</span></td>
                      <td>
                        <button
                          className="btn btn-ghost btn-sm ps-remove-btn"
                          type="button"
                          onClick={() => handleDeleteComponent(c.id)}
                          disabled={fieldsBusy}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan="5" className="muted">No components configured.</td></tr>
                  )}
                </tbody>
              </table>
              <div className="ps-add-member-row" style={{ marginTop: 12 }}>
                <input
                  placeholder="New component name"
                  value={newComponent.name}
                  onChange={(e) => setNewComponent((c) => ({ ...c, name: e.target.value }))}
                  disabled={fieldsBusy}
                />
                <input
                  placeholder="Description (optional)"
                  value={newComponent.description}
                  onChange={(e) => setNewComponent((c) => ({ ...c, description: e.target.value }))}
                  disabled={fieldsBusy}
                />
                <input
                  placeholder="Lead (optional)"
                  value={newComponent.lead}
                  onChange={(e) => setNewComponent((c) => ({ ...c, lead: e.target.value }))}
                  disabled={fieldsBusy}
                />
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={handleAddComponent}
                  disabled={!newComponent.name.trim() || fieldsBusy}
                >
                  Add
                </button>
              </div>
            </article>
          </>
        )}

        {activeSection === SECTIONS.PERMISSIONS && (
          <>
            <h1>Permissions</h1>
            <p className="muted">
              Assign a permission scheme to control which roles hold each capability.
              Projects use the default scheme until you assign a custom one.
            </p>

            {permsError && <p className="banner error">{permsError}</p>}

            <article className="panel">
              <h3>Assigned Scheme</h3>
              <p className="muted">
                {effective?.fallback
                  ? `Using the default scheme (${effective?.schemeName || 'Default'}).`
                  : `Using ${effective?.schemeName || 'a custom scheme'}.`}
              </p>
              <div className="ps-add-member-row">
                <select
                  value={assignedSchemeId}
                  onChange={(e) => handleAssignScheme(e.target.value)}
                  disabled={permsBusy}
                >
                  <option value="">Default scheme</option>
                  {schemes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.is_default ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ps-add-member-row" style={{ marginTop: 12 }}>
                <input
                  placeholder="New scheme name"
                  value={newSchemeName}
                  onChange={(e) => setNewSchemeName(e.target.value)}
                  disabled={permsBusy}
                />
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={handleCreateScheme}
                  disabled={!newSchemeName.trim() || permsBusy}
                >
                  Create scheme
                </button>
              </div>
            </article>

            {viewScheme && (
              <article className="panel" style={{ marginTop: 16 }}>
                <h3>Grants — {viewScheme.name}</h3>
                <p className="muted">
                  A checked box grants the capability to that role and every higher role.
                  {viewScheme.is_default ? ' This is the default scheme.' : ''}
                </p>
                <table className="table" style={{ marginTop: 12 }}>
                  <thead>
                    <tr>
                      <th>Capability</th>
                      {SCHEME_ROLES.map((role) => (
                        <th key={role} style={{ textAlign: 'center', width: 90 }}>{role}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PERMISSION_KEYS.map((key) => (
                      <tr key={key}>
                        <td><strong>{key}</strong></td>
                        {SCHEME_ROLES.map((role) => (
                          <td key={role} style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={hasGrant(key, role)}
                              onChange={() => handleToggleGrant(key, role, hasGrant(key, role))}
                              disabled={permsBusy}
                              aria-label={`${key} for ${role}`}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>
            )}
          </>
        )}
      </div>
    </section>
  )
}
