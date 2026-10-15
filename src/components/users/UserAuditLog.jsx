import { useCallback, useEffect, useState } from 'react'
import {
  Box,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import TablePagination from '@mui/material/TablePagination'
import { fetchUserAuditLog } from '../../api/memberApi.js'
import './UserAuditLog.css'

// JL-197: mountable, self-contained audit-trail viewer for user-administration
// actions. Fetches newest-first, with target (email/id) and action filters.
// Integration into the User Management page happens on another branch.

const ACTION_OPTIONS = [
  { value: '', label: 'All actions' },
  { value: 'role_changed', label: 'Role changed' },
  { value: 'member_created', label: 'Member created' },
  { value: 'member_invited', label: 'Member invited' },
  { value: 'deactivated', label: 'Deactivated' },
  { value: 'reactivated', label: 'Reactivated' },
  { value: 'deleted', label: 'Deleted' },
  { value: 'login_blocked', label: 'Login blocked' },
]

const ACTION_COLORS = {
  role_changed: 'info',
  member_created: 'success',
  member_invited: 'primary',
  deactivated: 'warning',
  reactivated: 'success',
  deleted: 'error',
  login_blocked: 'error',
}

function formatChange(entry) {
  const { before_value: before, after_value: after } = entry
  if (before != null && after != null) return `${before} → ${after}`
  if (after != null) return `${after}`
  if (before != null) return `${before}`
  return '—'
}

function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString()
}

export default function UserAuditLog() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [target, setTarget] = useState('')
  const [action, setAction] = useState('')
  // JL-204: page through the whole trail. The API used to return only the
  // newest entries, so anything older than that could not be seen at all.
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)
  const [total, setTotal] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchUserAuditLog({
        target: target.trim() || undefined,
        action: action || undefined,
        limit: rowsPerPage,
        offset: page * rowsPerPage,
      })
      const items = Array.isArray(result) ? result : result?.items
      setEntries(Array.isArray(items) ? items : [])
      setTotal(Array.isArray(result) ? result.length : Number(result?.total || 0))
    } catch (err) {
      setError(err?.data?.error || err?.message || 'Failed to load audit log')
      setEntries([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [target, action, page, rowsPerPage])

  useEffect(() => {
    load()
  }, [load])

  return (
    <Box className="user-audit-log">
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        alignItems={{ sm: 'center' }}
        sx={{ mb: 2 }}
      >
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          User administration audit log
        </Typography>
        <TextField
          size="small"
          label="Target email or id"
          value={target}
          onChange={(e) => { setTarget(e.target.value); setPage(0) }}
          sx={{ minWidth: 220 }}
        />
        <TextField
          size="small"
          select
          label="Action"
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(0) }}
          sx={{ minWidth: 180 }}
        >
          {ACTION_OPTIONS.map((opt) => (
            <MenuItem key={opt.value || 'all'} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      {loading && entries.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      ) : entries.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 3 }}>
          No audit entries found.
        </Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label="user audit log">
            <TableHead>
              <TableRow>
                <TableCell>When</TableCell>
                <TableCell>Actor</TableCell>
                <TableCell>Action</TableCell>
                <TableCell>Target</TableCell>
                <TableCell>Change</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id} hover>
                  <TableCell>{formatDate(entry.created_at)}</TableCell>
                  <TableCell>{entry.actor || 'System'}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={entry.action}
                      color={ACTION_COLORS[entry.action] || 'default'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    {entry.target_email || (entry.target_member_id != null ? `#${entry.target_member_id}` : '—')}
                  </TableCell>
                  <TableCell>{formatChange(entry)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {/* JL-204: same paging control as the users table above. */}
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_e, next) => setPage(next)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0) }}
            rowsPerPageOptions={[10, 25, 50, 100]}
            labelRowsPerPage="Entries per page"
          />
        </TableContainer>
      )}
    </Box>
  )
}
