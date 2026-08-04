import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import { acceptInvitation, lookupInvitation } from '../../api/memberApi'
import { usePageTitle } from '../../hooks/usePageTitle'

/**
 * JL-361 — Invitation accept screen.
 *
 * The backend has always exposed GET /api/invitations/:token and
 * POST /api/invitations/:token/accept, but nothing linked to them: the invite
 * email pointed at the bare app URL and no front-end route redeemed a token. So
 * the entire token flow was dead. This page is the missing destination for the
 * link that buildInviteEmail now sends (see server/utils/mailer.js —
 * INVITE_ACCEPT_PATH).
 *
 * Deliberately reachable without a session — the invitee has no account yet.
 */
// Mirror of INVITE_ACCEPT_PATH in server/utils/mailer.js — the email builder
// cannot import from the SPA bundle, so the two must be kept in step by hand.
export const ACCEPT_INVITE_PATH = '/accept-invite'

export function AcceptInvitePage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = String(searchParams.get('token') || '').trim()

  const [loading, setLoading] = useState(true)
  const [invite, setInvite] = useState(null)
  const [lookupError, setLookupError] = useState('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [accepted, setAccepted] = useState(false)

  usePageTitle('Accept invitation')

  useEffect(() => {
    if (!token) {
      setLoading(false)
      setLookupError('This invitation link is missing its token. Ask your workspace admin to resend the invitation.')
      return undefined
    }
    let active = true
    setLoading(true)
    lookupInvitation(token)
      .then((data) => {
        if (!active) return
        setInvite(data)
        setName(String(data?.email || '').split('@')[0])
        setLookupError('')
      })
      .catch((err) => {
        if (!active) return
        setInvite(null)
        setLookupError(err?.message || 'This invitation could not be found.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [token])

  async function handleAccept(event) {
    event.preventDefault()
    setSubmitError('')
    setSubmitting(true)
    try {
      await acceptInvitation(token, { name: name.trim() })
      setAccepted(true)
    } catch (err) {
      setSubmitError(err?.message || 'Could not accept this invitation.')
    } finally {
      setSubmitting(false)
    }
  }

  // Why an invite can be shown but not redeemed — mirrors the backend checks in
  // POST /api/invitations/:token/accept so the reason is explicit to the user.
  function unusableReason() {
    if (!invite) return ''
    if (invite.expired) return 'This invitation has expired. Ask your workspace admin to resend it.'
    if (invite.status === 'revoked') return 'This invitation has been revoked.'
    if (invite.status === 'accepted') return 'This invitation has already been accepted. Try signing in instead.'
    if (!invite.valid) return 'This invitation is no longer valid. Ask your workspace admin to resend it.'
    return ''
  }

  const blocked = unusableReason()

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: { xs: 2, sm: 6 } }}>
      <Paper elevation={0} sx={{ p: 4, maxWidth: 480, width: '100%', border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h5" component="h1" gutterBottom>
          {accepted ? 'Invitation accepted' : 'Accept your invitation'}
        </Typography>

        {loading && (
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 2 }}>
            <CircularProgress size={20} />
            <Typography variant="body2">Checking your invitation…</Typography>
          </Stack>
        )}

        {!loading && lookupError && (
          <Alert severity="error" sx={{ mt: 2 }}>{lookupError}</Alert>
        )}

        {!loading && !lookupError && blocked && !accepted && (
          <Alert severity="warning" sx={{ mt: 2 }}>{blocked}</Alert>
        )}

        {!loading && !lookupError && !blocked && !accepted && (
          <form onSubmit={handleAccept}>
            <Typography variant="body2" sx={{ mt: 1, mb: 2 }}>
              You've been invited to join ECM-JIRA as a <strong>{invite?.role}</strong> using <strong>{invite?.email}</strong>.
            </Typography>
            <TextField
              id="accept-invite-name"
              label="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              size="small"
              sx={{ mb: 2 }}
            />
            {submitError && <Alert severity="error" sx={{ mb: 2 }}>{submitError}</Alert>}
            <Button type="submit" variant="contained" disabled={submitting} fullWidth>
              {submitting ? 'Accepting…' : 'Accept invitation'}
            </Button>
          </form>
        )}

        {accepted && (
          <>
            <Alert severity="success" sx={{ mt: 2 }}>
              You're now a {invite?.role} in this workspace.
            </Alert>
            {/* JL-361: accepting creates the member row only — it does not set a
                password. Say so plainly instead of dropping the invitee on a
                login screen they cannot use. */}
            <Typography variant="body2" sx={{ mt: 2 }}>
              To finish, create a password for <strong>{invite?.email}</strong> on the sign-up screen. Your role is already assigned.
            </Typography>
            <Button variant="contained" sx={{ mt: 2 }} onClick={() => navigate('/')} fullWidth>
              Continue to sign in
            </Button>
          </>
        )}
      </Paper>
    </Box>
  )
}
