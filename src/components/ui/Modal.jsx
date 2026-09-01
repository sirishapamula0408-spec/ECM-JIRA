import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'

/**
 * Modal — a dialog (JL-439).
 *
 * Built on MUI's Dialog, NOT hand-rolled. JL-367 had to retrofit exactly this
 * behaviour onto a hand-rolled overlay: Escape-to-close, a focus trap, focus
 * restored to the trigger on close, `role="dialog"` with `aria-modal`, and
 * inert background content. Every one of those is a separate defect when it is
 * missing, and MUI already ships all of them. The geometry (radius 8, 24px
 * padding, the overlay shadow) comes from muiTheme.js, so this file adds
 * structure and nothing else.
 *
 * `title` is required and is wired to `aria-labelledby`, so the dialog always
 * announces what it is.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  actions,
  maxWidth = 'sm',
  fullWidth = true,
  titleId = 'ds-modal-title',
  ...rest
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby={titleId}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      {...rest}
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent>{children}</DialogContent>
      {actions != null && <DialogActions>{actions}</DialogActions>}
    </Dialog>
  )
}
