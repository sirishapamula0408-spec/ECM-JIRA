import { ISSUE_STATUSES } from '../../constants'
import { DueDateBadge } from './DueDateBadge'
import { ImpedimentFlagIndicator } from './ImpedimentFlag'
import { CopyButton } from '../common/CopyButton'
import { avatarStyle } from '../../utils/avatarColour'

export function BacklogIssueRow({ issue, onMove, onOpen, isSelected, onToggleSelect, onDragStart, onDragEnd, blocked, canEdit = true }) {
  const nextStatus = issue.status === 'Backlog' ? 'To Do' : issue.status === 'To Do' ? 'In Progress' : 'Done'
  const isBlocked = !!blocked?.isBlocked
  const blockers = blocked?.blockedBy || []

  return (
    <div
      className={`backlog-issue-row${isSelected ? ' selected' : ''}${issue.flagged ? ' backlog-issue-flagged' : ''}`}
      draggable={canEdit}
      onDragStart={canEdit ? () => onDragStart(issue.id) : undefined}
      onDragEnd={canEdit ? onDragEnd : undefined}
    >
      {canEdit && (
        <input
          className="backlog-checkbox"
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(issue.id)}
          aria-label={`Select ${issue.key}`}
        />
      )}
      <button className="backlog-issue-main backlog-issue-link" type="button" onClick={onOpen}>
        <small>{issue.key}</small>
        <strong>{issue.title}</strong>
      </button>
      <CopyButton
        className="backlog-copy-key"
        value={issue.key}
        title={`Copy issue key ${issue.key}`}
        ariaLabel={`Copy issue key ${issue.key}`}
      />
      {issue.flagged === true && (
        <span className="backlog-flagged-chip" title="Flagged as impediment">
          <ImpedimentFlagIndicator /> Flagged
        </span>
      )}
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
        {canEdit ? (
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
        ) : (
          <span className="backlog-status-readonly" aria-label={`Status for ${issue.key}`}>
            {issue.status.toUpperCase()}
          </span>
        )}
        {canEdit && (
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
        )}
        <span className="member-avatar" style={avatarStyle(issue.assignee)}>{issue.assignee.slice(0, 2).toUpperCase()}</span>
      </div>
    </div>
  )
}
