import { ISSUE_STATUSES } from '../../constants'

export function BacklogIssueRow({ issue, onMove, onOpen, isSelected, onToggleSelect, onDragStart, onDragEnd }) {
  const nextStatus = issue.status === 'Backlog' ? 'To Do' : issue.status === 'To Do' ? 'In Progress' : 'Done'

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
      <div className="backlog-issue-actions">
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
