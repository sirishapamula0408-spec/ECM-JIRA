import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, MenuItem, Paper,
  Stack, TablePagination, TextField, Typography,
} from '@mui/material'
import { fetchActivity } from '../../api/dashboardApi'
import { fetchProjects } from '../../api/projectApi'
import { fetchMembers } from '../../api/memberApi'
import { EmptyState } from '../../components/common/EmptyState'
import { RelativeTime } from '../../components/common/RelativeTime'
import './ActivityFeedPage.css'
import { usePageTitle } from '../../hooks/usePageTitle'

const ACTIVITY_TYPES = [
  { value: '', label: 'All types' },
  { value: 'issue', label: 'Issues' },
  { value: 'comment', label: 'Comments' },
  { value: 'sprint', label: 'Sprints' },
  { value: 'general', label: 'General' },
]

export function ActivityFeedPage() {
  usePageTitle('Activity')
  const [activities, setActivities] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [projects, setProjects] = useState([])
  const [members, setMembers] = useState([])
  const [filters, setFilters] = useState({ type: '', projectId: '', actor: '', dateFrom: '', dateTo: '' })
  // JL-380: offset-based pagination replaces the old IntersectionObserver
  // infinite scroll, so a user can jump straight to any page of the feed.
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)
  // Monotonic id of the in-flight request, used to ignore stale responses.
  const requestIdRef = useRef(0)

  useEffect(() => {
    fetchProjects().then((d) => setProjects(Array.isArray(d) ? d : [])).catch(() => {})
    fetchMembers().then((d) => setMembers(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  // JL-380: load the requested page whenever the filters or the paging state
  // change. `page` is reset inside handleFilterChange rather than in a second
  // effect, so a filter change and its page reset land in the same render —
  // loadData is therefore re-created (and the effect below fires) exactly once
  // per user action instead of once for the filter and again for the reset.
  // The request-id guard drops the response of a superseded request so a slow
  // earlier page can never overwrite a newer one.
  const loadData = useCallback(async () => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError('')
    try {
      const data = await fetchActivity({
        type: filters.type || undefined,
        projectId: filters.projectId || undefined,
        actor: filters.actor || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        limit: rowsPerPage,
        offset: page * rowsPerPage,
      })
      if (requestId !== requestIdRef.current) return
      setActivities(Array.isArray(data?.activities) ? data.activities : [])
      setTotal(data?.total ?? 0)
    } catch (err) {
      if (requestId !== requestIdRef.current) return
      // JL-380: surface the failure instead of swallowing it — an errored load
      // used to be indistinguishable from an empty feed.
      setError(err?.message || 'Failed to load activity')
      setActivities([])
      setTotal(0)
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [filters, page, rowsPerPage])

  useEffect(() => { loadData() }, [loadData])

  function handleFilterChange(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }))
    // JL-380: a new filter set means a new result set — go back to page 1 so we
    // never request an out-of-range offset. Batched with setFilters above.
    setPage(0)
  }

  return (
    <Box className="page activity-feed-page" sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={2}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Activity Feed</Typography>
          <Typography variant="body2" color="text.secondary">
            Chronological record of issue, comment and sprint activity across your projects.
          </Typography>
        </Box>
        <Chip size="small" label={`${total} activities`} />
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center" useFlexGap>
          <TextField select size="small" label="Type" InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }} sx={{ minWidth: 150 }}
            value={filters.type} onChange={(e) => handleFilterChange('type', e.target.value)}>
            {ACTIVITY_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Project" InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }} sx={{ minWidth: 170 }}
            value={filters.projectId} onChange={(e) => handleFilterChange('projectId', e.target.value)}>
            <MenuItem value="">All projects</MenuItem>
            {projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Member" InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }} sx={{ minWidth: 170 }}
            value={filters.actor} onChange={(e) => handleFilterChange('actor', e.target.value)}>
            <MenuItem value="">All members</MenuItem>
            {members.map((m) => <MenuItem key={m.id} value={m.name}>{m.name}</MenuItem>)}
          </TextField>
          <TextField size="small" label="From" type="date" InputLabelProps={{ shrink: true }}
            value={filters.dateFrom} onChange={(e) => handleFilterChange('dateFrom', e.target.value)} />
          <TextField size="small" label="To" type="date" InputLabelProps={{ shrink: true }}
            value={filters.dateTo} onChange={(e) => handleFilterChange('dateTo', e.target.value)} />
          <Button variant="text" onClick={() => setFilters({ type: '', projectId: '', actor: '', dateFrom: '', dateTo: '' })}>
            Clear
          </Button>
        </Stack>
      </Paper>

      <div className="af-timeline">
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>
        )}

        {/* JL-380: loading / error / empty / loaded are mutually exclusive, so a
            failed load never renders as an empty feed. */}
        {error ? null : loading ? (
          <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>
        ) : activities.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No activity found"
            description="Issue updates, comments and sprint changes will appear here. Try widening the filters or a different date range."
          />
        ) : (
          activities.map((a) => (
            <div key={a.id} className="af-item">
              <div className="af-item-avatar">
                {(a.actor || 'U').slice(0, 2).toUpperCase()}
              </div>
              <div className="af-item-content">
                <div className="af-item-header">
                  <span className="af-actor">{a.actor}</span>
                  <RelativeTime
                    className="af-time"
                    value={a.created_at || a.happened_at}
                    fallback={<span className="af-time">Just now</span>}
                  />
                </div>
                <p className="af-action">{a.action}</p>
                {a.activity_type && a.activity_type !== 'general' && (
                  <span className="af-type-badge">{a.activity_type}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {!error && (total > 0 || activities.length > 0) && (
        <TablePagination
          component="div"
          className="af-pagination"
          count={total}
          page={page}
          onPageChange={(_event, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(event) => {
            setRowsPerPage(parseInt(event.target.value, 10))
            setPage(0)
          }}
          rowsPerPageOptions={[10, 25, 50, 100]}
          labelRowsPerPage="Activities per page"
          SelectProps={{ native: true, inputProps: { 'aria-label': 'Activities per page' } }}
        />
      )}
    </Box>
  )
}
