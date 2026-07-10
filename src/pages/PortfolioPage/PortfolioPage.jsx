import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { SvgBarChart } from '../../components/charts/SvgBarChart'
import { StatCard } from '../../components/ui/StatCard'
import { fetchPortfolioSummary } from '../../api/dashboardApi'
import './PortfolioPage.css'

// JL-154: Cross-project portfolio analytics — rolls up KPIs across every
// project the caller can see, with a per-project table + completion bar chart.
export function PortfolioPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchPortfolioSummary()
      .then((res) => {
        if (active) {
          setData(res)
          setError(null)
        }
      })
      .catch((err) => {
        if (active) setError(err.message || 'Failed to load portfolio')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const projects = data?.projects || []
  const aggregate = data?.aggregate || {
    projectCount: 0, total: 0, open: 0, done: 0, overdue: 0, completionPct: 0,
  }

  // Bar chart: completion % by project (reuses the shared SvgBarChart).
  const chartData = useMemo(
    () => projects.map((p) => ({ label: p.projectKey || p.name, value: p.completionPct })),
    [projects],
  )

  if (loading) {
    return (
      <div className="page portfolio-page">
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      </div>
    )
  }

  return (
    <div className="page portfolio-page">
      <header className="page-header">
        <Typography variant="h5" component="h1" fontWeight={600}>
          Portfolio
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Cross-project roll-up across every project you can access.
        </Typography>
      </header>

      {error && <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>}

      {!error && aggregate.projectCount === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, mt: 2, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            No accessible projects yet. Create or join a project to see portfolio analytics.
          </Typography>
        </Paper>
      ) : (
        <>
          <section className="stats-grid" aria-label="Portfolio summary">
            <StatCard label="Projects" value={aggregate.projectCount} />
            <StatCard label="Total issues" value={aggregate.total} />
            <StatCard label="Open" value={aggregate.open} />
            <StatCard label="Done" value={aggregate.done} />
            <StatCard label="Overdue" value={aggregate.overdue} />
            <StatCard label="Completion" value={`${aggregate.completionPct}%`} />
            <StatCard label="Throughput (30d)" value={data?.throughput30d ?? 0} />
          </section>

          <Paper variant="outlined" sx={{ p: 2, mt: 3 }}>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              Completion by project
            </Typography>
            {chartData.length > 0 ? (
              <SvgBarChart
                data={chartData}
                series={[{ key: 'value', name: 'Completion %', color: '#36b37e' }]}
                width={640}
                height={280}
                ariaLabel="Completion percentage by project"
              />
            ) : (
              <Typography variant="body2" color="text.secondary">No data</Typography>
            )}
          </Paper>

          <TableContainer component={Paper} variant="outlined" sx={{ mt: 3 }}>
            <Table size="small" aria-label="Per-project breakdown">
              <TableHead>
                <TableRow>
                  <TableCell>Project</TableCell>
                  <TableCell align="right">Total</TableCell>
                  <TableCell align="right">Open</TableCell>
                  <TableCell align="right">Done</TableCell>
                  <TableCell align="right">Overdue</TableCell>
                  <TableCell sx={{ minWidth: 160 }}>Completion</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {projects.map((p) => (
                  <TableRow key={p.projectId} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Chip label={p.projectKey} size="small" />
                        <span>{p.name}</span>
                      </Stack>
                    </TableCell>
                    <TableCell align="right">{p.total}</TableCell>
                    <TableCell align="right">{p.open}</TableCell>
                    <TableCell align="right">{p.done}</TableCell>
                    <TableCell align="right">
                      {p.overdue > 0
                        ? <Chip label={p.overdue} size="small" color="error" variant="outlined" />
                        : p.overdue}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <LinearProgress
                          variant="determinate"
                          value={Math.min(100, p.completionPct)}
                          sx={{ flex: 1, height: 8, borderRadius: 4 }}
                        />
                        <span style={{ minWidth: 36, textAlign: 'right' }}>{p.completionPct}%</span>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </div>
  )
}

export default PortfolioPage
