import { useState, useMemo, useEffect, useRef } from 'react'
import { useMembers } from '../../context/MemberContext'
import { useAuth } from '../../context/AuthContext'
import { createProject, uploadProjectLogo } from '../../api/projectApi'
import { projectLogoProblem, PROJECT_LOGO_TYPES } from '../../utils/projectLogo'
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
  // Optional logo, uploaded right after the project is created (the creator is
  // its Lead, so may set it). Previewed locally from an object URL.
  const [logoFile, setLogoFile] = useState(null)
  const [logoError, setLogoError] = useState('')
  // Set when the project was created but its logo upload failed: the modal stays
  // open to say so, and must not offer to create the project a second time.
  const [createdNotice, setCreatedNotice] = useState('')

  const logoPreview = useMemo(() => (logoFile ? URL.createObjectURL(logoFile) : ''), [logoFile])
  useEffect(() => () => { if (logoPreview) URL.revokeObjectURL(logoPreview) }, [logoPreview])

  const logoInputRef = useRef(null)

  async function chooseLogo(event) {
    const file = event.target.files?.[0] || null
    event.target.value = '' // so picking the same file again still fires
    if (!file) return
    // Checks the bytes too, so a non-image renamed .png is refused here rather
    // than after the project has been created.
    const problem = await projectLogoProblem(file)
    setLogoError(problem)
    // A refused pick also drops any earlier choice: what is shown (the error)
    // must match what Create would upload (nothing).
    setLogoFile(problem ? null : file)
  }

  function clearLogo() {
    setLogoFile(null)
    setLogoError('')
  }

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
      const created = await createProject({
        name: form.name,
        key: form.key,
        type: form.type,
        lead: form.lead,
        // JL-202: link the chosen lead's member — the server used to link the
        // creator instead. 'current-user' (not yet a member) sends no id.
        leadMemberId: Number.isInteger(leadOptions.find((m) => m.name === form.lead)?.id)
          ? leadOptions.find((m) => m.name === form.lead).id
          : undefined,
      })
      if (logoFile && created?.id) {
        try {
          await uploadProjectLogo(created.id, logoFile)
        } catch (err) {
          if (onProjectCreated) onProjectCreated()
          setCreatedNotice(`Project created, but the logo could not be uploaded: ${err.message || 'unknown error'}. You can add it later in Project settings → Details.`)
          return
        }
      }
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
          {createdNotice && <p className="create-project-error" role="alert">{createdNotice}</p>}

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

          {/* Logo (optional) */}
          <div className="create-project-field">
            <label htmlFor="create-project-logo">Project logo <span className="create-project-hint">(optional)</span></label>
            <div className="create-project-logo">
              <span
                className={`create-project-logo-preview${logoPreview ? ' create-project-logo-preview--image' : ''}`}
                aria-hidden="true"
              >
                {logoPreview ? <img src={logoPreview} alt="" /> : (form.key || form.name || '?').charAt(0).toUpperCase()}
              </span>
              {/* The native input is hidden: it read "No file chosen" while a
                  logo WAS chosen (the value is reset after each pick). The
                  button and file name below say what is actually selected. */}
              <input
                id="create-project-logo"
                ref={logoInputRef}
                type="file"
                accept={PROJECT_LOGO_TYPES.join(',')}
                onChange={chooseLogo}
                hidden
              />
              <button type="button" className="btn btn-ghost" onClick={() => logoInputRef.current?.click()}>
                {logoFile ? 'Change' : 'Choose image'}
              </button>
              {logoFile && (
                <>
                  <span className="create-project-logo-name" title={logoFile.name}>{logoFile.name}</span>
                  <button type="button" className="btn btn-ghost" onClick={clearLogo}>Remove</button>
                </>
              )}
            </div>
            {logoError
              ? <span className="create-project-error" role="alert">{logoError}</span>
              : <span className="create-project-hint">PNG, JPEG, GIF or WebP, up to 1 MB. You can change it later in Project settings.</span>}
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
            {createdNotice ? (
              <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
            ) : (
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || !form.name.trim() || !form.key.trim() || !form.lead}
              >
                {saving ? 'Creating...' : 'Create'}
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}
