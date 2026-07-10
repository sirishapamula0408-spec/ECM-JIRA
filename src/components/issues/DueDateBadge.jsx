import { dueStatus, parseDueDate } from '../../utils/dueStatus'

export function DueDateBadge({ dueDate, status }) {
  if (status === 'Done') return null
  const state = dueStatus(dueDate)
  if (!state) return null
  const due = parseDueDate(dueDate)
  const formatted = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const label = state === 'overdue' ? 'Overdue' : state === 'soon' ? 'Due soon' : formatted
  return (
    <span className={`due-badge due-badge-${state}`} title={`Due ${formatted}`}>
      {label}
    </span>
  )
}
