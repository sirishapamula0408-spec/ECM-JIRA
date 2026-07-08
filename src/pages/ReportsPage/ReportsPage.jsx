import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, MenuItem, Stack, TextField } from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import PrintIcon from '@mui/icons-material/Print'
import { useIssues } from '../../context/IssueContext'
import { useSprints } from '../../context/SprintContext'
import { StatCard } from '../../components/ui/StatCard'
import { SvgBarChart } from '../../components/charts/SvgBarChart'
import { SvgAreaChart } from '../../components/charts/SvgAreaChart'
import { api } from '../../api/client'
import { downloadCSV } from '../../utils/reportExport'
import './ReportsPage.css'

// Band colours for the CFD, bottom → top (Done on top).
const CFD_STATUS_COLORS = {
  Backlog: '#c1c7d0',
  'To Do': '#4c9aff',
  'In Progress': '#ff991f',
  'Code Review': '#6554c0',
  Done: '#36b37e',
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

  // JL-50: Cumulative Flow Diagram — fetched from the reconstruction endpoint.
  const [cfdDays, setCfdDays] = useState(30)
  const [cfdGranularity, setCfdGranularity] = useState('daily')
  const [cfd, setCfd] = useState(null)
  const [cfdError, setCfdError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ days: String(cfdDays), granularity: cfdGranularity })
    if (projectId) params.set('projectId', String(projectId))
    setCfdError(null)
    api(`/api/reports/cfd?${params.toString()}`)
      .then((data) => { if (!cancelled) setCfd(data) })
      .catch((err) => { if (!cancelled) { setCfd(null); setCfdError(err.message || 'Failed to load CFD') } })
    return () => { cancelled = true }
  }, [projectId, cfdDays, cfdGranularity])

  const cfdChartData = useMemo(() => {
    if (!cfd || !Array.isArray(cfd.days)) return []
    return cfd.days.map((day) => ({ label: day.date, ...day.counts }))
  }, [cfd])

  const cfdSeries = useMemo(() => {
    const statuses = cfd?.statuses || []
    return statuses.map((status) => ({
      key: status,
      name: status,
      color: CFD_STATUS_COLORS[status] || '#4c9aff',
    }))
  }, [cfd])

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

      <article className="panel chart-placeholder cfd-panel">
        <div className="cfd-header">
          <h3>Cumulative Flow Diagram</h3>
          <Stack direction="row" spacing={1} className="no-print">
            <TextField
              select
              size="small"
              label="Range"
              value={cfdDays}
              onChange={(e) => setCfdDays(Number(e.target.value))}
              sx={{ minWidth: 130 }}
            >
              <MenuItem value={7}>Last 7 days</MenuItem>
              <MenuItem value={14}>Last 14 days</MenuItem>
              <MenuItem value={30}>Last 30 days</MenuItem>
              <MenuItem value={60}>Last 60 days</MenuItem>
              <MenuItem value={90}>Last 90 days</MenuItem>
            </TextField>
            <TextField
              select
              size="small"
              label="Granularity"
              value={cfdGranularity}
              onChange={(e) => setCfdGranularity(e.target.value)}
              sx={{ minWidth: 120 }}
            >
              <MenuItem value="daily">Daily</MenuItem>
              <MenuItem value="weekly">Weekly</MenuItem>
            </TextField>
          </Stack>
        </div>

        {cfd?.metrics && (
          <div className="cfd-metrics">
            <span><strong>Current WIP:</strong> {cfd.metrics.currentWip}</span>
            <span><strong>Avg lead time:</strong> {cfd.metrics.averageLeadTime} days</span>
          </div>
        )}

        {cfdError ? (
          <div className="fake-chart">Unable to load CFD: {cfdError}</div>
        ) : cfdChartData.length > 0 ? (
          <>
            <div className="cfd-legend">
              {cfdSeries.map((s) => (
                <span key={s.key}>
                  <i className="cfd-legend-dot" style={{ background: s.color }} />
                  {s.name}
                </span>
              ))}
            </div>
            <SvgAreaChart
              data={cfdChartData}
              series={cfdSeries}
              width={720}
              height={300}
              ariaLabel="Cumulative flow diagram: issue count per status over time"
            />
          </>
        ) : (
          <div className="fake-chart">No flow data available</div>
        )}
      </article>
    </section>
  )
}
