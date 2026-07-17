import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  CardContent,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import SaveIcon from '@mui/icons-material/Save'
import { SvgBarChart } from '../../components/charts/SvgBarChart'
import { SvgLineChart } from '../../components/charts/SvgLineChart'
import {
  REPORT_DIMENSIONS,
  REPORT_MEASURES,
  REPORT_CHART_TYPES,
  REPORT_FILTER_FIELDS,
  runReport,
  fetchSavedReports,
  createSavedReport,
  deleteSavedReport,
} from '../../api/reportBuilderApi'
import './ReportBuilderPage.css'

const PIE_COLORS = ['#4c9aff', '#36b37e', '#ff991f', '#de350b', '#6554c0', '#00b8d9', '#ff8b00', '#6b778c']

// Self-contained SVG pie/donut — no external chart library.
function SvgPie({ rows }) {
  const total = rows.reduce((sum, r) => sum + (Number(r.value) || 0), 0)
  if (!total) return <Typography color="text.secondary">No data to chart.</Typography>
  const size = 220
  const r = 90
  const cx = size / 2
  const cy = size / 2
  let angle = -Math.PI / 2
  const slices = rows.map((row, i) => {
    const frac = (Number(row.value) || 0) / total
    const start = angle
    const end = angle + frac * 2 * Math.PI
    angle = end
    const x1 = cx + r * Math.cos(start)
    const y1 = cy + r * Math.sin(start)
    const x2 = cx + r * Math.cos(end)
    const y2 = cy + r * Math.sin(end)
    const large = end - start > Math.PI ? 1 : 0
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
    return { d, color: PIE_COLORS[i % PIE_COLORS.length], label: row.label, value: row.value }
  })
  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Pie chart">
        {slices.map((s, i) => (
          <path key={i} d={s.d} fill={s.color} stroke="#fff" strokeWidth="1">
            <title>{`${s.label}: ${s.value}`}</title>
          </path>
        ))}
      </svg>
      <Stack spacing={0.5}>
        {slices.map((s, i) => (
          <Stack key={i} direction="row" spacing={1} alignItems="center">
            <span style={{ width: 12, height: 12, borderRadius: 2, background: s.color, display: 'inline-block' }} />
            <Typography variant="body2">
              {s.label}: <strong>{s.value}</strong>
            </Typography>
          </Stack>
        ))}
      </Stack>
    </div>
  )
}

const emptyFilter = () => ({ field: 'status', value: '' })

export function ReportBuilderPage() {
  const [dimension, setDimension] = useState('status')
  const [measure, setMeasure] = useState('count')
  const [chartType, setChartType] = useState('bar')
  const [filters, setFilters] = useState([])

  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const [saved, setSaved] = useState([])
  const [reportName, setReportName] = useState('')

  const loadSaved = () => {
    fetchSavedReports()
      .then(setSaved)
      .catch(() => setSaved([]))
  }

  useEffect(() => {
    loadSaved()
  }, [])

  const definition = () => ({
    dimension,
    measure,
    chartType,
    filters: filters.filter((f) => f.field && f.value !== ''),
  })

  const handleRun = async () => {
    setRunning(true)
    setError('')
    try {
      const def = definition()
      const res = await runReport(def, def.filters)
      setResult(res)
    } catch (e) {
      setError(e?.data?.error || e.message || 'Failed to run report')
      setResult(null)
    } finally {
      setRunning(false)
    }
  }

  const handleSave = async () => {
    if (!reportName.trim()) {
      setError('Enter a name to save the report')
      return
    }
    setError('')
    try {
      await createSavedReport({ name: reportName.trim(), definition: definition() })
      setReportName('')
      loadSaved()
    } catch (e) {
      setError(e?.data?.error || e.message || 'Failed to save report')
    }
  }

  const handleLoad = (report) => {
    const def = report.definition || {}
    setDimension(def.dimension || 'status')
    setMeasure(def.measure || 'count')
    setChartType(def.chartType || 'bar')
    setFilters(Array.isArray(def.filters) ? def.filters : [])
    setResult(null)
  }

  const handleDelete = async (id) => {
    try {
      await deleteSavedReport(id)
      loadSaved()
    } catch {
      /* ignore */
    }
  }

  const updateFilter = (idx, patch) => {
    setFilters((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)))
  }

  const rows = result?.rows || []
  const chartData = rows.map((r) => ({ label: r.label, value: r.value }))
  const measureLabel = REPORT_MEASURES.find((m) => m.key === measure)?.label || 'Value'

  return (
    <div className="page report-builder-page">
      <Typography variant="h4" sx={{ mb: 1, fontWeight: 600 }}>
        Report Builder
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Build a custom report: pick a dimension, a measure, a chart type and optional filters.
      </Typography>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems="flex-start">
        {/* Builder panel */}
        <Card sx={{ minWidth: 300, flex: '0 0 320px' }}>
          <CardContent>
            <Stack spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Group by (dimension)</InputLabel>
                <Select
                  label="Group by (dimension)"
                  value={dimension}
                  onChange={(e) => setDimension(e.target.value)}
                >
                  {REPORT_DIMENSIONS.map((d) => (
                    <MenuItem key={d.key} value={d.key}>
                      {d.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl fullWidth size="small">
                <InputLabel>Measure</InputLabel>
                <Select label="Measure" value={measure} onChange={(e) => setMeasure(e.target.value)}>
                  {REPORT_MEASURES.map((m) => (
                    <MenuItem key={m.key} value={m.key}>
                      {m.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl fullWidth size="small">
                <InputLabel>Chart type</InputLabel>
                <Select label="Chart type" value={chartType} onChange={(e) => setChartType(e.target.value)}>
                  {REPORT_CHART_TYPES.map((c) => (
                    <MenuItem key={c.key} value={c.key}>
                      {c.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Divider textAlign="left">
                <Typography variant="caption">Filters</Typography>
              </Divider>

              {filters.map((f, idx) => (
                <Stack key={idx} direction="row" spacing={1} alignItems="center">
                  <FormControl size="small" sx={{ minWidth: 110 }}>
                    <Select value={f.field} onChange={(e) => updateFilter(idx, { field: e.target.value })}>
                      {REPORT_FILTER_FIELDS.map((ff) => (
                        <MenuItem key={ff.key} value={ff.key}>
                          {ff.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <TextField
                    size="small"
                    placeholder="value"
                    value={f.value}
                    onChange={(e) => updateFilter(idx, { value: e.target.value })}
                  />
                  <IconButton
                    aria-label="Remove filter"
                    size="small"
                    onClick={() => setFilters((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() => setFilters((prev) => [...prev, emptyFilter()])}
              >
                Add filter
              </Button>

              <Button
                variant="contained"
                startIcon={<PlayArrowIcon />}
                onClick={handleRun}
                disabled={running}
              >
                {running ? 'Running…' : 'Run'}
              </Button>

              <Divider />

              <Stack direction="row" spacing={1}>
                <TextField
                  size="small"
                  label="Report name"
                  value={reportName}
                  onChange={(e) => setReportName(e.target.value)}
                  fullWidth
                />
                <Button variant="outlined" startIcon={<SaveIcon />} onClick={handleSave}>
                  Save
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        {/* Result panel */}
        <Stack spacing={3} sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Result
              </Typography>
              {!result && <Typography color="text.secondary">Run a report to see results.</Typography>}
              {result && rows.length === 0 && (
                <Typography color="text.secondary">No matching issues.</Typography>
              )}
              {result && rows.length > 0 && chartType === 'bar' && (
                <SvgBarChart
                  data={chartData}
                  series={[{ key: 'value', name: measureLabel, color: '#4c9aff' }]}
                  ariaLabel="Report bar chart"
                />
              )}
              {result && rows.length > 0 && chartType === 'line' && (
                <SvgLineChart
                  data={chartData}
                  series={[{ key: 'value', name: measureLabel, color: '#4c9aff' }]}
                  ariaLabel="Report line chart"
                />
              )}
              {result && rows.length > 0 && chartType === 'pie' && <SvgPie rows={rows} />}
              {result && rows.length > 0 && chartType === 'table' && (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{REPORT_DIMENSIONS.find((d) => d.key === dimension)?.label}</TableCell>
                      <TableCell align="right">{measureLabel}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.label}>
                        <TableCell>{row.label}</TableCell>
                        <TableCell align="right">{row.value}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Saved reports
              </Typography>
              {saved.length === 0 && (
                <Typography color="text.secondary">No saved reports yet.</Typography>
              )}
              <Stack spacing={1}>
                {saved.map((report) => (
                  <Stack
                    key={report.id}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <div>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {report.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {report.definition?.dimension} · {report.definition?.measure} ·{' '}
                        {report.definition?.chartType}
                      </Typography>
                    </div>
                    <Stack direction="row" spacing={1}>
                      <Button size="small" onClick={() => handleLoad(report)}>
                        Load
                      </Button>
                      <IconButton
                        aria-label="Delete report"
                        size="small"
                        onClick={() => handleDelete(report.id)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </Stack>
    </div>
  )
}

export default ReportBuilderPage
