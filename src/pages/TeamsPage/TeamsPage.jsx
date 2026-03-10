import { useState } from 'react'
import { useMembers } from '../../context/MemberContext'
import { usePermissions } from '../../hooks/usePermissions'
import {
  Typography,
  TextField,
  InputAdornment,
  Button,
  Card,
  CardContent,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Avatar,
  Chip,
  Alert,
  Stack,
  Box,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import './TeamsPage.css'

export function TeamsPage() {
  const { profile, members, handleInviteMember: onInvite, handleResendInvite: onResend } = useMembers()
  const { canInviteMembers, canManageMembers } = usePermissions()
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: 'Viewer' })
  const [inviteState, setInviteState] = useState({ saving: false, error: '', message: '' })
  const [resendState, setResendState] = useState({ id: null, message: '' })
  const [query, setQuery] = useState('')

  async function handleInviteSubmit(event) {
    event.preventDefault()
    setInviteState({ saving: true, error: '', message: '' })
    try {
      await onInvite({ ...inviteForm, invited_by: profile?.full_name || '' })
      setInviteForm({ name: '', email: '', role: 'Viewer' })
      setInviteState({ saving: false, error: '', message: 'Invitation sent successfully.' })
      setIsInviteOpen(false)
    } catch (inviteError) {
      setInviteState({ saving: false, error: inviteError.message, message: '' })
    }
  }

  async function handleResend(memberId) {
    setResendState({ id: memberId, message: '' })
    try {
      await onResend(memberId)
      setResendState({ id: null, message: 'Invite resent successfully.' })
    } catch {
      setResendState({ id: null, message: 'Failed to resend invite.' })
    }
  }

  const normalizedQuery = query.trim().toLowerCase()
  const filtered = members.filter((m) => {
    if (!normalizedQuery) return true
    return m.name.toLowerCase().includes(normalizedQuery) || m.email.toLowerCase().includes(normalizedQuery)
  })

  return (
    <section className="page teams-page">
      <Box className="teams-header">
        <Box>
          <Typography variant="h4" component="h1" fontWeight="bold">
            Teams
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Manage your team members and their roles within the workspace.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            size="small"
            placeholder="Search members"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ width: 240 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
          {canInviteMembers && (
            <Button
              variant="contained"
              startIcon={<PersonAddIcon />}
              onClick={() => setIsInviteOpen((c) => !c)}
            >
              Invite Member
            </Button>
          )}
        </Stack>
      </Box>

      {isInviteOpen && canInviteMembers && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Invite a new member
            </Typography>
            <form onSubmit={handleInviteSubmit}>
              <Stack direction="row" spacing={2} alignItems="flex-end" flexWrap="wrap">
                <TextField
                  label="Name"
                  placeholder="Full name"
                  size="small"
                  value={inviteForm.name}
                  onChange={(e) => setInviteForm((c) => ({ ...c, name: e.target.value }))}
                  required
                  sx={{ flex: 1, minWidth: 180 }}
                />
                <TextField
                  label="Email"
                  placeholder="Email address"
                  type="email"
                  size="small"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm((c) => ({ ...c, email: e.target.value }))}
                  required
                  sx={{ flex: 1, minWidth: 180 }}
                />
                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <InputLabel>Role</InputLabel>
                  <Select
                    label="Role"
                    value={inviteForm.role}
                    onChange={(e) => setInviteForm((c) => ({ ...c, role: e.target.value }))}
                  >
                    <MenuItem value="Viewer">Viewer</MenuItem>
                    <MenuItem value="Member">Member</MenuItem>
                    <MenuItem value="Admin">Admin</MenuItem>
                  </Select>
                </FormControl>
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" type="submit" disabled={inviteState.saving}>
                    {inviteState.saving ? 'Sending...' : 'Send Invite'}
                  </Button>
                  <Button variant="outlined" type="button" onClick={() => setIsInviteOpen(false)}>
                    Cancel
                  </Button>
                </Stack>
              </Stack>
            </form>
            {inviteState.error && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {inviteState.error}
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {inviteState.message && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {inviteState.message}
        </Alert>
      )}
      {resendState.message && (
        <Alert
          severity={resendState.message.includes('Failed') ? 'error' : 'success'}
          sx={{ mb: 2 }}
        >
          {resendState.message}
        </Alert>
      )}

      <TableContainer component={Card}>
        {filtered.length === 0 ? (
          <Box sx={{ py: 6, px: 2, textAlign: 'center' }}>
            <Typography color="text.secondary">
              {normalizedQuery ? 'No members match your search.' : 'No team members yet. Invite someone to get started.'}
            </Typography>
          </Box>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Member</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Tasks</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((member) => (
                <TableRow key={member.id} hover>
                  <TableCell>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Avatar sx={{ width: 32, height: 32, fontSize: '0.75rem', bgcolor: '#deebff', color: '#0052cc' }}>
                        {member.name.slice(0, 2).toUpperCase()}
                      </Avatar>
                      <Box>
                        <Typography variant="body2" fontWeight={500}>
                          {member.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {member.email}
                        </Typography>
                        {member.invited_by && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontStyle: 'italic' }}>
                            Invited by {member.invited_by}
                          </Typography>
                        )}
                      </Box>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip label={member.role} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={member.status}
                      size="small"
                      color={member.status === 'Active' ? 'success' : 'default'}
                    />
                  </TableCell>
                  <TableCell>{member.task_count || 0}</TableCell>
                  <TableCell>
                    {canManageMembers && member.status === 'Invited' ? (
                      <Button
                        size="small"
                        onClick={() => handleResend(member.id)}
                        disabled={resendState.id === member.id}
                      >
                        {resendState.id === member.id ? 'Resending...' : 'Resend Invite'}
                      </Button>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        {member.status === 'Active' ? 'Active' : '—'}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableContainer>
    </section>
  )
}
