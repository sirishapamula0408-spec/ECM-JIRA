import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useIssues } from '../../context/IssueContext'
import { useSprints } from '../../context/SprintContext'
import { StatCard } from '../../components/ui/StatCard'
import './ReportsPage.css'

export function ReportsPage() {
  const { issues } = useIssues()
  const { sprints } = useSprints()
  const { projectId } = useParams()

  const computed = useMemo(() => {
    const allIssues = Array.isArray(issues) ? issues : []
    const issueList = projectId ? allIssues.filter((issue) => issue.projectId === Number(projectId)) : allIssues
    const allSprints = Array.isArray(sprints) ? sprints : []
    // Filter sprints to only those containing issues for the current project
    const projectIssueSprintIds = projectId ? new Set(issueList.map((issue) => issue.sprintId).filter(Boolean)) : null
    const sprintList = projectIssueSprintIds ? allSprints.filter((sprint) => projectIssueSprintIds.has(sprint.id)) : allSprints
    const pointsByType = { Story: 8, Bug: 5, Task: 3 }
    const toPoints = (issue) => pointsByType[issue.issueType] ?? 3
    const round = (value) => Math.round(value)

    const totalIssues = issueList.length
    const doneIssues = issueList.filter((issue) => issue.status === 'Done').length
    const totalPoints = issueList.reduce((sum, issue) => sum + toPoints(issue), 0)

    const high = issueList.filter((issue) => issue.priority === 'High').length
    const medium = issueList.filter((issue) => issue.priority === 'Medium').length
    const low = issueList.filter((issue) => issue.priority === 'Low').length
    const divisor = totalIssues || 1

    const sprintTrend = sprintList.map((sprint) => {
      const sprintIssues = issueList.filter((issue) => issue.sprintId === sprint.id)
      const committedPoints = sprintIssues.reduce((sum, issue) => sum + toPoints(issue), 0)
      const completedPoints = sprintIssues.filter((issue) => issue.status === 'Done').reduce((sum, issue) => sum + toPoints(issue), 0)
      return { id: sprint.id, name: sprint.name, committedPoints, completedPoints }
    })

    const sprintVelocity = sprintTrend.filter((item) => item.committedPoints > 0)
    const velocityAverage = sprintVelocity.length ? sprintVelocity.reduce((sum, item) => sum + item.completedPoints, 0) / sprintVelocity.length : 0

    const activeSprint = sprintList.find((sprint) => sprint.isStarted) || sprintList[0] || null
    const activeSprintIssues = activeSprint ? issueList.filter((issue) => issue.sprintId === activeSprint.id) : []
    const activeTotal = activeSprintIssues.length
    const activeDone = activeSprintIssues.filter((issue) => issue.status === 'Done').length

    return {
      totalPoints,
      velocityAverage: Number(velocityAverage.toFixed(1)),
      completionRate: round((doneIssues / (totalIssues || 1)) * 100),
      sprintProgress: round((activeDone / (activeTotal || 1)) * 100),
      priorityDistribution: { critical: round((high / divisor) * 100), medium: round((medium / divisor) * 100), low: round((low / divisor) * 100) },
      velocityTrend: sprintTrend,
    }
  }, [issues, sprints, projectId])

  const reportData = computed
  const trend = Array.isArray(reportData.velocityTrend) ? reportData.velocityTrend : []
  const maxPoints = Math.max(1, ...trend.map((item) => item.committedPoints))
  const critical = reportData.priorityDistribution?.critical || 0
  const medium = reportData.priorityDistribution?.medium || 0
  const low = reportData.priorityDistribution?.low || 0
  const neutral = Math.max(0, 100 - (critical + medium + low))
  const donutBackground = `conic-gradient(#de350b 0 ${critical}%, #ff991f ${critical}% ${critical + medium}%, #0065ff ${critical + medium}% ${critical + medium + low}%, #dfe1e6 ${critical + medium + low}% ${critical + medium + low + neutral}%)`

  const allIssues = Array.isArray(issues) ? issues : []
  const hasIssues = projectId
    ? allIssues.some((issue) => issue.projectId === Number(projectId))
    : allIssues.length > 0

  return (
    <section className="page">
      <h1>Reporting Dashboard</h1>
      {!hasIssues && projectId && (
        <p className="banner" style={{ textAlign: 'center', color: 'var(--jira-text-muted)', padding: '12px' }}>
          No issues found for this project. Create issues to see report data.
        </p>
      )}
      <div className="stats-grid">
        <StatCard label="Total Points" value={reportData.totalPoints || 0} />
        <StatCard label="Velocity Avg" value={reportData.velocityAverage || 0} />
        <StatCard label="Completion Rate" value={`${reportData.completionRate || 0}%`} />
        <StatCard label="Sprint Progress" value={`${reportData.sprintProgress || 0}%`} />
      </div>
      <div className="two-col">
        <article className="panel chart-placeholder">
          <h3>Velocity Chart</h3>
          {trend.length > 0 ? (
            <>
              <div className="velocity-legend">
                <span><i className="velocity-legend-dot committed" />Committed</span>
                <span><i className="velocity-legend-dot completed" />Completed</span>
              </div>
              <div className="velocity-chart">
                {trend.map((item) => (
                  <div key={item.id} className="velocity-group">
                    <div className="velocity-bars">
                      <span className="velocity-bar velocity-bar-committed" style={{ height: `${Math.max(6, Math.round((item.committedPoints / maxPoints) * 100))}%` }} title={`${item.name} committed: ${item.committedPoints}`} />
                      <span className="velocity-bar velocity-bar-completed" style={{ height: `${Math.max(6, Math.round((item.completedPoints / maxPoints) * 100))}%` }} title={`${item.name} completed: ${item.completedPoints}`} />
                    </div>
                    <small>{item.name}</small>
                  </div>
                ))}
              </div>
            </>
          ) : (<div className="fake-chart">No sprint data available</div>)}
        </article>
        <article className="panel chart-placeholder">
          <h3>Priority Distribution</h3>
          <div className="donut" style={{ background: donutBackground }} />
          <p>Critical: {critical}%</p>
          <p>Medium: {medium}%</p>
          <p>Low: {low}%</p>
        </article>
      </div>
    </section>
  )
}
