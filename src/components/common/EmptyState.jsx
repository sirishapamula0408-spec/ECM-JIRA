import './EmptyState.css'

/**
 * EmptyState — a reusable, accessible placeholder for "no data" situations.
 *
 * Props:
 *   icon        (optional node)   Illustrative icon/graphic shown above the title.
 *   title       (string, required) Short headline describing the empty state.
 *   description (optional string) Supporting copy explaining the state / next step.
 *   action      (optional node)   Call-to-action (e.g. a button) rendered below.
 *
 * Uses the spacing tokens from styles/variables.css for consistent rhythm.
 */
export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="empty-state" role="status">
      {icon != null && (
        <div className="empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className="empty-state__title">{title}</h3>
      {description != null && description !== '' && (
        <p className="empty-state__description">{description}</p>
      )}
      {action != null && <div className="empty-state__action">{action}</div>}
    </div>
  )
}

export default EmptyState
