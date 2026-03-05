import { useState, useMemo } from 'react'
import { useMembers } from '../../context/MemberContext'
import { useAuth } from '../../context/AuthContext'
import { createProject } from '../../api/projectApi'
import { displayNameFromEmail } from '../../utils/helpers'
import './CreateProjectModal.css'

export function CreateProjectModal({ onClose, onProjectCreated }) {
  const { members, profile } = useMembers()
  const { authUser } = useAuth()

  // Derive the logged-in user's display name and build the lead options
  const { loggedInName, leadOptions } = useMemo(() => {
    const email = authUser?.email || ''
    const derivedName = displayNameFromEmail(email) || profile?.full_name || ''

    // Check if the logged-in user already exists in members
    const existsInMembers = members.some((m) =>
      m.email?.toLowerCase() === email.toLowerCase() ||
      m.name?.toLowerCase() === derivedName.toLowerCase()
    )

    // Build options: logged-in user first, then remaining members
    const options = existsInMembers
      ? members
      : derivedName
        ? [{ id: 'current-user', name: derivedName, email }, ...members]
        : members

    return { loggedInName: derivedName, leadOptions: options }
  }, [members, authUser, profile])

  const [form, setForm] = useState({
    name: '',
    key: '',
    type: 'Scrum',
    lead: loggedInName,
  })
  const [keyTouched, setKeyTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function generateKey(name) {
    const words = name.trim().split(/\s+/).filter(Boolean)
    if (words.length <= 1) {
      return (words[0] || '').toUpperCase().slice(0, 4)
    }
    return words.map((w) => w[0]).join('').toUpperCase().slice(0, 4)
  }

  function updateName(value) {
    setForm((c) => ({
      ...c,
      name: value,
      ...(!keyTouched ? { key: generateKey(value) } : {}),
    }))
  }

  function updateKey(value) {
    setKeyTouched(true)
    setForm((c) => ({ ...c, key: value.toUpperCase().slice(0, 10) }))
  }

  function update(field, value) {
    setForm((c) => ({ ...c, [field]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    setSubmitError('')
    setSaving(true)

    try {
      await createProject({
        name: form.name,
        key: form.key,
        type: form.type,
        lead: form.lead,
      })
      if (onProjectCreated) onProjectCreated()
      onClose()
    } catch (err) {
      setSubmitError(err.message || 'Failed to create project')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <form
        className="create-project-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        {/* Header */}
        <div className="create-project-header">
          <h2>Create project</h2>
          <button
            type="button"
            className="create-project-close"
            onClick={onClose}
            aria-label="Close"
          >
            &#x2715;
          </button>
        </div>

        {/* Body */}
        <div className="create-project-body">
          {submitError && <p className="create-project-error">{submitError}</p>}

          {/* Project Name */}
          <div className="create-project-field">
            <label>
              Project name <span className="create-project-required">*</span>
            </label>
            <input
              required
              placeholder="e.g. Website Redesign"
              value={form.name}
              onChange={(e) => updateName(e.target.value)}
            />
          </div>

          {/* Key */}
          <div className="create-project-field">
            <label>
              Key <span className="create-project-required">*</span>
            </label>
            <input
              required
              placeholder="e.g. WEB"
              value={form.key}
              onChange={(e) => updateKey(e.target.value)}
            />
            <span className="create-project-hint">
              Auto-generated from project name. Used as prefix for issue keys.
            </span>
          </div>

          <hr className="create-project-separator" />

          {/* Type + Lead */}
          <div className="create-project-row">
            <div className="create-project-field">
              <label>Project type</label>
              <select
                value={form.type}
                onChange={(e) => update('type', e.target.value)}
              >
                <option value="Scrum">Scrum</option>
                <option value="Kanban">Kanban</option>
                <option value="Bug tracking">Bug tracking</option>
              </select>
            </div>

            <div className="create-project-field">
              <label>Project lead <span className="create-project-required">*</span></label>
              <select
                required
                value={form.lead}
                onChange={(e) => update('lead', e.target.value)}
              >
                <option value="">Select lead</option>
                {leadOptions.map((m) => (
                  <option key={m.id} value={m.name}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="create-project-footer">
          <div className="create-project-footer-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || !form.name.trim() || !form.key.trim() || !form.lead}
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
