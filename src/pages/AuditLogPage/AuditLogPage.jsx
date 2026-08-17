import { useCallback, useEffect, useState } from 'react'
import {
  Box, Button, Chip, Paper, Stack, TextField, Typography, Table, TableHead,
  TableRow, TableCell, TableBody, Alert, CircularProgress, TablePagination,
} from '@mui/material'
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser'
import GppMaybeIcon from '@mui/icons-material/GppMaybe'
import DownloadIcon from '@mui/icons-material/Download'
import { usePermissions } from '../../hooks/usePermissions'
import { EmptyState } from '../../components/common/EmptyState'
import { RelativeTime } from '../../components/common/RelativeTime'
import { fetchAuditLog, verifyAuditLog, downloadAuditExport } from '../../api/auditLogApi'
import './AuditLogPage.css'
import { usePageTitle } from '../../hooks/usePageTitle'

const EMPTY_FILTERS = { actor: '', action: '', dateFrom: '', dateTo: '' }

// JL-402: matches the ListPage convention so paging feels the same across the app.
const ROWS_PER_PAGE_OPTIONS = [10, 25, 50]

export function AuditLogPage() {
  usePageTitle('Audit Log')
  const { isAdmin } = usePermissions()
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(0)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [loading, setLoading] = useState(false)
  const [verify, setVerify] = useState(null)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  // JL-402: the endpoint has always supported limit/offset and reported a true
  // `total`; the page just ignored both and showed the first serverside page
  // with no way to reach the rest.
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(ROWS_PER_PAGE_OPTIONS[1])

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    fetchAuditLog({ ...filters, limit: rowsPerPage, offset: page * rowsPerPage })
      .then((data) => {
        setEntries(Array.isArray(data?.entries) ? data.entries : [])
        setTotal(data?.total ?? 0)
      })
      .catch((err) => setError(err.message || 'Failed to load audit log'))
      .finally(() => setLoading(false))
  }, [filters, page, rowsPerPage])

  useEffect(() => { if (isAdmin) load() }, [load, isAdmin])

  // A narrowed filter can leave the user on a page that no longer exists, which
  // would show an empty table over a non-zero total. Go back to the first page
  // whenever the filters change.
  useEffect(() => { setPage(0) }, [filters])

  async function handleVerify() {
    setVerifying(true)
    setVerify(null)
    try {
      const res = await verifyAuditLog()
      setVerify(res)
    } catch (err) {
      setVerify({ ok: false, error: err.message })
    } finally {
      setVerifying(false)
    }
  }

  async function handleExport(format) {
    try {
      await downloadAuditExport(format, filters)
    } catch (err) {
      setError(err.message || 'Export failed')
    }
  }

  if (!isAdmin) {
    return (
      <Box className="page audit-log-page" sx={{ p: 3 }}>
        <EmptyState icon="🔒" title="Admins only" description="The audit log is restricted to workspace administrators." />
      </Box>
    )
  }

  return (
    <Box className="page audit-log-page" sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={2}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Audit Log</Typography>
          <Typography variant="body2" color="text.secondary">
            Tamper-evident, hash-chained record of security-relevant events.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            color={verify == null ? 'primary' : verify.ok ? 'success' : 'error'}
            startIcon={verifying ? <CircularProgress size={16} color="inherit" /> : verify?.ok === false ? <GppMaybeIcon /> : <VerifiedUserIcon />}
            onClick={handleVerify}
            disabled={verifying}
          >
            Verify integrity
          </Button>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => handleExport('csv')}>CSV</Button>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => handleExport('json')}>JSON</Button>
        </Stack>
      </Stack>

      {verify && (
        <Alert severity={verify.ok ? 'success' : 'error'} sx={{ mb: 2 }} onClose={() => setVerify(null)}>
          {verify.ok
            ? `Chain intact — ${verify.count} entr${verify.count === 1 ? 'y' : 'ies'} verified.`
            : verify.error
              ? `Verification failed: ${verify.error}`
              : `Tampering detected! The chain breaks at entry #${verify.brokenAt}.`}
        </Alert>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center" useFlexGap>
          <TextField size="small" label="Actor" value={filters.actor}
            onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value }))} />
          <TextField size="small" label="Action" value={filters.action}
            onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))} />
          {/* JL-402: date-only. Filtering an audit log to the minute is noise.
              The server widens a date-only `To` to the end of that day — see
              buildFilters() — so From == To returns that day's entries rather
              than nothing. */}
          <TextField size="small" label="From" type="date" InputLabelProps={{ shrink: true }}
            value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
          <TextField size="small" label="To" type="date" InputLabelProps={{ shrink: true }}
            value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} />
          <Button variant="text" onClick={() => setFilters(EMPTY_FILTERS)}>Clear</Button>
        </Stack>
      </Paper>

      {loading ? (
        <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>
      ) : entries.length === 0 ? (
        <EmptyState icon="📜" title="No audit entries" description="Security-relevant events (logins, role changes, webhook changes) will appear here." />
      ) : (
        <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
          <Table size="small" className="audit-log-table">
            <TableHead>
              <TableRow>
                {/* JL-402: Target, Metadata and Hash are gone from the table.
                    Metadata was a stringified JSON blob and Hash a truncated
                    digest, and together they pushed the table into sideways
                    scrolling. The hash chain itself is untouched — it still
                    backs Verify integrity and both exports. */}
                <TableCell>#</TableCell>
                <TableCell>Actor</TableCell>
                <TableCell>Action</TableCell>
                <TableCell>Time</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id ?? e.seq}>
                  <TableCell>{e.seq}</TableCell>
                  <TableCell>{e.actor || '—'}</TableCell>
                  <TableCell><Chip size="small" label={e.action} /></TableCell>
                  <TableCell><RelativeTime value={e.created_at} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {/* JL-402: replaces the old "Showing N of M" caption, which reported
              the truncation without offering any way past it. `count` is the
              server's total, not entries.length, so the control knows how many
              pages actually exist. */}
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_event, next) => setPage(next)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(event) => {
              setRowsPerPage(parseInt(event.target.value, 10))
              setPage(0)
            }}
            rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
            labelRowsPerPage="Rows per page"
            SelectProps={{ native: true, inputProps: { 'aria-label': 'Rows per page' } }}
          />
        </Paper>
      )}
    </Box>
  )
}

export default AuditLogPage
