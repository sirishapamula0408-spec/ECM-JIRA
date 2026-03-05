import { ISSUE_STATUSES } from '../../constants'

export function IssueRow({ issue, onMove, dark = false }) {
  const priorityClass = issue.priority === 'High' ? 'priority-high' : issue.priority === 'Medium' ? 'priority-medium' : 'priority-low'
  return (
    <div className={`issue-row${dark ? ' issue-row-dark' : ''}`}>
      <div className="issue-row-main">
        <strong>{issue.key}</strong>
        <p>{issue.title}</p>
      </div>
      <div className="issue-row-meta">
        <span className={`priority-mark ${priorityClass}`} />
        <span className="issue-type-badge">{issue.issueType}</span>
        <span className="issue-assignee">{issue.assignee?.slice(0, 2).toUpperCase()}</span>
        <select value={issue.status} onChange={(event) => onMove(issue.id, event.target.value)}>
          {ISSUE_STATUSES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
