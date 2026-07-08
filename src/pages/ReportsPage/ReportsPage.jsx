import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Button,
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import PrintIcon from '@mui/icons-material/Print'
import { useIssues } from '../../context/IssueContext'
import { useSprints } from '../../context/SprintContext'
import { StatCard } from '../../components/ui/StatCard'
import { SvgBarChart } from '../../components/charts/SvgBarChart'
import { SvgLineChart } from '../../components/charts/SvgLineChart'
import { fetchSprintReport, fetchCreatedResolved } from '../../api/dashboardApi'
import { downloadCSV } from '../../utils/reportExport'
import './ReportsPage.css'

export function ReportsPage() {
  const { issues } = useIssues()
  const { sprints } = useSprints()
  const { projectId } = useParams()

  // JL-87: Sprint Report state
  const sprintOptions = useMemo(() => {
    const list = Array.isArray(sprints) ? sprints : []
    if (!projectId) return list
    const allIssues = Array.isArray(issues) ? issues : []
    const idsForProject = new Set(
      allIssues.filter((i) => i.projectId === Number(projectId)).map((i) => i.sprintId).filter(Boolean),
    )
    return list.filter((s) => idsForProject.has(s.id))
  }, [sprints, issues, projectId])

  const [selectedSprintId, setSelectedSprintId] = useState('')
  const [sprintReport, setSprintReport] = useState(null)
  const [sprintLoading, setSprintLoading] = useState(false)
  const [sprintError, setSprintError] = useState(null)

  // Default the picker to the active (or first) sprint once options load.
  useEffect(() => {
    if (!sprintOptions.length) {
      setSelectedSprintId('')
      return
    }
    setSelectedSprintId((prev) => {
      if (prev && sprintOptions.some((s) => s.id === prev)) return prev
      const active = sprintOptions.find((s) => s.isStarted) || sprintOptions[0]
      return active ? active.id : ''
    })
  }, [sprintOptions])

  useEffect(() => {
    if (!selectedSprintId) {
      setSprintReport(null)
      return
    }
    let active = true
    setSprintLoading(true)
    setSprintError(null)
    fetchSprintReport(selectedSprintId)
      .then((data) => { if (active) setSprintReport(data) })
      .catch((err) => { if (active) setSprintError(err.message || 'Failed to load sprint report') })
      .finally(() => { if (active) setSprintLoading(false) })
    return () => { active = false }
  }, [selectedSprintId])

  // JL-87: Created vs Resolved state
  const [crDays, setCrDays] = useState(30)
  const [createdResolved, setCreatedResolved] = useState(null)

  useEffect(() => {
    let active = true
    fetchCreatedResolved({ projectId: projectId ? Number(projectId) : undefined, days: crDays })
      .then((data) => { if (active) setCreatedResolved(data) })
      .catch(() => { if (active) setCreatedResolved(null) })
    return () => { active = false }
  }, [projectId, crDays])

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

  // JL-87: Sprint Report — committed vs completed points bar
  const sprintSummary = sprintReport?.summary || null
  const sprintChartData = sprintSummary
    ? [
        {
          label: 'Points',
          committed: sprintSummary.committedPoints || 0,
          completed: sprintSummary.completedPoints || 0,
        },
      ]
    : []

  // JL-87: Created vs Resolved — two-series line chart
  const crSeries = Array.isArray(createdResolved?.series) ? createdResolved.series : []
  const crChartData = crSeries.map((row) => ({
    label: row.date?.slice(5) || row.date,
    created: row.created,
    resolved: row.resolved,
  }))
  const crChartSeries = [
    { key: 'created', name: 'Created', color: '#4c9aff' },
    { key: 'resolved', name: 'Resolved', color: '#36b37e' },
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

      {/* JL-87: Sprint Report */}
      <article className="panel chart-placeholder sprint-report-panel">
        <div className="reports-panel-header">
          <h3>Sprint Report</h3>
          <FormControl size="small" className="no-print" sx={{ minWidth: 200 }}>
            <InputLabel id="sprint-report-label">Sprint</InputLabel>
            <Select
              labelId="sprint-report-label"
              label="Sprint"
              value={sprintOptions.some((s) => s.id === selectedSprintId) ? selectedSprintId : ''}
              onChange={(e) => setSelectedSprintId(e.target.value)}
            >
              {sprintOptions.map((s) => (
                <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </div>
        {sprintError && <p className="banner" style={{ color: 'var(--jira-danger, #de350b)' }}>{sprintError}</p>}
        {!sprintOptions.length && <div className="fake-chart">No sprints available</div>}
        {sprintOptions.length > 0 && sprintLoading && !sprintReport && <div className="fake-chart">Loading…</div>}
        {sprintSummary && (
          <div className="two-col">
            <div>
              <div className="stats-grid">
                <StatCard label="Committed" value={`${sprintSummary.committedPoints} pts`} />
                <StatCard label="Completed" value={`${sprintSummary.completedPoints} pts`} />
                <StatCard label="Added (scope)" value={`${sprintSummary.scopeChange.addedPoints} pts`} />
                <StatCard label="Removed (scope)" value={`${sprintSummary.scopeChange.removedPoints} pts`} />
              </div>
              <Table size="small" className="sprint-report-table">
                <TableHead>
                  <TableRow>
                    <TableCell>Category</TableCell>
                    <TableCell align="right">Issues</TableCell>
                    <TableCell align="right">Points</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow>
                    <TableCell>Completed</TableCell>
                    <TableCell align="right">{sprintSummary.completedIssues}</TableCell>
                    <TableCell align="right">{sprintSummary.completedPoints}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Not completed</TableCell>
                    <TableCell align="right">{sprintSummary.notCompletedIssues}</TableCell>
                    <TableCell align="right">{sprintSummary.notCompletedPoints}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Removed</TableCell>
                    <TableCell align="right">{sprintSummary.removedIssues}</TableCell>
                    <TableCell align="right">{sprintSummary.removedPoints}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <div>
              <div className="velocity-legend">
                <span><i className="velocity-legend-dot committed" />Committed</span>
                <span><i className="velocity-legend-dot completed" />Completed</span>
              </div>
              <SvgBarChart
                data={sprintChartData}
                series={chartSeries}
                width={360}
                height={240}
                ariaLabel="Sprint report: committed vs completed points"
              />
            </div>
          </div>
        )}
      </article>

      {/* JL-87: Created vs Resolved */}
      <article className="panel chart-placeholder created-resolved-panel">
        <div className="reports-panel-header">
          <h3>Created vs Resolved</h3>
          <FormControl size="small" className="no-print" sx={{ minWidth: 140 }}>
            <InputLabel id="cr-days-label">Range</InputLabel>
            <Select
              labelId="cr-days-label"
              label="Range"
              value={crDays}
              onChange={(e) => setCrDays(Number(e.target.value))}
            >
              <MenuItem value={7}>Last 7 days</MenuItem>
              <MenuItem value={14}>Last 14 days</MenuItem>
              <MenuItem value={30}>Last 30 days</MenuItem>
              <MenuItem value={90}>Last 90 days</MenuItem>
            </Select>
          </FormControl>
        </div>
        <div className="velocity-legend">
          <span><i className="velocity-legend-dot committed" />Created ({createdResolved?.totals?.created ?? 0})</span>
          <span><i className="velocity-legend-dot completed" />Resolved ({createdResolved?.totals?.resolved ?? 0})</span>
        </div>
        {crChartData.length > 0 ? (
          <SvgLineChart
            data={crChartData}
            series={crChartSeries}
            width={720}
            height={260}
            ariaLabel="Created versus resolved issues per day"
          />
        ) : (
          <div className="fake-chart">No created/resolved data available</div>
        )}
      </article>
    </section>
  )
}
