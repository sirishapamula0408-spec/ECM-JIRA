import { useState, useEffect, useCallback, useMemo } from 'react'
import TablePagination from '@mui/material/TablePagination'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import { useMembers } from '../../context/MemberContext'
import { usePermissions } from '../../hooks/usePermissions'
import { fetchMembers, fetchInvitations, createInvitation, revokeInvitation, resendInvitation, deleteMember, bulkDeleteMembers } from '../../api/memberApi'
import { fetchSecurityPolicy, updateSecurityPolicy } from '../../api/securityPolicyApi'
import { fetchWorkspaceSettings, updateProjectCreationPolicy } from '../../api/workspaceApi'
import { LoadingState, ErrorState } from '../../components/common/LoadingState'
import './TeamsPage.css'
import { usePageTitle } from '../../hooks/usePageTitle'

export function TeamsPage() {
  usePageTitle('Teams')
  const { handleResendInvite: onResend } = useMembers()
  const { canInviteMembers, isAdmin } = usePermissions()

  // JL-248: TeamsPage owns member loading so it can show distinct
  // loading / error / empty states instead of silently swallowing a
  // failed load behind a misleading "No team members yet" message.
  const [members, setMembers] = useState([])
  const [membersLoading, setMembersLoading] = useState(true)
  const [membersError, setMembersError] = useState('')

  const loadMembers = useCallback(async () => {
    setMembersLoading(true)
    setMembersError('')
    try {
      const data = await fetchMembers()
      setMembers(Array.isArray(data) ? data : [])
    } catch (err) {
      setMembersError(err.message || 'Failed to load team members.')
    } finally {
      setMembersLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMembers()
  }, [loadMembers])

  // JL-248: surface otherwise-swallowed action errors (e.g. revoke) via a toast.
  const [feedback, setFeedback] = useState({ open: false, message: '', severity: 'error' })
  const showFeedback = (message, severity = 'error') => setFeedback({ open: true, message, severity })
  const closeFeedback = () => setFeedback((prev) => ({ ...prev, open: false }))

  // JL-248: confirm before revoking a pending invitation.
  const [revokeTarget, setRevokeTarget] = useState(null)
  const [revokeBusy, setRevokeBusy] = useState(false)

  // JL-252: single + bulk member delete (Admin/Owner only).
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)

  // JL-134: org-wide security policy (enforced 2FA + password rules)
  const [policy, setPolicy] = useState(null)
  const [policyState, setPolicyState] = useState({ saving: false, error: '', message: '' })

  const loadPolicy = useCallback(async () => {
    try {
      const p = await fetchSecurityPolicy()
      setPolicy(p)
    } catch {
      /* ignore — non-fatal */
    }
  }, [])

  useEffect(() => {
    loadPolicy()
  }, [loadPolicy])

  async function handleSavePolicy(event) {
    event.preventDefault()
    if (!policy) return
    setPolicyState({ saving: true, error: '', message: '' })
    try {
      const saved = await updateSecurityPolicy(policy)
      setPolicy(saved)
      setPolicyState({ saving: false, error: '', message: 'Security policy updated.' })
    } catch (err) {
      setPolicyState({ saving: false, error: err.message, message: '' })
    }
  }

  function setPolicyField(field, value) {
    setPolicy((c) => ({ ...c, [field]: value }))
  }

  // JL-211: configurable "Create project" workspace policy
  const [creationPolicy, setCreationPolicy] = useState('all_members')
  const [creationState, setCreationState] = useState({ saving: false, error: '', message: '' })

  const loadCreationPolicy = useCallback(async () => {
    try {
      const settings = await fetchWorkspaceSettings()
      if (settings?.project_creation_policy) setCreationPolicy(settings.project_creation_policy)
    } catch {
      /* ignore — non-fatal */
    }
  }, [])

  useEffect(() => {
    loadCreationPolicy()
  }, [loadCreationPolicy])

  async function handleSaveCreationPolicy(event) {
    event.preventDefault()
    setCreationState({ saving: true, error: '', message: '' })
    try {
      const saved = await updateProjectCreationPolicy(creationPolicy)
      setCreationPolicy(saved.project_creation_policy)
      setCreationState({ saving: false, error: '', message: 'Project creation policy updated.' })
    } catch (err) {
      setCreationState({ saving: false, error: err.message, message: '' })
    }
  }
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'Viewer' })
  const [inviteState, setInviteState] = useState({ saving: false, error: '', message: '' })
  const [resendState, setResendState] = useState({ id: null, message: '' })
  const [query, setQuery] = useState('')

  // JL-250: client-side filter / sort / pagination for the members table.
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)

  // JL-74: token-based invitations
  const [invites, setInvites] = useState([])
  const [inviteEmailForm, setInviteEmailForm] = useState({ email: '', role: 'Member' })
  const [sendState, setSendState] = useState({ saving: false, error: '', message: '' })
  // JL-251: track which pending invite is currently being resent.
  const [resendingInviteId, setResendingInviteId] = useState(null)

  const loadInvites = useCallback(async () => {
    if (!canInviteMembers) return
    try {
      const rows = await fetchInvitations('pending')
      setInvites(rows)
    } catch {
      /* ignore — non-admins can't list */
    }
  }, [canInviteMembers])

  useEffect(() => {
    loadInvites()
  }, [loadInvites])

  async function handleSendInvitation(event) {
    event.preventDefault()
    setSendState({ saving: true, error: '', message: '' })
    try {
      await createInvitation(inviteEmailForm)
      setInviteEmailForm({ email: '', role: 'Member' })
      setSendState({ saving: false, error: '', message: 'Invitation sent.' })
      loadInvites()
    } catch (err) {
      setSendState({ saving: false, error: err.message, message: '' })
    }
  }

  // JL-251: re-issue a token invitation and refresh the list.
  async function handleResendInvitation(inv) {
    setResendingInviteId(inv.id)
    try {
      await resendInvitation(inv.id)
      await loadInvites()
      showFeedback(`Invitation for ${inv.email} resent.`, 'success')
    } catch (err) {
      showFeedback(err.message || 'Failed to resend invitation.', 'error')
    } finally {
      setResendingInviteId(null)
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return
    setRevokeBusy(true)
    try {
      await revokeInvitation(revokeTarget.id)
      setRevokeTarget(null)
      loadInvites()
      showFeedback(`Invitation for ${revokeTarget.email} revoked.`, 'success')
    } catch (err) {
      setRevokeTarget(null)
      showFeedback(err.message || 'Failed to revoke invitation.', 'error')
    } finally {
      setRevokeBusy(false)
    }
  }

  // JL-252: remove a single member from the workspace. The backend enforces the
  // Owner / last-Admin guards and returns 403 if the delete is disallowed.
  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleteBusy(true)
    try {
      await deleteMember(deleteTarget.id)
      const removedId = deleteTarget.id
      const removedName = deleteTarget.name
      setDeleteTarget(null)
      setSelectedIds((prev) => {
        if (!prev.has(removedId)) return prev
        const next = new Set(prev)
        next.delete(removedId)
        return next
      })
      await loadMembers()
      showFeedback(`${removedName} removed from the workspace.`, 'success')
    } catch (err) {
      setDeleteTarget(null)
      showFeedback(err.message || 'Failed to remove member.', 'error')
    } finally {
      setDeleteBusy(false)
    }
  }

  // JL-252: delete every selected member in one request. The backend applies the
  // per-id guards and returns { deleted, skipped } so we can summarise the outcome.
  async function runBulkDelete() {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    setBulkBusy(true)
    try {
      const result = await bulkDeleteMembers(ids)
      const deleted = result?.deleted || []
      const skipped = result?.skipped || []
      setBulkConfirmOpen(false)
      setSelectedIds(new Set())
      await loadMembers()
      const noun = (n) => `${n} member${n === 1 ? '' : 's'}`
      if (skipped.length > 0) {
        showFeedback(
          `Deleted ${noun(deleted.length)}, skipped ${skipped.length} (Owner / last Admin).`,
          deleted.length > 0 ? 'success' : 'error',
        )
      } else {
        showFeedback(`Deleted ${noun(deleted.length)}.`, 'success')
      }
    } catch (err) {
      setBulkConfirmOpen(false)
      showFeedback(err.message || 'Bulk delete failed.', 'error')
    } finally {
      setBulkBusy(false)
    }
  }

  // JL-247: the header "+ Invite Member" flow now creates a token-based,
  // revocable, expiring invitation (POST /api/invitations) instead of the
  // legacy tokenless POST /api/members path, which left dangling un-actionable
  // "Invited" member rows. This is the single canonical invite path.
  async function handleInviteSubmit(event) {
    event.preventDefault()
    setInviteState({ saving: true, error: '', message: '' })
    try {
      await createInvitation({ email: inviteForm.email, role: inviteForm.role })
      setInviteForm({ email: '', role: 'Viewer' })
      setInviteState({ saving: false, error: '', message: 'Invitation sent successfully.' })
      setIsInviteOpen(false)
      loadInvites()
    } catch (inviteError) {
      setInviteState({ saving: false, error: inviteError.message, message: '' })
      showFeedback(inviteError.message || 'Failed to send invitation.', 'error')
    }
  }

  async function handleResend(memberId) {
    setResendState({ id: memberId, message: '' })
    try {
      await onResend(memberId)
      setResendState({ id: null, message: 'Invite resent successfully.' })
    } catch (resendError) {
      setResendState({ id: null, message: 'Failed to resend invite.' })
      showFeedback(resendError.message || 'Failed to resend invite.', 'error')
    }
  }

  // JL-250: distinct role/status values present in the member list drive the
  // filter dropdowns, so they stay in sync with whatever the data contains.
  const roleOptions = useMemo(
    () => [...new Set(members.map((m) => m.role).filter(Boolean))].sort(),
    [members],
  )
  const statusOptions = useMemo(
    () => [...new Set(members.map((m) => m.status).filter(Boolean))].sort(),
    [members],
  )

  const normalizedQuery = query.trim().toLowerCase()
  const filtered = members.filter((m) => {
    if (roleFilter !== 'all' && m.role !== roleFilter) return false
    if (statusFilter !== 'all' && m.status !== statusFilter) return false
    if (!normalizedQuery) return true
    return m.name.toLowerCase().includes(normalizedQuery) || m.email.toLowerCase().includes(normalizedQuery)
  })

  const hasActiveFilters = normalizedQuery !== '' || roleFilter !== 'all' || statusFilter !== 'all'

  // JL-250: sort the filtered rows by the active column/direction. Names and
  // roles/statuses compare as strings; task_count compares numerically.
  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      let cmp
      if (sortBy === 'task_count') {
        cmp = (a.task_count || 0) - (b.task_count || 0)
      } else {
        cmp = String(a[sortBy] ?? '').localeCompare(String(b[sortBy] ?? ''), undefined, {
          sensitivity: 'base',
          numeric: true,
        })
      }
      return cmp * dir
    })
  }, [filtered, sortBy, sortDir])

  // JL-250: keep the page in range and slice the visible rows.
  const pageCount = Math.max(1, Math.ceil(sorted.length / rowsPerPage))
  const currentPage = Math.min(page, pageCount - 1)
  const paged = sorted.slice(currentPage * rowsPerPage, currentPage * rowsPerPage + rowsPerPage)

  // JL-250: jump back to the first page whenever the filter/search criteria
  // change so you never land on a now-out-of-range page.
  useEffect(() => {
    setPage(0)
  }, [normalizedQuery, roleFilter, statusFilter])

  // JL-252: clear the bulk selection whenever the filter/search/page changes so
  // a "Delete selected" can never act on rows that are no longer visible.
  useEffect(() => {
    setSelectedIds(new Set())
  }, [normalizedQuery, roleFilter, statusFilter, page, rowsPerPage])

  // JL-252: the workspace Owner can never be deleted, so those rows aren't
  // selectable. Select-all and the "all selected" state are scoped to the
  // currently visible page and only apply for Admins/Owners.
  const isOwnerRow = (m) => Boolean(m.is_owner) || m.role === 'Owner'
  const selectablePaged = isAdmin ? paged.filter((m) => !isOwnerRow(m)) : []
  const selectedCount = selectedIds.size
  const allPageSelected =
    selectablePaged.length > 0 && selectablePaged.every((m) => selectedIds.has(m.id))
  const somePageSelected = selectablePaged.some((m) => selectedIds.has(m.id))

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAllOnPage() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allPageSelected) selectablePaged.forEach((m) => next.delete(m.id))
      else selectablePaged.forEach((m) => next.add(m.id))
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  function toggleSort(column) {
    if (sortBy === column) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(column)
      setSortDir('asc')
    }
  }

  const ariaSortFor = (column) =>
    sortBy === column ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
  const sortIndicator = (column) => (sortBy === column ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '')

  return (
    <section className="page teams-page">
      <div className="teams-header">
        <div>
          <h1>Teams</h1>
          <p className="teams-subtitle">Manage your team members and their roles within the workspace.</p>
        </div>
        <div className="teams-header-actions">
          <label className="teams-search">
            <span className="teams-search-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5L14 14" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="Search members"
              aria-label="Search members"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button className="btn btn-primary" type="button" onClick={() => setIsInviteOpen((c) => !c)}>
            + Invite Member
          </button>
        </div>
      </div>

      {isInviteOpen && (
        <article className="panel teams-invite-panel">
          <h3>Invite a new member</h3>
          <p className="teams-subtitle">
            Sends a token-based invitation email. The recipient joins with the assigned role when they accept.
          </p>
          <form className="teams-invite-form" onSubmit={handleInviteSubmit}>
            <label>
              Email
              <input placeholder="Email address" type="email" value={inviteForm.email} onChange={(e) => setInviteForm((c) => ({ ...c, email: e.target.value }))} required />
            </label>
            <label>
              Role
              <select value={inviteForm.role} onChange={(e) => setInviteForm((c) => ({ ...c, role: e.target.value }))}>
                <option>Viewer</option>
                <option>Member</option>
                <option>Admin</option>
              </select>
            </label>
            <div className="teams-invite-actions">
              <button className="btn btn-primary" type="submit" disabled={inviteState.saving}>
                {inviteState.saving ? 'Sending...' : 'Send Invite'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setIsInviteOpen(false)}>Cancel</button>
            </div>
          </form>
          {inviteState.error && <p className="banner error">{inviteState.error}</p>}
        </article>
      )}

      {inviteState.message && <p className="banner">{inviteState.message}</p>}
      {resendState.message && <p className="banner">{resendState.message}</p>}

      {canInviteMembers && (
        <article className="panel teams-invitations-panel">
          <h3>Invite Members</h3>
          <p className="teams-subtitle">
            Send a token-based invitation email. The recipient joins with the assigned role when they accept.
          </p>
          <form className="teams-invite-form" onSubmit={handleSendInvitation}>
            <label>
              Email
              <input
                placeholder="Email address"
                type="email"
                value={inviteEmailForm.email}
                onChange={(e) => setInviteEmailForm((c) => ({ ...c, email: e.target.value }))}
                required
              />
            </label>
            <label>
              Role
              <select value={inviteEmailForm.role} onChange={(e) => setInviteEmailForm((c) => ({ ...c, role: e.target.value }))}>
                <option>Viewer</option>
                <option>Member</option>
                <option>Admin</option>
              </select>
            </label>
            <div className="teams-invite-actions">
              <button className="btn btn-primary" type="submit" disabled={sendState.saving}>
                {sendState.saving ? 'Sending...' : 'Send Invitation'}
              </button>
            </div>
          </form>
          {sendState.error && <p className="banner error">{sendState.error}</p>}
          {sendState.message && <p className="banner">{sendState.message}</p>}

          {invites.length > 0 && (
            <table className="table teams-table" style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Invited By</th>
                  <th>Expires</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.email}</td>
                    <td><span className="pill">{inv.role}</span></td>
                    <td><small>{inv.invited_by}</small></td>
                    <td>
                      <small>{new Date(inv.expires_at).toLocaleDateString()}</small>
                      {inv.expired && (
                        <span
                          className="pill"
                          style={{ marginLeft: 6, background: '#ffebe6', color: '#bf2600' }}
                        >
                          Expired
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        className="link-btn"
                        type="button"
                        disabled={resendingInviteId === inv.id}
                        onClick={() => handleResendInvitation(inv)}
                        style={{ marginRight: 12 }}
                      >
                        {resendingInviteId === inv.id ? 'Resending...' : 'Resend'}
                      </button>
                      <button className="link-btn" type="button" onClick={() => setRevokeTarget(inv)}>
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>
      )}

      {isAdmin && (
        <article className="panel teams-security-panel">
          <h3>Project Creation</h3>
          <p className="teams-subtitle">
            Control who can create new projects in this workspace. Workspace owners can always create projects.
          </p>
          <form className="teams-security-form" onSubmit={handleSaveCreationPolicy}>
            <label>
              Who can create projects
              <select
                value={creationPolicy}
                onChange={(e) => setCreationPolicy(e.target.value)}
              >
                <option value="all_members">All members</option>
                <option value="admins_only">Admins only</option>
              </select>
            </label>
            <div className="teams-invite-actions">
              <button className="btn btn-primary" type="submit" disabled={creationState.saving}>
                {creationState.saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
          {creationState.error && <p className="banner error">{creationState.error}</p>}
          {creationState.message && <p className="banner">{creationState.message}</p>}
        </article>
      )}

      {isAdmin && policy && (
        <article className="panel teams-security-panel">
          <h3>Security Policy</h3>
          <p className="teams-subtitle">
            Enforce two-factor authentication and password complexity across the whole organization.
            Rules apply at registration and password change.
          </p>
          <form className="teams-security-form" onSubmit={handleSavePolicy}>
            <label className="teams-security-check">
              <input
                type="checkbox"
                checked={Boolean(policy.require_mfa)}
                onChange={(e) => setPolicyField('require_mfa', e.target.checked)}
              />
              Require all users to enable two-factor authentication (MFA)
            </label>

            <label>
              Minimum password length
              <input
                type="number"
                min="1"
                max="128"
                value={policy.min_password_length ?? 8}
                onChange={(e) => setPolicyField('min_password_length', Number(e.target.value))}
              />
            </label>

            <label className="teams-security-check">
              <input
                type="checkbox"
                checked={Boolean(policy.require_uppercase)}
                onChange={(e) => setPolicyField('require_uppercase', e.target.checked)}
              />
              Require at least one uppercase letter
            </label>
            <label className="teams-security-check">
              <input
                type="checkbox"
                checked={Boolean(policy.require_number)}
                onChange={(e) => setPolicyField('require_number', e.target.checked)}
              />
              Require at least one number
            </label>
            <label className="teams-security-check">
              <input
                type="checkbox"
                checked={Boolean(policy.require_symbol)}
                onChange={(e) => setPolicyField('require_symbol', e.target.checked)}
              />
              Require at least one symbol
            </label>

            <label>
              Password rotation (days, 0 = never expire)
              <input
                type="number"
                min="0"
                max="3650"
                value={policy.password_max_age_days ?? 0}
                onChange={(e) => setPolicyField('password_max_age_days', Number(e.target.value))}
              />
            </label>

            <div className="teams-invite-actions">
              <button className="btn btn-primary" type="submit" disabled={policyState.saving}>
                {policyState.saving ? 'Saving...' : 'Save Policy'}
              </button>
            </div>
          </form>
          {policyState.error && <p className="banner error">{policyState.error}</p>}
          {policyState.message && <p className="banner">{policyState.message}</p>}
        </article>
      )}

      <article className="panel teams-table-shell">
        {membersLoading ? (
          <LoadingState label="Loading team members…" />
        ) : membersError ? (
          <ErrorState title="Couldn't load team members" error={membersError} onRetry={loadMembers} />
        ) : (
          <>
            <div className="teams-table-toolbar">
              <label className="teams-table-filter">
                <span>Role</span>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  aria-label="Filter by role"
                >
                  <option value="all">All roles</option>
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
              </label>
              <label className="teams-table-filter">
                <span>Status</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="Filter by status"
                >
                  <option value="all">All statuses</option>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </label>
              <span className="teams-table-count" aria-live="polite">
                {sorted.length} of {members.length} members
              </span>
            </div>

            {sorted.length === 0 ? (
              <div className="teams-empty">
                {hasActiveFilters
                  ? 'No members match your filters.'
                  : 'No team members yet. Invite someone to get started.'}
              </div>
            ) : (
              <>
                {/* JL-252: bulk-action toolbar, shown only when rows are selected. */}
                {isAdmin && selectedCount > 0 && (
                  <div className="teams-bulkbar" role="region" aria-label="Bulk actions">
                    <span className="teams-bulkbar-count">{selectedCount} selected</span>
                    <Button
                      size="small"
                      color="error"
                      variant="contained"
                      onClick={() => setBulkConfirmOpen(true)}
                    >
                      Delete {selectedCount} member{selectedCount === 1 ? '' : 's'}
                    </Button>
                    <Button size="small" onClick={clearSelection}>Clear</Button>
                  </div>
                )}
                <table className="table teams-table">
                  <thead>
                    <tr>
                      {isAdmin && (
                        <th className="teams-checkbox-cell">
                          <Checkbox
                            size="small"
                            checked={allPageSelected}
                            indeterminate={somePageSelected && !allPageSelected}
                            disabled={selectablePaged.length === 0}
                            onChange={toggleSelectAllOnPage}
                            inputProps={{ 'aria-label': 'Select all members on this page' }}
                          />
                        </th>
                      )}
                      <th aria-sort={ariaSortFor('name')}>
                        <button type="button" className="teams-sort-btn" onClick={() => toggleSort('name')}>
                          Member{sortIndicator('name')}
                        </button>
                      </th>
                      <th aria-sort={ariaSortFor('role')}>
                        <button type="button" className="teams-sort-btn" onClick={() => toggleSort('role')}>
                          Role{sortIndicator('role')}
                        </button>
                      </th>
                      <th aria-sort={ariaSortFor('status')}>
                        <button type="button" className="teams-sort-btn" onClick={() => toggleSort('status')}>
                          Status{sortIndicator('status')}
                        </button>
                      </th>
                      <th aria-sort={ariaSortFor('task_count')}>
                        <button type="button" className="teams-sort-btn" onClick={() => toggleSort('task_count')}>
                          Tasks{sortIndicator('task_count')}
                        </button>
                      </th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((member) => (
                <tr key={member.id}>
                  {isAdmin && (
                    <td className="teams-checkbox-cell">
                      <Checkbox
                        size="small"
                        checked={selectedIds.has(member.id)}
                        disabled={isOwnerRow(member)}
                        onChange={() => toggleRow(member.id)}
                        inputProps={{ 'aria-label': `Select ${member.name}` }}
                      />
                    </td>
                  )}
                  <td>
                    <div className="teams-member-cell">
                      <span className="teams-member-avatar">{member.name.slice(0, 2).toUpperCase()}</span>
                      <div>
                        <strong>{member.name}</strong>
                        <small>{member.email}</small>
                        {member.invited_by && <small className="teams-invited-by">Invited by {member.invited_by}</small>}
                      </div>
                    </div>
                  </td>
                  <td><span className="pill">{member.role}</span></td>
                  <td>
                    <span className={`pill ${member.status === 'Active' ? 'pill-green' : 'pill-gray'}`}>
                      {member.status}
                    </span>
                  </td>
                  <td>{member.task_count || 0}</td>
                  <td>
                    <div className="teams-row-actions">
                      {member.status === 'Invited' ? (
                        <button className="link-btn" type="button" onClick={() => handleResend(member.id)} disabled={resendState.id === member.id}>
                          {resendState.id === member.id ? 'Resending...' : 'Resend Invite'}
                        </button>
                      ) : (
                        <span className="teams-active-label">Active</span>
                      )}
                      {isAdmin && !isOwnerRow(member) && (
                        <Button
                          size="small"
                          color="error"
                          onClick={() => setDeleteTarget(member)}
                          aria-label={`Delete ${member.name}`}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
                  </tbody>
                </table>
                <TablePagination
                  component="div"
                  className="teams-table-pagination"
                  count={sorted.length}
                  page={currentPage}
                  onPageChange={(_event, newPage) => setPage(newPage)}
                  rowsPerPage={rowsPerPage}
                  onRowsPerPageChange={(event) => {
                    setRowsPerPage(parseInt(event.target.value, 10))
                    setPage(0)
                  }}
                  rowsPerPageOptions={[10, 25, 50]}
                  labelRowsPerPage="Members per page"
                  SelectProps={{ native: true, inputProps: { 'aria-label': 'Members per page' } }}
                />
              </>
            )}
          </>
        )}
      </article>

      <Dialog open={Boolean(revokeTarget)} onClose={() => (revokeBusy ? null : setRevokeTarget(null))}>
        <DialogTitle>Revoke invitation?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {revokeTarget
              ? `Revoke invitation for ${revokeTarget.email}? They will no longer be able to join with this link.`
              : ''}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeTarget(null)} disabled={revokeBusy}>Cancel</Button>
          <Button onClick={confirmRevoke} color="error" variant="contained" disabled={revokeBusy}>
            {revokeBusy ? 'Revoking…' : 'Revoke'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* JL-252: confirm single member delete */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => (deleteBusy ? null : setDeleteTarget(null))} maxWidth="xs" fullWidth>
        <DialogTitle>Remove member?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {deleteTarget
              ? `Remove ${deleteTarget.name} (${deleteTarget.email}) from the workspace? This cannot be undone.`
              : ''}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>Cancel</Button>
          <Button onClick={confirmDelete} color="error" variant="contained" disabled={deleteBusy}>
            {deleteBusy ? 'Removing…' : 'Remove'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* JL-252: confirm bulk member delete */}
      <Dialog
        open={bulkConfirmOpen}
        onClose={() => { if (!bulkBusy) setBulkConfirmOpen(false) }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete selected members</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Remove {selectedCount} selected member{selectedCount === 1 ? '' : 's'} from the workspace?
            This cannot be undone. Protected members (the Owner or the last remaining Admin) are skipped.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkConfirmOpen(false)} disabled={bulkBusy}>Cancel</Button>
          <Button variant="contained" color="error" onClick={runBulkDelete} disabled={bulkBusy}>
            {bulkBusy ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={feedback.open}
        autoHideDuration={5000}
        onClose={closeFeedback}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={closeFeedback} severity={feedback.severity} variant="filled" sx={{ width: '100%' }}>
          {feedback.message}
        </Alert>
      </Snackbar>
    </section>
  )
}
