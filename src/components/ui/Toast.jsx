import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'

/**
 * Toast — a transient message (JL-439).
 *
 * MUI Snackbar + Alert, which is already the pattern six pages use directly
 * (Teams, Users, Wiki, WorkflowEditor, IssueDetail, App). This gives them one
 * place to change, and fixes two things they each got differently:
 *
 *   - `severity` was inconsistent, so an error and a success could look alike;
 *   - the live-region role was left to MUI's default, which announces every
 *     toast politely. An error should interrupt, so `error` gets `role="alert"`
 *     and `aria-live="assertive"` while the rest stay polite.
 *
 * Positioned bottom-left to match the app's existing Snackbars. `--z-toast`
 * (300) is the documented top of the layering scale, above modals.
 */
const ASSERTIVE = { role: 'alert', 'aria-live': 'assertive' }
const POLITE = { role: 'status', 'aria-live': 'polite' }

export function Toast({
  open,
  onClose,
  message,
  severity = 'info',
  autoHideDuration = 5000,
  anchorOrigin = { vertical: 'bottom', horizontal: 'left' },
  action,
  ...rest
}) {
  const live = severity === 'error' ? ASSERTIVE : POLITE
  return (
    <Snackbar
      open={open}
      onClose={onClose}
      autoHideDuration={autoHideDuration}
      anchorOrigin={anchorOrigin}
      {...rest}
    >
      <Alert
        onClose={onClose}
        severity={severity}
        variant="filled"
        action={action}
        {...live}
        sx={{ width: '100%' }}
      >
        {message}
      </Alert>
    </Snackbar>
  )
}
