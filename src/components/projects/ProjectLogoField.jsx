import { useRef, useState } from 'react'
import Button from '@mui/material/Button'
import { ProjectAvatar } from '../common/ProjectAvatar'
import { uploadProjectLogo, removeProjectLogo } from '../../api/projectApi'
import { projectLogoProblem, announceProjectChanged, PROJECT_LOGO_TYPES } from '../../utils/projectLogo'
import './ProjectLogoField.css'

/**
 * Project Settings → Details: the project's logo, with Upload/Change and Remove
 * for people who may change project settings (project Admin/Lead, workspace
 * Admin). Everyone else sees the logo only. The server enforces the same rule.
 *
 * @param {object}   props.project   the project (with logo_url)
 * @param {boolean}  props.canEdit   usePermissions().canManageProjectSettings
 * @param {Function} props.onChange  receives the updated project
 * @param {Function} props.onMessage receives { type: 'success'|'error', message }
 */
export function ProjectLogoField({ project, canEdit, onChange, onMessage }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const hasLogo = Boolean(project?.logo_url)

  async function run(action, success) {
    setBusy(true)
    try {
      const updated = await action()
      onChange?.(updated)
      announceProjectChanged(updated)
      onMessage?.({ type: 'success', message: success })
    } catch (err) {
      onMessage?.({ type: 'error', message: err?.message || 'Could not update the project logo' })
    } finally {
      setBusy(false)
    }
  }

  async function onFile(event) {
    const file = event.target.files?.[0]
    event.target.value = '' // choosing the same file again must fire onChange
    if (!file) return
    const problem = await projectLogoProblem(file)
    if (problem) {
      onMessage?.({ type: 'error', message: problem })
      return
    }
    run(() => uploadProjectLogo(project.id, file), 'Project logo updated.')
  }

  return (
    <div className="project-logo-field">
      <ProjectAvatar project={project} className="ps-avatar-display" />
      {canEdit && (
        <div className="project-logo-field__actions">
          <div className="project-logo-field__buttons">
            <Button variant="outlined" size="small" disabled={busy} onClick={() => inputRef.current?.click()}>
              {hasLogo ? 'Change logo' : 'Upload logo'}
            </Button>
            {hasLogo && (
              <Button
                variant="text"
                size="small"
                color="error"
                disabled={busy}
                onClick={() => run(() => removeProjectLogo(project.id), 'Project logo removed.')}
              >
                Remove
              </Button>
            )}
          </div>
          <span className="project-logo-field__hint">PNG, JPEG, GIF or WebP, up to 1 MB. A square image works best.</span>
          <input
            ref={inputRef}
            type="file"
            accept={PROJECT_LOGO_TYPES.join(',')}
            onChange={onFile}
            hidden
            aria-label="Project logo file"
          />
        </div>
      )}
    </div>
  )
}
