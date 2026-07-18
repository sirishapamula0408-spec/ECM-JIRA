import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchProjectById, updateProject, fetchProjectMembers, addProjectMember, removeProjectMember, updateProjectMemberRole } from '../../api/projectApi'
import {
  fetchProjectPriorities, createPriority, deletePriority,
  fetchProjectStatuses, createStatus, deleteStatus,
} from '../../api/issueConfigApi'
import {
  fetchPermissionSchemes, fetchPermissionScheme, createPermissionScheme,
  addPermissionGrant, deletePermissionGrant, assignPermissionScheme,
  fetchEffectivePermissions, PERMISSION_KEYS, SCHEME_ROLES,
} from '../../api/schemesApi'
import { fetchProjectComponents, createComponent, updateComponent, deleteComponent } from '../../api/componentApi'
import { fetchResolvedScreen, saveScreenScheme } from '../../api/screenSchemeApi'
import { fetchProjectCustomFields } from '../../api/customFieldApi'
import { fetchFieldConfig, saveFieldConfig } from '../../api/fieldConfigApi'
import { fetchSecurityLevels, createSecurityLevel, deleteSecurityLevel } from '../../api/securityLevelApi'
import { ISSUE_TYPES } from '../../constants'
import { useMembers } from '../../context/MemberContext'
import './ProjectSettingsPage.css'

const SECTIONS = { DETAILS: 'details', ACCESS: 'access', FIELDS: 'fields', PERMISSIONS: 'permissions', SCREENS: 'screens', FIELD_CONFIG: 'fieldconfig' }
const STATUS_CATEGORIES = ['todo', 'inprogress', 'done']

// Human labels for the built-in field keys the screen editor can toggle.
const BUILTIN_FIELD_LABELS = {
  summary: 'Summary', description: 'Description', status: 'Status', priority: 'Priority',
  assignee: 'Assignee', reporter: 'Reporter', issue_type: 'Issue type', labels: 'Labels',
  story_points: 'Story points', due_date: 'Due date', original_estimate: 'Original estimate', parent: 'Parent',
}

// JL-115: built-in fields that can carry a per-project configuration.
const CONFIGURABLE_FIELDS = [
  { key: 'priority', label: 'Priority' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'reporter', label: 'Reporter' },
  { key: 'dueDate', label: 'Due date' },
  { key: 'startDate', label: 'Start date' },
  { key: 'storyPoints', label: 'Story points' },
  { key: 'components', label: 'Components' },
  { key: 'environment', label: 'Environment' },
  { key: 'resolution', label: 'Resolution' },
]

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
  const [accessError, setAccessError] = useState('')

  // JL-131: issue security-levels catalog (workspace-wide)
  const [securityLevels, setSecurityLevels] = useState([])
  const [newLevelName, setNewLevelName] = useState('')
  const [newLevelDesc, setNewLevelDesc] = useState('')
  const [levelBusy, setLevelBusy] = useState(false)

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
  // JL-218: inline component edit — null when not editing, else { id, name, description, lead }
  const [editingComponent, setEditingComponent] = useState(null)

  // Field configuration tab state (JL-115) — map of field_key -> { isRequired, isHidden, defaultValue }
  const [fieldCfg, setFieldCfg] = useState({})
  const [fieldCfgBusy, setFieldCfgBusy] = useState(false)
  const [fieldCfgBanner, setFieldCfgBanner] = useState({ type: '', message: '' })

  // Permissions tab state
  const [schemes, setSchemes] = useState([])
  const [assignedSchemeId, setAssignedSchemeId] = useState('') // '' = using default (fallback)
  const [viewScheme, setViewScheme] = useState(null) // { ...scheme, grants }
  const [effective, setEffective] = useState(null)
  const [newSchemeName, setNewSchemeName] = useState('')
  const [permsBusy, setPermsBusy] = useState(false)
  const [permsError, setPermsError] = useState('')

  // Screens tab state
  const [screenIssueType, setScreenIssueType] = useState(ISSUE_TYPES[0])
  const [screenFields, setScreenFields] = useState([])
  const [screenConfigured, setScreenConfigured] = useState(false)
  const [customFieldNames, setCustomFieldNames] = useState({})
  const [screensBusy, setScreensBusy] = useState(false)
  const [screensError, setScreensError] = useState('')
  const [screensMsg, setScreensMsg] = useState('')

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

  const loadScreen = useCallback((issueType) => {
    setScreensMsg('')
    fetchResolvedScreen(projectId, issueType)
      .then((data) => {
        setScreenFields(data.fields || [])
        setScreenConfigured(Boolean(data.configured))
      })
      .catch((err) => setScreensError(err.message || 'Failed to load screen.'))
  }, [projectId])

  const loadFieldCfg = useCallback(() => {
    fetchFieldConfig(projectId)
      .then((rows) => {
        // Only surface project-wide (issue_type === null) rows in this table.
        const map = {}
        for (const r of rows) {
          if (r.issueType == null) {
            map[r.fieldKey] = {
              isRequired: Boolean(r.isRequired),
              isHidden: Boolean(r.isHidden),
              defaultValue: r.defaultValue ?? '',
            }
          }
        }
        setFieldCfg(map)
      })
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
    loadFieldConfig()
    loadFieldCfg()
    loadSchemes()
    fetchProjectCustomFields(projectId)
      .then((rows) => {
        const map = {}
        for (const r of rows) map[`custom:${r.id}`] = r.name
        setCustomFieldNames(map)
      })
      .catch(() => {})
  }, [projectId, loadProjectMembers, loadFieldConfig, loadFieldCfg, loadSchemes])

  useEffect(() => {
    if (activeSection === SECTIONS.SCREENS) loadScreen(screenIssueType)
  }, [activeSection, screenIssueType, loadScreen])

  // ── JL-131: Security levels catalog ──
  // Kept with the other hooks (before the early returns) so hook order stays
  // stable across the loading → loaded transition (Rules of Hooks).
  useEffect(() => {
    fetchSecurityLevels()
      .then((data) => setSecurityLevels(Array.isArray(data) ? data : []))
      .catch(() => setSecurityLevels([]))
  }, [])

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
    setAccessError('')
    try {
      await removeProjectMember(projectId, memberId)
      setProjectMembers((prev) => prev.filter((pm) => pm.id !== memberId))
    } catch (err) {
      setAccessError(err.message || 'Failed to remove member.')
    }
    setAccessBusy(false)
  }

  async function handleChangeMemberRole(memberId, role) {
    setAccessBusy(true)
    setAccessError('')
    try {
      const updated = await updateProjectMemberRole(projectId, memberId, role)
      setProjectMembers((prev) =>
        prev.map((pm) => (pm.id === memberId ? { ...pm, project_role: updated.project_role } : pm)),
      )
    } catch (err) {
      setAccessError(err.message || 'Failed to change role.')
    }
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

  function startEditComponent(c) {
    setFieldsError('')
    setEditingComponent({ id: c.id, name: c.name, description: c.description || '', lead: c.lead || '' })
  }

  async function handleUpdateComponent() {
    if (!editingComponent) return
    const name = editingComponent.name.trim()
    if (!name) return
    setFieldsBusy(true)
    setFieldsError('')
    try {
      const row = await updateComponent(projectId, editingComponent.id, {
        name,
        description: editingComponent.description.trim(),
        lead: editingComponent.lead.trim(),
      })
      setComponents((prev) => prev
        .map((c) => (c.id === row.id ? { ...c, ...row } : c))
        .sort((a, b) => a.name.localeCompare(b.name)))
      setEditingComponent(null)
    } catch (err) {
      setFieldsError(err.message || 'Failed to update component.')
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

  async function handleCreateSecurityLevel() {
    const name = newLevelName.trim()
    if (!name) return
    setLevelBusy(true)
    try {
      const created = await createSecurityLevel({ name, description: newLevelDesc.trim() || undefined })
      setSecurityLevels((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setNewLevelName('')
      setNewLevelDesc('')
    } catch {
      // ignore — non-Admins are blocked server-side
    }
    setLevelBusy(false)
  }

  async function handleDeleteSecurityLevel(id) {
    setLevelBusy(true)
    try {
      await deleteSecurityLevel(id)
      setSecurityLevels((prev) => prev.filter((l) => l.id !== id))
    } catch {
      // ignore
    }
    setLevelBusy(false)
  }

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

  // ── Screens tab handlers ──
  const fieldLabel = (key) =>
    BUILTIN_FIELD_LABELS[key] || customFieldNames[key] || key

  function toggleScreenField(index, prop) {
    setScreenFields((prev) => prev.map((f, i) => (i === index ? { ...f, [prop]: !f[prop] } : f)))
  }

  function moveScreenField(index, dir) {
    setScreenFields((prev) => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next.map((f, i) => ({ ...f, position: i }))
    })
  }

  async function handleSaveScreen() {
    setScreensBusy(true)
    setScreensError('')
    setScreensMsg('')
    try {
      const payload = screenFields.map((f) => ({
        fieldKey: f.fieldKey,
        showOnCreate: f.showOnCreate,
        showOnEdit: f.showOnEdit,
      }))
      const saved = await saveScreenScheme(projectId, screenIssueType, payload)
      setScreenFields(saved.fields || [])
      setScreenConfigured(true)
      setScreensMsg('Screen layout saved.')
    } catch (err) {
      setScreensError(err.message || 'Failed to save screen.')
    }
    setScreensBusy(false)
  }

  // ── Field configuration tab handlers (JL-115) ──
  function setFieldCfgProp(fieldKey, prop, value) {
    setFieldCfg((prev) => ({
      ...prev,
      [fieldKey]: { isRequired: false, isHidden: false, defaultValue: '', ...prev[fieldKey], [prop]: value },
    }))
  }

  async function handleSaveFieldCfg() {
    setFieldCfgBusy(true)
    setFieldCfgBanner({ type: '', message: '' })
    try {
      // Only persist fields that deviate from the all-default behavior.
      const fields = CONFIGURABLE_FIELDS
        .map(({ key }) => ({ key, cfg: fieldCfg[key] }))
        .filter(({ cfg }) => cfg && (cfg.isRequired || cfg.isHidden || (cfg.defaultValue ?? '') !== ''))
        .map(({ key, cfg }) => ({
          field_key: key,
          issue_type: null,
          is_required: Boolean(cfg.isRequired),
          is_hidden: Boolean(cfg.isHidden),
          default_value: cfg.defaultValue ?? '',
        }))
      await saveFieldConfig(projectId, fields)
      setFieldCfgBanner({ type: 'success', message: 'Field configuration saved.' })
      loadFieldCfg()
    } catch (err) {
      setFieldCfgBanner({ type: 'error', message: err.message || 'Failed to save field configuration.' })
    }
    setFieldCfgBusy(false)
  }

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

          <button
            className={`ps-nav-link${activeSection === SECTIONS.SCREENS ? ' active' : ''}`}
            type="button"
            onClick={() => setActiveSection(SECTIONS.SCREENS)}
          >
            <span className="ps-nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </span>
            Screens
          </button>

          <button
            className={`ps-nav-link${activeSection === SECTIONS.FIELD_CONFIG ? ' active' : ''}`}
            type="button"
            onClick={() => setActiveSection(SECTIONS.FIELD_CONFIG)}
          >
            <span className="ps-nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            </span>
            Field configuration
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
                  <option>Lead</option>
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
              {accessError && <p className="banner error">{accessError}</p>}
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
                      <td>
                        {isLead(pm.name) ? (
                          <span className="pill">{pm.project_role}</span>
                        ) : (
                          <select
                            className="ps-role-select"
                            value={pm.project_role}
                            onChange={(e) => handleChangeMemberRole(pm.id, e.target.value)}
                            disabled={accessBusy}
                            aria-label={`Role for ${pm.name}`}
                          >
                            <option>Lead</option>
                            <option>Admin</option>
                            <option>Member</option>
                            <option>Viewer</option>
                          </select>
                        )}
                      </td>
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

            {/* JL-131: Issue security levels */}
            <article className="ps-card" style={{ marginTop: 24 }}>
              <h3>Issue Security Levels</h3>
              <p className="muted">
                A named security level restricts an issue to workspace Admins/Owners plus its
                assignee and reporter. Issues with no level stay visible to everyone.
              </p>
              <table className="table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Description</th>
                    <th style={{ width: 80 }} />
                  </tr>
                </thead>
                <tbody>
                  {securityLevels.length > 0 ? securityLevels.map((l) => (
                    <tr key={l.id}>
                      <td><span className="pill">🔒 {l.name}</span></td>
                      <td>{l.description || <span className="muted">—</span>}</td>
                      <td>
                        <button
                          className="btn btn-ghost btn-sm ps-remove-btn"
                          type="button"
                          onClick={() => handleDeleteSecurityLevel(l.id)}
                          disabled={levelBusy}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan="3" className="muted">No security levels defined.</td></tr>
                  )}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <input
                  className="input"
                  placeholder="Level name (e.g. Confidential)"
                  value={newLevelName}
                  onChange={(e) => setNewLevelName(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Description (optional)"
                  value={newLevelDesc}
                  onChange={(e) => setNewLevelDesc(e.target.value)}
                />
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  onClick={handleCreateSecurityLevel}
                  disabled={levelBusy || !newLevelName.trim()}
                >
                  Add level
                </button>
              </div>
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
                    editingComponent?.id === c.id ? (
                      <tr key={c.id}>
                        <td>
                          <input
                            aria-label={`Name for ${c.name}`}
                            value={editingComponent.name}
                            onChange={(e) => setEditingComponent((ec) => ({ ...ec, name: e.target.value }))}
                            disabled={fieldsBusy}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Description for ${c.name}`}
                            value={editingComponent.description}
                            onChange={(e) => setEditingComponent((ec) => ({ ...ec, description: e.target.value }))}
                            disabled={fieldsBusy}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Lead for ${c.name}`}
                            value={editingComponent.lead}
                            onChange={(e) => setEditingComponent((ec) => ({ ...ec, lead: e.target.value }))}
                            disabled={fieldsBusy}
                          />
                        </td>
                        <td><span className="pill">{c.issueCount}</span></td>
                        <td>
                          <button
                            className="btn btn-primary btn-sm"
                            type="button"
                            onClick={handleUpdateComponent}
                            disabled={!editingComponent.name.trim() || fieldsBusy}
                          >
                            Save
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            onClick={() => setEditingComponent(null)}
                            disabled={fieldsBusy}
                          >
                            Cancel
                          </button>
                        </td>
                      </tr>
                    ) : (
                    <tr key={c.id}>
                      <td><strong>{c.name}</strong></td>
                      <td className="muted">{c.description || '—'}</td>
                      <td className="muted">{c.lead || '—'}</td>
                      <td><span className="pill">{c.issueCount}</span></td>
                      <td>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => startEditComponent(c)}
                          disabled={fieldsBusy}
                        >
                          Edit
                        </button>
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
                    )
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

        {activeSection === SECTIONS.SCREENS && (
          <>
            <h1>Screens</h1>
            <p className="muted">
              Choose which fields appear on the create and edit screens for each issue type.
              Until you save a layout, every field is shown (the default).
            </p>

            {screensError && <p className="banner error">{screensError}</p>}
            {screensMsg && <p className="banner">{screensMsg}</p>}

            <article className="panel">
              <div className="ps-add-member-row">
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  Issue type
                  <select
                    value={screenIssueType}
                    onChange={(e) => setScreenIssueType(e.target.value)}
                    disabled={screensBusy}
                  >
                    {ISSUE_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <span className="pill">{screenConfigured ? 'Custom layout' : 'Default (all fields)'}</span>
              </div>

              <table className="table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Field</th>
                    <th style={{ textAlign: 'center', width: 100 }}>On create</th>
                    <th style={{ textAlign: 'center', width: 100 }}>On edit</th>
                    <th style={{ width: 90 }}>Order</th>
                  </tr>
                </thead>
                <tbody>
                  {screenFields.length > 0 ? screenFields.map((f, i) => (
                    <tr key={f.fieldKey}>
                      <td>
                        <strong>{fieldLabel(f.fieldKey)}</strong>
                        {f.fieldKey.startsWith('custom:') && <span className="pill" style={{ marginLeft: 8 }}>custom</span>}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(f.showOnCreate)}
                          onChange={() => toggleScreenField(i, 'showOnCreate')}
                          disabled={screensBusy}
                          aria-label={`${fieldLabel(f.fieldKey)} on create`}
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(f.showOnEdit)}
                          onChange={() => toggleScreenField(i, 'showOnEdit')}
                          disabled={screensBusy}
                          aria-label={`${fieldLabel(f.fieldKey)} on edit`}
                        />
                      </td>
                      <td>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => moveScreenField(i, -1)}
                          disabled={screensBusy || i === 0}
                          aria-label="Move up"
                        >↑</button>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => moveScreenField(i, 1)}
                          disabled={screensBusy || i === screenFields.length - 1}
                          aria-label="Move down"
                        >↓</button>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan="4" className="muted">No fields available.</td></tr>
                  )}
                </tbody>
              </table>

              <div className="ps-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={handleSaveScreen}
                  disabled={screensBusy || screenFields.length === 0}
                >
                  {screensBusy ? 'Saving...' : 'Save screen layout'}
                </button>
              </div>
            </article>
          </>
        )}

        {activeSection === SECTIONS.FIELD_CONFIG && (
          <>
            <h1>Field configuration</h1>
            <p className="muted">
              Mark fields as required or hidden, or give them a default value. Required fields are
              enforced when an issue is created. Fields left untouched keep their standard behavior.
            </p>

            {fieldCfgBanner.message && (
              <p className={`banner${fieldCfgBanner.type === 'error' ? ' error' : ''}`}>{fieldCfgBanner.message}</p>
            )}

            <article className="panel">
              <table className="table" style={{ marginTop: 4 }}>
                <thead>
                  <tr>
                    <th>Field</th>
                    <th style={{ textAlign: 'center', width: 90 }}>Required</th>
                    <th style={{ textAlign: 'center', width: 90 }}>Hidden</th>
                    <th style={{ width: 220 }}>Default value</th>
                  </tr>
                </thead>
                <tbody>
                  {CONFIGURABLE_FIELDS.map(({ key, label }) => {
                    const cfg = fieldCfg[key] || {}
                    return (
                      <tr key={key}>
                        <td><strong>{label}</strong></td>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={Boolean(cfg.isRequired)}
                            onChange={(e) => setFieldCfgProp(key, 'isRequired', e.target.checked)}
                            disabled={fieldCfgBusy}
                            aria-label={`${label} required`}
                          />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={Boolean(cfg.isHidden)}
                            onChange={(e) => setFieldCfgProp(key, 'isHidden', e.target.checked)}
                            disabled={fieldCfgBusy}
                            aria-label={`${label} hidden`}
                          />
                        </td>
                        <td>
                          <input
                            value={cfg.defaultValue ?? ''}
                            onChange={(e) => setFieldCfgProp(key, 'defaultValue', e.target.value)}
                            placeholder="—"
                            disabled={fieldCfgBusy}
                            style={{ width: '100%' }}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="ps-actions" style={{ marginTop: 16 }}>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={handleSaveFieldCfg}
                  disabled={fieldCfgBusy}
                >
                  {fieldCfgBusy ? 'Saving...' : 'Save field configuration'}
                </button>
              </div>
            </article>
          </>
        )}
      </div>
    </section>
  )
}
