import { useEffect, useMemo, useState } from 'react'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TablePagination from '@mui/material/TablePagination'
import TextField from '@mui/material/TextField'
import InputAdornment from '@mui/material/InputAdornment'
import Chip from '@mui/material/Chip'
import Avatar from '@mui/material/Avatar'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import DialogContentText from '@mui/material/DialogContentText'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Accordion from '@mui/material/Accordion'
import AccordionSummary from '@mui/material/AccordionSummary'
import AccordionDetails from '@mui/material/AccordionDetails'
import SearchIcon from '@mui/icons-material/Search'
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline'
import PersonAddAltIcon from '@mui/icons-material/PersonAddAlt'
import HistoryIcon from '@mui/icons-material/History'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'

import {
  fetchMembers,
  createMember,
  updateMemberRole,
  deleteMember,
  deactivateMember,
  reactivateMember,
} from '../../api/memberApi'
import { EmptyState } from '../../components/common/EmptyState'
import { usePermissions } from '../../hooks/usePermissions'
import UserAuditLog from '../../components/users/UserAuditLog.jsx'
import './UserManagementPage.css'

const ROLE_ORDER = ['Owner', 'Admin', 'Member', 'Viewer']

// Roles an Admin may assign from the UI. The workspace Owner is protected and
// never offered as a selectable option.
const ASSIGNABLE_ROLES = ['Admin', 'Member', 'Viewer']

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

function isOwnerRow(user) {
  return Boolean(user.is_owner) || user.role === 'Owner'
}

const EMPTY_ADD_FORM = { name: '', email: '', role: 'Viewer', password: '' }

export function UserManagementPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  // JL-205: client-side pagination over the filtered list.
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)

  // Toast for success/guard-failure feedback.
  const [toast, setToast] = useState({ open: false, message: '', severity: 'success' })

  // Add-user dialog state.
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM)
  const [addError, setAddError] = useState('')
  const [addSubmitting, setAddSubmitting] = useState(false)

  // Confirm dialog for destructive/status actions: { type, user }.
  const [confirm, setConfirm] = useState(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  // JL-195/JL-197: the audit trail is only surfaced to workspace Admins/Owners.
  const { canManageUsers } = usePermissions()

  const showToast = (message, severity = 'success') =>
    setToast({ open: true, message, severity })
  const closeToast = () => setToast((prev) => ({ ...prev, open: false }))

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

  // JL-205: reset to the first page whenever the filter/search criteria change,
  // so you never land on a now-out-of-range page.
  useEffect(() => {
    setPage(0)
  }, [normalizedQuery, roleFilter, statusFilter])

  // Clamp the page in case the filtered set shrank (e.g. after a delete) and
  // slice the visible rows for the current page.
  const pageCount = Math.max(1, Math.ceil(filtered.length / rowsPerPage))
  const currentPage = Math.min(page, pageCount - 1)
  const paged = filtered.slice(
    currentPage * rowsPerPage,
    currentPage * rowsPerPage + rowsPerPage,
  )

  // --- Inline role edit (optimistic with rollback) -------------------------
  async function handleRoleChange(user, nextRole) {
    if (!nextRole || nextRole === user.role) return
    const previousRole = user.role
    // Optimistically reflect the new role.
    setUsers((current) =>
      current.map((u) => (u.id === user.id ? { ...u, role: nextRole } : u)),
    )
    try {
      const updated = await updateMemberRole(user.id, nextRole)
      setUsers((current) =>
        current.map((u) => (u.id === user.id ? { ...u, ...updated } : u)),
      )
      showToast(`Updated ${user.name || user.email} to ${nextRole}.`)
    } catch (err) {
      // Roll back to the previous role and surface the guard failure.
      setUsers((current) =>
        current.map((u) => (u.id === user.id ? { ...u, role: previousRole } : u)),
      )
      showToast(err?.message || 'Failed to update role.', 'error')
    }
  }

  // --- Add user ------------------------------------------------------------
  function openAddDialog() {
    setAddForm(EMPTY_ADD_FORM)
    setAddError('')
    setAddOpen(true)
  }

  function closeAddDialog() {
    if (addSubmitting) return
    setAddOpen(false)
  }

  async function handleAddSubmit(event) {
    event.preventDefault()
    const name = addForm.name.trim()
    const email = addForm.email.trim()
    if (!name || !email) {
      setAddError('Name and email are required.')
      return
    }
    const payload = { name, email, role: addForm.role }
    if (addForm.password.trim()) payload.password = addForm.password
    setAddSubmitting(true)
    setAddError('')
    try {
      const created = await createMember(payload)
      setUsers((current) => [...current, created])
      setAddOpen(false)
      setAddForm(EMPTY_ADD_FORM)
      showToast(
        payload.password
          ? `Created account for ${created.name || email}.`
          : `Invited ${created.name || email}.`,
      )
    } catch (err) {
      setAddError(err?.message || 'Failed to add user.')
      showToast(err?.message || 'Failed to add user.', 'error')
    } finally {
      setAddSubmitting(false)
    }
  }

  // --- Delete / deactivate / reactivate ------------------------------------
  function requestAction(type, user) {
    setConfirm({ type, user })
  }

  function closeConfirm() {
    if (confirmBusy) return
    setConfirm(null)
  }

  async function runConfirmedAction() {
    if (!confirm) return
    const { type, user } = confirm
    setConfirmBusy(true)
    try {
      if (type === 'delete') {
        await deleteMember(user.id)
        setUsers((current) => current.filter((u) => u.id !== user.id))
        showToast(`Removed ${user.name || user.email}.`)
      } else if (type === 'deactivate') {
        const updated = await deactivateMember(user.id)
        setUsers((current) =>
          current.map((u) =>
            u.id === user.id ? { ...u, ...updated, status: updated?.status || 'Deactivated' } : u,
          ),
        )
        showToast(`Deactivated ${user.name || user.email}.`)
      } else if (type === 'reactivate') {
        const updated = await reactivateMember(user.id)
        setUsers((current) =>
          current.map((u) =>
            u.id === user.id ? { ...u, ...updated, status: updated?.status || 'Active' } : u,
          ),
        )
        showToast(`Reactivated ${user.name || user.email}.`)
      }
      setConfirm(null)
    } catch (err) {
      // Leave the row unchanged and surface the guard failure.
      showToast(err?.message || 'Action failed.', 'error')
      setConfirm(null)
    } finally {
      setConfirmBusy(false)
    }
  }

  const confirmCopy = confirm
    ? {
        delete: {
          title: 'Remove user',
          body: `Remove ${confirm.user.name || confirm.user.email} from the workspace? This cannot be undone.`,
          action: 'Remove',
          color: 'error',
        },
        deactivate: {
          title: 'Deactivate user',
          body: `Deactivate ${confirm.user.name || confirm.user.email}? They will no longer be able to sign in.`,
          action: 'Deactivate',
          color: 'warning',
        },
        reactivate: {
          title: 'Reactivate user',
          body: `Reactivate ${confirm.user.name || confirm.user.email}? They will be able to sign in again.`,
          action: 'Reactivate',
          color: 'primary',
        },
      }[confirm.type]
    : null

  return (
    <section className="page user-management-page">
      <div className="user-management-header">
        <div>
          <h1>User Management</h1>
          <p className="user-management-subtitle">
            Browse all workspace users. Search by name or email, and filter by role or status.
          </p>
        </div>
        <Button
          variant="contained"
          startIcon={<PersonAddAltIcon />}
          onClick={openAddDialog}
        >
          Add user
        </Button>
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
            action={
              hasActiveFilters ? undefined : (
                <Button variant="contained" startIcon={<PersonAddAltIcon />} onClick={openAddDialog}>
                  Add user
                </Button>
              )
            }
          />
        ) : (
          <>
          <TableContainer className="user-management-table-container">
            <Table size="small" aria-label="Workspace users">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Status</TableCell>
                  {hasLastActivity && <TableCell>Last activity</TableCell>}
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paged.map((user) => {
                  const owner = isOwnerRow(user)
                  const deactivated = user.status === 'Deactivated'
                  const roleChoices = [...new Set([user.role, ...ASSIGNABLE_ROLES])].filter(
                    (r) => r && r !== 'Owner',
                  )
                  return (
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
                        {owner ? (
                          <Chip
                            size="small"
                            label={user.role || 'Owner'}
                            color={ROLE_CHIP_COLOR[user.role] || 'secondary'}
                            variant="filled"
                          />
                        ) : (
                          <Select
                            size="small"
                            variant="standard"
                            value={user.role || ''}
                            onChange={(e) => handleRoleChange(user, e.target.value)}
                            disableUnderline
                            className="user-management-role-select"
                            inputProps={{ 'aria-label': `Change role for ${user.name}` }}
                            SelectDisplayProps={{ 'aria-label': `Change role for ${user.name}` }}
                          >
                            {roleChoices.map((role) => (
                              <MenuItem key={role} value={role}>{role}</MenuItem>
                            ))}
                          </Select>
                        )}
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
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          {deactivated ? (
                            <Button
                              size="small"
                              color="primary"
                              onClick={() => requestAction('reactivate', user)}
                              aria-label={`Reactivate ${user.name}`}
                            >
                              Reactivate
                            </Button>
                          ) : (
                            <Button
                              size="small"
                              color="warning"
                              disabled={owner}
                              onClick={() => requestAction('deactivate', user)}
                              aria-label={`Deactivate ${user.name}`}
                            >
                              Deactivate
                            </Button>
                          )}
                          <Button
                            size="small"
                            color="error"
                            disabled={owner}
                            onClick={() => requestAction('delete', user)}
                            aria-label={`Delete ${user.name}`}
                          >
                            Delete
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            className="user-management-pagination"
            count={filtered.length}
            page={currentPage}
            onPageChange={(_event, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(event) => {
              setRowsPerPage(parseInt(event.target.value, 10))
              setPage(0)
            }}
            rowsPerPageOptions={[10, 25, 50, 100]}
            labelRowsPerPage="Users per page"
            SelectProps={{ native: true, inputProps: { 'aria-label': 'Users per page' } }}
          />
          </>
        )}
      </article>

      {/* JL-197: collapsible audit trail of user-administration actions.
          Rendered only for workspace Admins/Owners (canManageUsers). */}
      {canManageUsers && (
        <Accordion className="user-management-audit" disableGutters>
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            aria-controls="user-management-audit-content"
            id="user-management-audit-header"
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <HistoryIcon fontSize="small" />
              <Typography component="span">Audit log</Typography>
            </Stack>
          </AccordionSummary>
          <AccordionDetails id="user-management-audit-content">
            <UserAuditLog />
          </AccordionDetails>
        </Accordion>
      )}

      {/* Add-user dialog */}
      <Dialog open={addOpen} onClose={closeAddDialog} fullWidth maxWidth="xs">
        <form onSubmit={handleAddSubmit}>
          <DialogTitle>Add user</DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              Leave the password blank to email an invite, or set a temporary password to create the
              account directly.
            </DialogContentText>
            {addError && (
              <Alert severity="error" sx={{ mb: 2 }}>{addError}</Alert>
            )}
            <Stack spacing={2}>
              <TextField
                label="Full name"
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                inputProps={{ 'aria-label': 'Full name' }}
                required
                fullWidth
                autoFocus
              />
              <TextField
                label="Email"
                type="email"
                value={addForm.email}
                onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                inputProps={{ 'aria-label': 'Email' }}
                required
                fullWidth
              />
              <TextField
                label="Role"
                select
                value={addForm.role}
                onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value }))}
                SelectProps={{ native: true }}
                inputProps={{ 'aria-label': 'Role' }}
                fullWidth
              >
                {ASSIGNABLE_ROLES.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </TextField>
              <TextField
                label="Temporary password (optional)"
                type="password"
                value={addForm.password}
                onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))}
                inputProps={{ 'aria-label': 'Temporary password (optional)' }}
                fullWidth
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={closeAddDialog} disabled={addSubmitting}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={addSubmitting}>
              {addSubmitting ? 'Adding…' : 'Add user'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Confirm destructive/status action */}
      <Dialog open={Boolean(confirm)} onClose={closeConfirm} maxWidth="xs" fullWidth>
        {confirmCopy && (
          <>
            <DialogTitle>{confirmCopy.title}</DialogTitle>
            <DialogContent>
              <DialogContentText>{confirmCopy.body}</DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={closeConfirm} disabled={confirmBusy}>Cancel</Button>
              <Button
                variant="contained"
                color={confirmCopy.color}
                onClick={runConfirmedAction}
                disabled={confirmBusy}
              >
                {confirmCopy.action}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <Snackbar
        open={toast.open}
        autoHideDuration={5000}
        onClose={closeToast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={closeToast} severity={toast.severity} variant="filled" sx={{ width: '100%' }}>
          {toast.message}
        </Alert>
      </Snackbar>
    </section>
  )
}
