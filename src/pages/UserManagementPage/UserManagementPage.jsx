import { useEffect, useMemo, useState } from 'react'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import InputAdornment from '@mui/material/InputAdornment'
import Chip from '@mui/material/Chip'
import Avatar from '@mui/material/Avatar'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import SearchIcon from '@mui/icons-material/Search'
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline'

import { fetchMembers } from '../../api/memberApi'
import { EmptyState } from '../../components/common/EmptyState'
import './UserManagementPage.css'

const ROLE_ORDER = ['Owner', 'Admin', 'Member', 'Viewer']

const ROLE_CHIP_COLOR = {
  Owner: 'secondary',
  Admin: 'primary',
  Member: 'default',
  Viewer: 'default',
}

function formatLastActivity(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function UserManagementPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    fetchMembers()
      .then((data) => {
        if (!cancelled) setUsers(Array.isArray(data) ? data : [])
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message || 'Failed to load users.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const roleOptions = useMemo(() => {
    const found = new Set(users.map((u) => u.role).filter(Boolean))
    const known = ROLE_ORDER.filter((role) => found.has(role))
    const extra = [...found].filter((role) => !ROLE_ORDER.includes(role)).sort()
    return [...known, ...extra]
  }, [users])

  const statusOptions = useMemo(
    () => [...new Set(users.map((u) => u.status).filter(Boolean))].sort(),
    [users],
  )

  const hasLastActivity = useMemo(
    () => users.some((u) => u.last_activity_at || u.last_active_at),
    [users],
  )

  const normalizedQuery = query.trim().toLowerCase()
  const filtered = users.filter((user) => {
    if (roleFilter !== 'all' && user.role !== roleFilter) return false
    if (statusFilter !== 'all' && user.status !== statusFilter) return false
    if (!normalizedQuery) return true
    return (
      (user.name || '').toLowerCase().includes(normalizedQuery) ||
      (user.email || '').toLowerCase().includes(normalizedQuery)
    )
  })

  const hasActiveFilters = normalizedQuery !== '' || roleFilter !== 'all' || statusFilter !== 'all'

  return (
    <section className="page user-management-page">
      <div className="user-management-header">
        <div>
          <h1>User Management</h1>
          <p className="user-management-subtitle">
            Browse all workspace users. Search by name or email, and filter by role or status.
          </p>
        </div>
      </div>

      <div className="user-management-toolbar">
        <TextField
          className="user-management-search"
          size="small"
          placeholder="Search by name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          inputProps={{ 'aria-label': 'Search users' }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
        <TextField
          className="user-management-filter"
          size="small"
          select
          label="Role"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          SelectProps={{ native: true }}
          InputLabelProps={{ shrink: true }}
          inputProps={{ 'aria-label': 'Filter by role' }}
        >
          <option value="all">All roles</option>
          {roleOptions.map((role) => (
            <option key={role} value={role}>{role}</option>
          ))}
        </TextField>
        <TextField
          className="user-management-filter"
          size="small"
          select
          label="Status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          SelectProps={{ native: true }}
          InputLabelProps={{ shrink: true }}
          inputProps={{ 'aria-label': 'Filter by status' }}
        >
          <option value="all">All statuses</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </TextField>
        {!loading && !error && (
          <span className="user-management-count" aria-live="polite">
            {filtered.length} of {users.length} users
          </span>
        )}
      </div>

      {error && <Alert severity="error" className="user-management-alert">{error}</Alert>}

      <article className="panel user-management-table-shell">
        {loading ? (
          <div className="user-management-loading" role="status" aria-label="Loading users">
            <CircularProgress size={28} />
            <span>Loading users...</span>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<PeopleOutlineIcon fontSize="inherit" />}
            title={hasActiveFilters ? 'No users match your filters' : 'No users yet'}
            description={
              hasActiveFilters
                ? 'Try adjusting your search or clearing the role and status filters.'
                : 'Workspace users will appear here once members are invited.'
            }
          />
        ) : (
          <TableContainer className="user-management-table-container">
            <Table size="small" aria-label="Workspace users">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Status</TableCell>
                  {hasLastActivity && <TableCell>Last activity</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((user) => (
                  <TableRow key={user.id} hover>
                    <TableCell>
                      <div className="user-management-name-cell">
                        <Avatar className="user-management-avatar">
                          {(user.name || '?').slice(0, 2).toUpperCase()}
                        </Avatar>
                        <strong>{user.name}</strong>
                      </div>
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={user.role || 'Unknown'}
                        color={ROLE_CHIP_COLOR[user.role] || 'default'}
                        variant={user.role === 'Owner' || user.role === 'Admin' ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={user.status || 'Unknown'}
                        color={user.status === 'Active' ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    {hasLastActivity && (
                      <TableCell>{formatLastActivity(user.last_activity_at || user.last_active_at)}</TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </article>
    </section>
  )
}
