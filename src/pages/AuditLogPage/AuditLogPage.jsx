import { useCallback, useEffect, useState } from 'react'
import {
  Box, Button, Chip, Paper, Stack, TextField, Typography, Table, TableHead,
  TableRow, TableCell, TableBody, Alert, CircularProgress, Tooltip,
} from '@mui/material'
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser'
import GppMaybeIcon from '@mui/icons-material/GppMaybe'
import DownloadIcon from '@mui/icons-material/Download'
import { usePermissions } from '../../hooks/usePermissions'
import { EmptyState } from '../../components/common/EmptyState'
import { fetchAuditLog, verifyAuditLog, downloadAuditExport } from '../../api/auditLogApi'
import './AuditLogPage.css'

const EMPTY_FILTERS = { actor: '', action: '', dateFrom: '', dateTo: '' }

export function AuditLogPage() {
  const { isAdmin } = usePermissions()
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(0)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [loading, setLoading] = useState(false)
  const [verify, setVerify] = useState(null)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    fetchAuditLog(filters)
      .then((data) => {
        setEntries(Array.isArray(data?.entries) ? data.entries : [])
        setTotal(data?.total ?? 0)
      })
      .catch((err) => setError(err.message || 'Failed to load audit log'))
      .finally(() => setLoading(false))
  }, [filters])

  useEffect(() => { if (isAdmin) load() }, [load, isAdmin])

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
          <TextField size="small" label="From" type="datetime-local" InputLabelProps={{ shrink: true }}
            value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
          <TextField size="small" label="To" type="datetime-local" InputLabelProps={{ shrink: true }}
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
                <TableCell>#</TableCell>
                <TableCell>Actor</TableCell>
                <TableCell>Action</TableCell>
                <TableCell>Target</TableCell>
                <TableCell>Metadata</TableCell>
                <TableCell>Time</TableCell>
                <TableCell>Hash</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id ?? e.seq}>
                  <TableCell>{e.seq}</TableCell>
                  <TableCell>{e.actor || '—'}</TableCell>
                  <TableCell><Chip size="small" label={e.action} /></TableCell>
                  <TableCell>{e.target || '—'}</TableCell>
                  <TableCell className="audit-meta">
                    {e.metadata ? (typeof e.metadata === 'string' ? e.metadata : JSON.stringify(e.metadata)) : '—'}
                  </TableCell>
                  <TableCell>{e.created_at ? new Date(e.created_at).toLocaleString() : '—'}</TableCell>
                  <TableCell>
                    <Tooltip title={e.hash || ''}>
                      <code className="audit-hash">{e.hash ? `${e.hash.slice(0, 10)}…` : '—'}</code>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {total > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Showing {entries.length} of {total} entries
        </Typography>
      )}
    </Box>
  )
}

export default AuditLogPage
