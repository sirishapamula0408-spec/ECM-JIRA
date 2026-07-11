import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Button,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  FormControl,
  InputLabel,
  Select,
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
import { SvgAreaChart } from '../../components/charts/SvgAreaChart'
import { fetchBurndown, fetchBurnup, fetchCycleTime, fetchSprintReport, fetchCreatedResolved, fetchCapacity, setCapacity, fetchTimeInStatus, fetchControlChart } from '../../api/dashboardApi'
import { usePermissions } from '../../hooks/usePermissions'
import { api } from '../../api/client'
import { downloadCSV } from '../../utils/reportExport'
import { SlaPanel } from './SlaPanel'
import './ReportsPage.css'

// Band colours for the CFD, bottom → top (Done on top).
const CFD_STATUS_COLORS = {
  Backlog: '#c1c7d0',
  'To Do': '#4c9aff',
  'In Progress': '#ff991f',
  'Code Review': '#6554c0',
  Done: '#36b37e',
}

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

  // JL-53: Capacity Planning — per-assignee committed points vs capacity.
  const { canEditIssue } = usePermissions(projectId ? Number(projectId) : undefined)
  const [capacity, setCapacityData] = useState(null)
  const [capacityError, setCapacityError] = useState('')
  const [capacityDrafts, setCapacityDrafts] = useState({})
  const [capacitySaving, setCapacitySaving] = useState('')

  const loadCapacity = (sprintId) => {
    if (!sprintId) { setCapacityData(null); return }
    fetchCapacity(sprintId)
      .then((data) => { setCapacityData(data); setCapacityError('') })
      .catch((err) => { setCapacityData(null); setCapacityError(err?.message || 'Failed to load capacity') })
  }

  useEffect(() => {
    let cancelled = false
    if (!selectedSprintId) { setCapacityData(null); return }
    setCapacityError('')
    fetchCapacity(selectedSprintId)
      .then((data) => { if (!cancelled) setCapacityData(data) })
      .catch((err) => { if (!cancelled) { setCapacityData(null); setCapacityError(err?.message || 'Failed to load capacity') } })
    return () => { cancelled = true }
  }, [selectedSprintId])

  const handleSaveCapacity = async (assignee) => {
    const raw = capacityDrafts[assignee]
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0) return
    setCapacitySaving(assignee)
    try {
      await setCapacity({ sprintId: selectedSprintId, assignee, capacityPoints: value })
      setCapacityDrafts((prev) => { const next = { ...prev }; delete next[assignee]; return next })
      loadCapacity(selectedSprintId)
    } catch (err) {
      setCapacityError(err?.message || 'Failed to save capacity')
    } finally {
      setCapacitySaving('')
    }
  }

  const capacityRows = Array.isArray(capacity?.rows) ? capacity.rows : []
  const capacityChartData = capacityRows.map((r) => ({
    label: r.assignee,
    committed: r.committedPoints,
    capacity: r.capacityPoints,
  }))
  const capacityChartSeries = [
    { key: 'committed', name: 'Committed', color: '#4c9aff' },
    { key: 'capacity', name: 'Capacity', color: '#36b37e' },
  ]

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

  // JL-49: Burndown / Burnup — live chart data from the API. Reuses the shared
  // sprint picker (selectedSprintId / sprintOptions) defined above for JL-87.
  const [unit, setUnit] = useState('points')
  const [burndown, setBurndown] = useState(null)
  const [burnup, setBurnup] = useState(null)
  const [chartError, setChartError] = useState('')

  useEffect(() => {
    if (!selectedSprintId) {
      setBurndown(null)
      setBurnup(null)
      return
    }
    let cancelled = false
    setChartError('')
    Promise.all([fetchBurndown(selectedSprintId, unit), fetchBurnup(selectedSprintId, unit)])
      .then(([bd, bu]) => {
        if (cancelled) return
        setBurndown(bd)
        setBurnup(bu)
      })
      .catch((err) => {
        if (cancelled) return
        setChartError(err?.message || 'Failed to load chart data')
        setBurndown(null)
        setBurnup(null)
      })
    return () => { cancelled = true }
  }, [selectedSprintId, unit])

  const burndownData = (burndown?.days || []).map((d) => ({ label: d.date, ideal: d.ideal, remaining: d.remaining }))
  const burnupData = (burnup?.days || []).map((d) => ({ label: d.date, scope: d.scope, completed: d.completed }))
  const unitLabel = unit === 'count' ? 'issues' : 'points'

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

  // JL-155: Time-in-status metrics + control chart (project-scoped).
  const [timeInStatus, setTimeInStatus] = useState(null)
  const [controlChart, setControlChart] = useState(null)

  useEffect(() => {
    if (!projectId) { setTimeInStatus(null); setControlChart(null); return }
    let cancelled = false
    Promise.all([
      fetchTimeInStatus(Number(projectId)).catch(() => null),
      fetchControlChart(Number(projectId)).catch(() => null),
    ]).then(([tis, cc]) => {
      if (cancelled) return
      setTimeInStatus(tis)
      setControlChart(cc)
    })
    return () => { cancelled = true }
  }, [projectId])

  // Aggregated hours-per-status bar (JL-155).
  const tisStatuses = Array.isArray(timeInStatus?.statuses) ? timeInStatus.statuses : []
  const tisTotalsData = tisStatuses.map((status) => ({
    label: status,
    hours: timeInStatus?.totals?.[status]?.hours ?? 0,
  }))

  // Control chart: cycle-time scatter with rolling mean ± 1σ bands (JL-155).
  const ccPoints = Array.isArray(controlChart?.points) ? controlChart.points : []
  const controlChartData = ccPoints.map((p) => ({
    label: `${p.issueKey}`,
    cycle: p.cycleTimeHours,
    mean: p.rollingMean,
    upper: p.upper,
    lower: p.lower,
  }))

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

      {/* JL-49: Burndown / Burnup */}
      <div className="reports-sprint-controls no-print">
        <TextField
          select
          size="small"
          label="Sprint"
          value={sprintOptions.some((s) => s.id === selectedSprintId) ? selectedSprintId : ''}
          onChange={(event) => setSelectedSprintId(event.target.value)}
          sx={{ minWidth: 220 }}
          disabled={sprintOptions.length === 0}
        >
          {sprintOptions.length === 0 && <MenuItem value="">No sprints available</MenuItem>}
          {sprintOptions.map((sprint) => (
            <MenuItem key={sprint.id} value={sprint.id}>
              {sprint.name}{sprint.isStarted ? ' (active)' : ''}
            </MenuItem>
          ))}
        </TextField>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={unit}
          onChange={(_event, next) => { if (next) setUnit(next) }}
          aria-label="Chart unit"
        >
          <ToggleButton value="points">Points</ToggleButton>
          <ToggleButton value="count">Issues</ToggleButton>
        </ToggleButtonGroup>
      </div>

      {chartError && (
        <p className="banner" style={{ textAlign: 'center', color: 'var(--jira-danger, #de350b)', padding: '12px' }}>
          {chartError}
        </p>
      )}

      <div className="two-col">
        <article className="panel chart-placeholder">
          <h3>Burndown Chart</h3>
          {burndownData.length > 0 ? (
            <SvgLineChart
              data={burndownData}
              series={[
                { key: 'ideal', name: 'Ideal', color: '#c1c7d0' },
                { key: 'remaining', name: `Remaining ${unitLabel}`, color: '#4c9aff' },
              ]}
              width={480}
              height={260}
              ariaLabel={`Burndown chart: ideal vs remaining ${unitLabel}`}
            />
          ) : (
            <div className="fake-chart">
              {selectedSprintId ? 'No burndown data for this sprint' : 'Select a sprint to view its burndown'}
            </div>
          )}
        </article>
        <article className="panel chart-placeholder">
          <h3>Burnup Chart</h3>
          {burnupData.length > 0 ? (
            <SvgLineChart
              data={burnupData}
              series={[
                { key: 'scope', name: `Scope ${unitLabel}`, color: '#ff991f' },
                { key: 'completed', name: `Completed ${unitLabel}`, color: '#36b37e' },
              ]}
              width={480}
              height={260}
              ariaLabel={`Burnup chart: scope vs completed ${unitLabel}`}
            />
          ) : (
            <div className="fake-chart">
              {selectedSprintId ? 'No burnup data for this sprint' : 'Select a sprint to view its burnup'}
            </div>
          )}
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

      {/* JL-155: Time in status + Control chart (project-scoped) */}
      {projectId && (
        <div className="time-in-status-section">
          <h2>Time in Status</h2>
          <div className="two-col">
            <article className="panel chart-placeholder">
              <h3>Total Time per Status (hours)</h3>
              {tisTotalsData.length > 0 ? (
                <SvgBarChart
                  data={tisTotalsData}
                  series={[{ key: 'hours', name: 'Hours', color: '#6554c0' }]}
                  width={480}
                  height={240}
                  ariaLabel="Total hours all issues spent in each status"
                />
              ) : (
                <div className="fake-chart">
                  No status history yet. Move issues through statuses to see time-in-status.
                </div>
              )}
            </article>
            <article className="panel chart-placeholder">
              <h3>Control Chart — Cycle Time (hours)</h3>
              {controlChart?.count ? (
                <>
                  <div className="velocity-legend">
                    <span><i className="velocity-legend-dot committed" />Cycle time</span>
                    <span><i className="velocity-legend-dot completed" />Rolling mean</span>
                  </div>
                  <p className="cfd-metrics" style={{ margin: '4px 0 8px' }}>
                    <span><strong>Mean:</strong> {controlChart.mean}h</span>{' '}
                    <span><strong>Std dev:</strong> {controlChart.std}h</span>{' '}
                    <span><strong>n:</strong> {controlChart.count}</span>
                  </p>
                  <SvgLineChart
                    data={controlChartData}
                    series={[
                      { key: 'upper', name: 'Upper (μ+σ)', color: '#dfe1e6' },
                      { key: 'lower', name: 'Lower (μ-σ)', color: '#dfe1e6' },
                      { key: 'mean', name: 'Rolling mean', color: '#36b37e' },
                      { key: 'cycle', name: 'Cycle time', color: '#6554c0' },
                    ]}
                    width={480}
                    height={240}
                    ariaLabel="Control chart: per-issue cycle time with rolling mean and standard deviation bands"
                  />
                </>
              ) : (
                <div className="fake-chart">
                  No completed issues with status history yet.
                </div>
              )}
            </article>
          </div>
          {timeInStatus?.perIssue?.length > 0 && (
            <article className="panel chart-placeholder">
              <h3>Time in Status by Issue (hours)</h3>
              <Table size="small" className="time-in-status-table">
                <TableHead>
                  <TableRow>
                    <TableCell>Issue</TableCell>
                    {tisStatuses.map((s) => (
                      <TableCell key={s} align="right">{s}</TableCell>
                    ))}
                    <TableCell align="right">Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {timeInStatus.perIssue.map((row) => (
                    <TableRow key={row.issueKey}>
                      <TableCell>{row.issueKey}</TableCell>
                      {tisStatuses.map((s) => (
                        <TableCell key={s} align="right">
                          {row.byStatus?.[s]?.hours ?? 0}
                        </TableCell>
                      ))}
                      <TableCell align="right">{row.totalHours ?? 0}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </article>
          )}
        </div>
      )}

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

      {/* JL-53: Capacity Planning */}
      <article className="panel chart-placeholder capacity-panel">
        <div className="reports-panel-header">
          <h3>Capacity Planning</h3>
          <FormControl size="small" className="no-print" sx={{ minWidth: 200 }}>
            <InputLabel id="capacity-sprint-label">Sprint</InputLabel>
            <Select
              labelId="capacity-sprint-label"
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
        {capacityError && <p className="banner" style={{ color: 'var(--jira-danger, #de350b)' }}>{capacityError}</p>}
        {!selectedSprintId && <div className="fake-chart">Select a sprint to plan capacity</div>}
        {selectedSprintId && capacityRows.length === 0 && !capacityError && (
          <div className="fake-chart">No assignees with committed work in this sprint</div>
        )}
        {selectedSprintId && capacityRows.length > 0 && (
          <div className="two-col">
            <div>
              <Table size="small" className="capacity-table">
                <TableHead>
                  <TableRow>
                    <TableCell>Assignee</TableCell>
                    <TableCell align="right">Committed</TableCell>
                    <TableCell align="right">Capacity</TableCell>
                    <TableCell align="right">Utilization</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {capacityRows.map((row) => {
                    const draft = capacityDrafts[row.assignee]
                    const over = row.utilizationPct !== null && row.utilizationPct > 100
                    return (
                      <TableRow key={row.assignee}>
                        <TableCell>{row.assignee}</TableCell>
                        <TableCell align="right">{row.committedPoints} pts</TableCell>
                        <TableCell align="right">
                          {canEditIssue ? (
                            <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end">
                              <TextField
                                type="number"
                                size="small"
                                value={draft !== undefined ? draft : row.capacityPoints}
                                onChange={(e) => setCapacityDrafts((prev) => ({ ...prev, [row.assignee]: e.target.value }))}
                                inputProps={{ min: 0, style: { width: 64, textAlign: 'right' } }}
                                className="no-print"
                              />
                              <Button
                                size="small"
                                variant="text"
                                className="no-print"
                                disabled={draft === undefined || capacitySaving === row.assignee}
                                onClick={() => handleSaveCapacity(row.assignee)}
                              >
                                Save
                              </Button>
                            </Stack>
                          ) : (
                            `${row.capacityPoints} pts`
                          )}
                        </TableCell>
                        <TableCell align="right" style={over ? { color: 'var(--jira-danger, #de350b)', fontWeight: 600 } : undefined}>
                          {row.utilizationPct === null ? '—' : `${row.utilizationPct}%`}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <div>
              <div className="velocity-legend">
                <span><i className="velocity-legend-dot committed" />Committed</span>
                <span><i className="velocity-legend-dot completed" />Capacity</span>
              </div>
              <SvgBarChart
                data={capacityChartData}
                series={capacityChartSeries}
                width={360}
                height={240}
                ariaLabel="Capacity planning: committed points vs capacity per assignee"
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

      {/* JL-52: SLA Tracking & Alerts */}
      <SlaPanel projectId={projectId} />
    </section>
  )
}
