import { useState } from 'react'
import './ProjectAvatar.css'

/**
 * A project's icon: its uploaded logo, or the coloured square with the key's
 * first letter when it has none (or the logo fails to load).
 *
 * `className` is the call site's existing size/shape class (sidebar, list,
 * header, settings), so every place keeps its own dimensions. The logo URL is
 * same-origin and authenticated by the session cookie, so a plain <img> works.
 */
export function ProjectAvatar({ project, className = '' }) {
  const src = project?.logo_url || null
  // Remember which URL failed, so a NEW logo is tried again.
  const [failedSrc, setFailedSrc] = useState(null)
  const showLogo = Boolean(src) && failedSrc !== src

  return (
    <span
      className={`${className}${showLogo ? ' project-avatar--logo' : ''}`}
      style={showLogo ? undefined : { background: project?.avatar_color || '#0052cc' }}
      aria-hidden="true"
    >
      {showLogo
        ? <img className="project-avatar__img" src={src} alt="" onError={() => setFailedSrc(src)} />
        : String(project?.key || '?').charAt(0)}
    </span>
  )
}
