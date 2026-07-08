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
        {issue.watcherCount > 0 && (
          <span className="issue-watcher-count" title={`${issue.watcherCount} watcher${issue.watcherCount === 1 ? '' : 's'}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
            {issue.watcherCount}
          </span>
        )}
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
