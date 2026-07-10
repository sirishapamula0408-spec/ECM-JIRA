import { ISSUE_STATUSES } from '../../constants'
import { DueDateBadge } from './DueDateBadge'

export function BacklogIssueRow({ issue, onMove, onOpen, isSelected, onToggleSelect, onDragStart, onDragEnd, blocked }) {
  const nextStatus = issue.status === 'Backlog' ? 'To Do' : issue.status === 'To Do' ? 'In Progress' : 'Done'
  const isBlocked = !!blocked?.isBlocked
  const blockers = blocked?.blockedBy || []

  return (
    <div
      className={`backlog-issue-row${isSelected ? ' selected' : ''}`}
      draggable
      onDragStart={() => onDragStart(issue.id)}
      onDragEnd={onDragEnd}
    >
      <input
        className="backlog-checkbox"
        type="checkbox"
        checked={isSelected}
        onChange={() => onToggleSelect(issue.id)}
        aria-label={`Select ${issue.key}`}
      />
      <button className="backlog-issue-main backlog-issue-link" type="button" onClick={onOpen}>
        <small>{issue.key}</small>
        <strong>{issue.title}</strong>
      </button>
      {isBlocked && (
        <span
          className="backlog-blocked-chip"
          title={blockers.length ? `Blocked by ${blockers.join(', ')}` : 'Blocked by an open issue'}
          aria-label={blockers.length ? `Blocked by ${blockers.join(', ')}` : 'Blocked'}
        >
          ⛔ Blocked
        </span>
      )}
      <div className="backlog-issue-actions">
        <DueDateBadge dueDate={issue.dueDate} status={issue.status} />
        <span className="backlog-row-minus">-</span>
        <select
          className="backlog-status-select"
          value={issue.status}
          onChange={(event) => onMove(issue.id, event.target.value)}
          aria-label={`Status for ${issue.key}`}
        >
          {ISSUE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status.toUpperCase()}
            </option>
          ))}
        </select>
        <button
          className="flag-btn"
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onMove(issue.id, nextStatus)
          }}
        >
          ⚑
        </button>
        <span className="member-avatar">{issue.assignee.slice(0, 2).toUpperCase()}</span>
      </div>
    </div>
  )
}
