import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import { resetPassword } from '../../api/authApi'
import { usePageTitle } from '../../hooks/usePageTitle'

/**
 * JL-370 — Password-reset landing page.
 *
 * buildPasswordResetEmail (server/utils/mailer.js) has always linked to
 * `${APP_URL}/reset-password?token=…`, but no such route existed: the SPA
 * fallback served the login form for any unauthenticated path, the login page
 * never read `?token=`, and the emailed link silently did nothing useful. This
 * page is the missing destination, mirroring how JL-361's AcceptInvitePage
 * became the destination for the invite email link.
 *
 * Deliberately reachable without a session — someone resetting a forgotten
 * password cannot sign in. The login page's manual token-paste flow
 * (Forgot password → paste token) is left untouched: it is still the only
 * path when SMTP is unconfigured (the token is shown in the API response
 * rather than emailed), and old emails asking users to paste keep working.
 */
// Mirror of the path in buildPasswordResetEmail (server/utils/mailer.js) — the
// email builder cannot import from the SPA bundle, so keep the two in step.
export const RESET_PASSWORD_PATH = '/reset-password'

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = String(searchParams.get('token') || '').trim()

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  // JL-370: the reset endpoint enforces the JL-134 password policy and returns
  // the full violation list as `errors: [...]` — surface every rule, not just
  // the first, so the user can fix them all in one go.
  const [policyErrors, setPolicyErrors] = useState([])
  const [successMessage, setSuccessMessage] = useState('')

  usePageTitle('Reset password')

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitError('')
    setPolicyErrors([])
    if (newPassword.length < 6) {
      setSubmitError('Password must be at least 6 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setSubmitError('Passwords do not match')
      return
    }
    setSubmitting(true)
    try {
      const result = await resetPassword(token, newPassword)
      setSuccessMessage(result?.message || 'Password has been reset successfully. You can now log in.')
    } catch (err) {
      // The backend already answers with distinct messages — unknown token
      // ("Invalid or expired reset token"), already-used, expired ("Reset token
      // has expired…"), and policy violations — so relay them verbatim instead
      // of collapsing everything into one generic failure.
      const errors = Array.isArray(err?.data?.errors) ? err.data.errors : []
      if (errors.length > 0) {
        setPolicyErrors(errors)
      } else {
        setSubmitError(err?.message || 'Could not reset your password.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: { xs: 2, sm: 6 } }}>
      <Paper elevation={0} sx={{ p: 4, maxWidth: 480, width: '100%', border: '1px solid', borderColor: 'divider' }}>
        <h1 className="page-title-standalone">
          {successMessage ? 'Password reset' : 'Choose a new password'}
        </h1>

        {/* Missing token gets its own explanation — a bare /reset-password hit
            (truncated link, hand-typed URL) is not the same failure as a bad
            token, and the fix (request a fresh link) is different too. */}
        {!token && !successMessage && (
          <>
            <Alert severity="error" sx={{ mt: 2 }}>
              This reset link is missing its token. Request a new link with &ldquo;Forgot password?&rdquo; on the sign-in page, or paste the token from your email there.
            </Alert>
            <Button variant="contained" sx={{ mt: 2 }} onClick={() => navigate('/')} fullWidth>
              Go to sign in
            </Button>
          </>
        )}

        {token && !successMessage && (
          <form onSubmit={handleSubmit}>
            <Typography variant="body2" sx={{ mt: 1, mb: 2 }}>
              Enter a new password for your account. Reset links expire 15 minutes after they are requested.
            </Typography>
            <TextField
              id="reset-new-password"
              label="New password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              fullWidth
              required
              size="small"
              autoComplete="new-password"
              sx={{ mb: 2 }}
            />
            <TextField
              id="reset-confirm-password"
              label="Confirm password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              fullWidth
              required
              size="small"
              autoComplete="new-password"
              sx={{ mb: 2 }}
            />
            {submitError && <Alert severity="error" sx={{ mb: 2 }}>{submitError}</Alert>}
            {policyErrors.length > 0 && (
              <Alert severity="error" sx={{ mb: 2 }}>
                <Typography variant="body2" component="span">Your new password does not meet the password policy:</Typography>
                <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                  {policyErrors.map((message) => <li key={message}>{message}</li>)}
                </ul>
              </Alert>
            )}
            <Button type="submit" variant="contained" disabled={submitting} fullWidth>
              {submitting ? 'Resetting…' : 'Reset password'}
            </Button>
          </form>
        )}

        {successMessage && (
          <>
            <Alert severity="success" sx={{ mt: 2 }}>{successMessage}</Alert>
            {/* JL-370: the reset endpoint returns no JWT, only a confirmation —
                so signing the user in silently is not an option without a second
                credential round-trip. Send them to the login form instead, which
                also matches JL-361's accept page ("Continue to sign in"). */}
            <Button variant="contained" sx={{ mt: 2 }} onClick={() => navigate('/')} fullWidth>
              Continue to sign in
            </Button>
          </>
        )}
      </Paper>
    </Box>
  )
}
