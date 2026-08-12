import { DueDateBadge } from './DueDateBadge'
import { ImpedimentFlagIndicator } from './ImpedimentFlag'
import { CopyButton } from '../common/CopyButton'
import { StatusLozenge } from '../common/StatusLozenge'
import { IssueTypeIcon } from '../icons/IssueTypeIcon'
import { avatarStyle } from '../../utils/avatarColour'

/**
 * JL-388: normalise the row's estimate.
 *
 * The column used to render a hardcoded `-` with no data binding at all, so
 * every row looked unestimated. `storyPoints` is on the issue already — the API
 * maps `storyPoints: row.story_points ?? null` — and the backlog sort
 * (`sortValue`, BacklogPage) reads it the same way. Returns null when there is
 * genuinely no estimate so the caller can render *nothing* rather than a dash;
 * 0 is a real estimate and is kept.
 */
function storyPointValue(storyPoints) {
  if (storyPoints === null || storyPoints === undefined || storyPoints === '') return null
  const points = Number(storyPoints)
  return Number.isNaN(points) ? null : points
}

export function BacklogIssueRow({ issue, onMove, onOpen, isSelected, onToggleSelect, onDragStart, onDragEnd, blocked, canEdit = true }) {
  const nextStatus = issue.status === 'Backlog' ? 'To Do' : issue.status === 'To Do' ? 'In Progress' : 'Done'
  const isBlocked = !!blocked?.isBlocked
  const blockers = blocked?.blockedBy || []
  const points = storyPointValue(issue.storyPoints)

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
        <IssueTypeIcon type={issue.issueType} />
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
        {points !== null && (
          <span
            className="backlog-points-badge"
            title={`Estimate: ${points} ${points === 1 ? 'story point' : 'story points'}`}
            aria-label={`Estimate: ${points} ${points === 1 ? 'story point' : 'story points'}`}
          >
            {points}
          </span>
        )}
        <StatusLozenge
          className="backlog-status-lozenge"
          status={issue.status}
          onChange={(next) => onMove(issue.id, next)}
          readOnly={!canEdit}
          context={issue.key}
        />
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
