import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Stack } from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import PrintIcon from '@mui/icons-material/Print'
import { useIssues } from '../../context/IssueContext'
import { useSprints } from '../../context/SprintContext'
import { StatCard } from '../../components/ui/StatCard'
import { SvgBarChart } from '../../components/charts/SvgBarChart'
import { SvgLineChart } from '../../components/charts/SvgLineChart'
import { fetchCycleTime } from '../../api/dashboardApi'
import { downloadCSV } from '../../utils/reportExport'
import './ReportsPage.css'

// JL-51: bin cycleDays into up to 6 buckets → { label, count } for a histogram.
function buildHistogram(cycleValues) {
  if (!cycleValues.length) return []
  const max = Math.max(...cycleValues)
  const binCount = Math.min(6, Math.max(1, Math.ceil(max) || 1))
  const size = Math.max(1, Math.ceil(max / binCount) || 1)
  const bins = Array.from({ length: binCount }, (_, i) => ({
    label: `${i * size}-${(i + 1) * size}d`,
    count: 0,
  }))
  for (const v of cycleValues) {
    const idx = Math.min(bins.length - 1, Math.floor(v / size))
    bins[idx].count += 1
  }
  return bins
}

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
  const critical = reportData.priorityDistribution?.critical || 0
  const medium = reportData.priorityDistribution?.medium || 0
  const low = reportData.priorityDistribution?.low || 0
  const neutral = Math.max(0, 100 - (critical + medium + low))
  const donutBackground = `conic-gradient(#de350b 0 ${critical}%, #ff991f ${critical}% ${critical + medium}%, #0065ff ${critical + medium}% ${critical + medium + low}%, #dfe1e6 ${critical + medium + low}% ${critical + medium + low + neutral}%)`

  const allIssues = Array.isArray(issues) ? issues : []
  const hasIssues = projectId
    ? allIssues.some((issue) => issue.projectId === Number(projectId))
    : allIssues.length > 0

  const chartData = trend.map((item) => ({
    label: item.name,
    committed: item.committedPoints,
    completed: item.completedPoints,
  }))
  const chartSeries = [
    { key: 'committed', name: 'Committed', color: '#4c9aff' },
    { key: 'completed', name: 'Completed', color: '#36b37e' },
  ]

  const handleExportCsv = () => {
    const rows = [
      { metric: 'Total Points', value: reportData.totalPoints || 0 },
      { metric: 'Velocity Avg', value: reportData.velocityAverage || 0 },
      { metric: 'Completion Rate (%)', value: reportData.completionRate || 0 },
      { metric: 'Sprint Progress (%)', value: reportData.sprintProgress || 0 },
      { metric: 'Priority Critical (%)', value: critical },
      { metric: 'Priority Medium (%)', value: reportData.priorityDistribution?.medium || 0 },
      { metric: 'Priority Low (%)', value: reportData.priorityDistribution?.low || 0 },
    ]
    const velocityRows = trend.map((item) => ({
      metric: `Sprint: ${item.name} committed`,
      value: item.committedPoints,
    }))
    const velocityDoneRows = trend.map((item) => ({
      metric: `Sprint: ${item.name} completed`,
      value: item.completedPoints,
    }))
    const filename = projectId ? `report-project-${projectId}.csv` : 'report.csv'
    downloadCSV(filename, [...rows, ...velocityRows, ...velocityDoneRows], [
      { key: 'metric', label: 'Metric' },
      { key: 'value', label: 'Value' },
    ])
  }

  // JL-51: Cycle Time Analytics — fetched from the backend (issue_history based).
  const [cycleTime, setCycleTime] = useState(null)
  const [cycleLoading, setCycleLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setCycleLoading(true)
    fetchCycleTime(projectId ? Number(projectId) : undefined)
      .then((data) => { if (!cancelled) setCycleTime(data) })
      .catch(() => { if (!cancelled) setCycleTime(null) })
      .finally(() => { if (!cancelled) setCycleLoading(false) })
    return () => { cancelled = true }
  }, [projectId])

  const cycleIssues = Array.isArray(cycleTime?.issues) ? cycleTime.issues : []
  const cycleSummary = cycleTime?.summary || null
  const scatterData = cycleIssues
    .filter((i) => i.cycleDays !== null && i.cycleDays !== undefined)
    .map((i) => ({ label: `${i.key} (${new Date(i.doneAt).toLocaleDateString()})`, cycleDays: i.cycleDays }))
  const histogramData = buildHistogram(scatterData.map((d) => d.cycleDays))
  const fmt = (v) => (v === null || v === undefined ? '—' : v)

  const handlePrint = () => window.print()

  return (
    <section className="page reports-page">
      <div className="reports-header no-print">
        <h1>Reporting Dashboard</h1>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={handleExportCsv}>
            Export CSV
          </Button>
          <Button size="small" variant="outlined" startIcon={<PrintIcon />} onClick={handlePrint}>
            Print / PDF
          </Button>
        </Stack>
      </div>
      <h1 className="print-only reports-print-title">Reporting Dashboard</h1>
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
              <SvgBarChart
                data={chartData}
                series={chartSeries}
                width={480}
                height={240}
                ariaLabel="Velocity chart: committed vs completed points per sprint"
              />
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

      <div className="cycle-time-section">
        <h2>Cycle Time Analytics</h2>
        {cycleLoading ? (
          <p className="banner" style={{ color: 'var(--jira-text-muted)', padding: '12px' }}>Loading cycle time…</p>
        ) : cycleIssues.length === 0 ? (
          <p className="banner" style={{ color: 'var(--jira-text-muted)', padding: '12px' }}>
            No completed issues with status history yet. Move issues through In Progress → Done to see cycle time.
          </p>
        ) : (
          <>
            <div className="stats-grid">
              <StatCard label="Cycle p50" value={`${fmt(cycleSummary?.cycle?.p50)}d`} />
              <StatCard label="Cycle p85" value={`${fmt(cycleSummary?.cycle?.p85)}d`} />
              <StatCard label="Cycle p95" value={`${fmt(cycleSummary?.cycle?.p95)}d`} />
              <StatCard label="Cycle Avg" value={`${fmt(cycleSummary?.cycle?.average)}d`} />
              <StatCard label="Lead p50" value={`${fmt(cycleSummary?.lead?.p50)}d`} />
              <StatCard label="Lead p85" value={`${fmt(cycleSummary?.lead?.p85)}d`} />
              <StatCard label="Lead p95" value={`${fmt(cycleSummary?.lead?.p95)}d`} />
              <StatCard label="Lead Avg" value={`${fmt(cycleSummary?.lead?.average)}d`} />
            </div>
            <div className="two-col">
              <article className="panel chart-placeholder">
                <h3>Cycle Time per Issue (days)</h3>
                {scatterData.length > 0 ? (
                  <SvgLineChart
                    data={scatterData}
                    series={[{ key: 'cycleDays', name: 'Cycle days', color: '#6554c0' }]}
                    width={480}
                    height={240}
                    ariaLabel="Cycle time in days per completed issue over time"
                  />
                ) : (<div className="fake-chart">No cycle data available</div>)}
              </article>
              <article className="panel chart-placeholder">
                <h3>Cycle Time Distribution</h3>
                {histogramData.length > 0 ? (
                  <SvgBarChart
                    data={histogramData}
                    series={[{ key: 'count', name: 'Issues', color: '#36b37e' }]}
                    width={480}
                    height={240}
                    ariaLabel="Histogram of issue counts per cycle-time bucket"
                  />
                ) : (<div className="fake-chart">No cycle data available</div>)}
              </article>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
