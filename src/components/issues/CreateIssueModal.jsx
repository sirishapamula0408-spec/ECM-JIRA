import { useState, useEffect } from 'react'
import { useIssues } from '../../context/IssueContext'
import { useMembers } from '../../context/MemberContext'
import { useSprints } from '../../context/SprintContext'
import { useAppData } from '../../context/AppDataContext'
import { useAuth } from '../../context/AuthContext'
import { fetchProjects } from '../../api/projectApi'
import { ISSUE_STATUSES, ISSUE_TYPES, PRIORITIES } from '../../constants'
import './CreateIssueModal.css'

const TYPE_META = {
  Story: { icon: '\u{1F4D7}', label: 'Story' },
  Bug:   { icon: '\u{1F41B}', label: 'Bug' },
  Task:  { icon: '\u2705',     label: 'Task' },
}

const PRIORITY_COLORS = {
  High:   'high',
  Medium: 'medium',
  Low:    'low',
}

export function CreateIssueModal({ onClose }) {
  const { handleCreate } = useIssues()
  const { profile, members } = useMembers()
  const { sprints } = useSprints()
  const { setAppError } = useAppData()
  const { authUser } = useAuth()

  const reporterName = authUser?.email || profile?.full_name || 'Current User'

  const [projects, setProjects] = useState([])
  const [form, setForm] = useState({
    projectId: '',
    title: '',
    description: '',
    issueType: 'Story',
    priority: 'Medium',
    status: 'Backlog',
    assignee: profile?.full_name || '',
    sprintId: null,
  })
  const [createAnother, setCreateAnother] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // Fetch projects on mount and default to first project
  useEffect(() => {
    fetchProjects().then((data) => {
      setProjects(data)
      if (data.length > 0) {
        setForm((c) => ({ ...c, projectId: data[0].id }))
      }
    }).catch(() => {})
  }, [])

  // When profile loads after mount, default assignee
  useEffect(() => {
    if (profile?.full_name && !form.assignee) {
      setForm((c) => ({ ...c, assignee: profile.full_name }))
    }
  }, [profile])

  // Sprint-status logic: disable sprint when Backlog
  useEffect(() => {
    if (form.status === 'Backlog') {
      setForm((c) => ({ ...c, sprintId: null }))
    } else if (form.sprintId === null && sprints.length > 0) {
      // Auto-select first sprint when moving out of Backlog
      setForm((c) => ({ ...c, sprintId: sprints[0].id }))
    }
  }, [form.status])

  function update(field, value) {
    setForm((c) => ({ ...c, [field]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    setSubmitError('')
    setSuccessMessage('')
    setSaving(true)

    try {
      const payload = {
        projectId: form.projectId || undefined,
        title: form.title,
        description: form.description,
        issueType: form.issueType,
        priority: form.priority,
        status: form.status,
        assignee: form.assignee,
        sprintId: form.status === 'Backlog' ? null : form.sprintId,
      }
      await handleCreate(payload)

      if (createAnother) {
        // Reset title + description, keep type/priority/assignee/sprint/status
        setForm((c) => ({ ...c, title: '', description: '' }))
        setSuccessMessage('Issue created successfully!')
        setTimeout(() => setSuccessMessage(''), 3000)
      } else {
        onClose()
      }
    } catch (createError) {
      setSubmitError(createError.message || 'Failed to create issue')
      setAppError(createError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <form
        className="create-issue-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        {/* Header */}
        <div className="create-issue-header">
          <h2>Create issue</h2>
          <button
            type="button"
            className="create-issue-close"
            onClick={onClose}
            aria-label="Close"
          >
            &#x2715;
          </button>
        </div>

        {/* Success toast */}
        {successMessage && (
          <div className="create-issue-success">{'\u2714'} {successMessage}</div>
        )}

        {/* Body */}
        <div className="create-issue-body">
          {/* Error */}
          {submitError && <p className="create-issue-error">{submitError}</p>}

          {/* Project */}
          <div className="create-issue-field">
            <label>Project <span className="create-issue-required">*</span></label>
            <select
              value={form.projectId}
              onChange={(e) => update('projectId', Number(e.target.value))}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.key})</option>
              ))}
            </select>
          </div>

          {/* Issue Type toggle */}
          <div className="create-issue-field">
            <label>Issue Type</label>
            <div className="create-issue-type-selector">
              {ISSUE_TYPES.map((type) => {
                const meta = TYPE_META[type] || { icon: '\u{1F4CC}', label: type }
                const isActive = form.issueType === type
                return (
                  <button
                    key={type}
                    type="button"
                    data-type={type}
                    className={`create-issue-type-btn${isActive ? ' create-issue-type-btn--active' : ''}`}
                    onClick={() => update('issueType', type)}
                  >
                    <span className="create-issue-type-icon">{meta.icon}</span>
                    {meta.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Status */}
          <div className="create-issue-field">
            <label>Status</label>
            <select
              value={form.status}
              onChange={(e) => update('status', e.target.value)}
            >
              {ISSUE_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <hr className="create-issue-separator" />

          {/* Summary */}
          <div className="create-issue-field">
            <label>
              Summary <span className="create-issue-required">*</span>
            </label>
            <input
              required
              placeholder="What needs to be done?"
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="create-issue-field">
            <label>
              Description <span className="create-issue-required">*</span>
            </label>
            <textarea
              required
              rows={6}
              placeholder="Add a description..."
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
            />
          </div>

          <hr className="create-issue-separator" />

          {/* Assignee + Reporter */}
          <div className="create-issue-row">
            <div className="create-issue-field">
              <label>Assignee</label>
              <select
                value={form.assignee}
                onChange={(e) => update('assignee', e.target.value)}
              >
                {members.length === 0 && form.assignee && (
                  <option value={form.assignee}>{form.assignee}</option>
                )}
                {members.map((m) => (
                  <option key={m.id} value={m.name}>{m.name}</option>
                ))}
              </select>
            </div>

            <div className="create-issue-field">
              <label>Reporter</label>
              <div className="create-issue-reporter">
                <span className="create-issue-reporter-avatar">
                  {reporterName.charAt(0).toUpperCase()}
                </span>
                <span>{reporterName}</span>
              </div>
            </div>
          </div>

          {/* Priority + Sprint */}
          <div className="create-issue-row">
            <div className="create-issue-field">
              <label>Priority</label>
              <select
                value={form.priority}
                onChange={(e) => update('priority', e.target.value)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div className="create-issue-field">
              <label>Sprint</label>
              <select
                value={form.sprintId ?? ''}
                disabled={form.status === 'Backlog'}
                onChange={(e) => {
                  const val = e.target.value
                  update('sprintId', val === '' ? null : Number(val))
                }}
              >
                <option value="">{form.status === 'Backlog' ? 'N/A (Backlog)' : 'None'}</option>
                {sprints.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="create-issue-footer">
          <label className="create-issue-footer-left">
            <input
              type="checkbox"
              checked={createAnother}
              onChange={(e) => setCreateAnother(e.target.checked)}
            />
            Create another
          </label>

          <div className="create-issue-footer-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || !form.title.trim() || !form.description.trim()}
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
