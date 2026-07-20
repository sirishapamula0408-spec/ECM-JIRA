import { useCallback, useRef, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'

/**
 * ConfirmDialog — a reusable, theme-aware confirmation modal that replaces the
 * unstyled native `window.confirm()` on destructive actions (JL-232).
 *
 * Built on MUI `Dialog`, so it is dark-mode aware, focus-trapped, and closes on
 * Escape (which cancels). The confirm button is autofocused.
 *
 * Props:
 *   open         (bool, required)   Whether the dialog is visible.
 *   title        (string)           Headline. Defaults to "Are you sure?".
 *   message      (node/string)      Body copy. `description` is accepted as an alias.
 *   description  (node/string)      Alias for `message`.
 *   confirmLabel (string)           Confirm button text. Defaults to "Confirm".
 *   cancelLabel  (string)           Cancel button text. Defaults to "Cancel".
 *   danger       (bool)             Render the confirm button in red (destructive).
 *   busy         (bool)             Disable buttons while an async action runs.
 *   onConfirm    (fn, required)     Called when the confirm button is clicked.
 *   onCancel     (fn, required)     Called on cancel / Escape / backdrop click.
 *
 * For the cleanest adoption at imperative `if (!window.confirm(...)) return`
 * call sites, prefer the promise-based `useConfirm()` hook below.
 */
export function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const body = message != null ? message : description
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onCancel}
      maxWidth="xs"
      fullWidth
      aria-labelledby="confirm-dialog-title"
    >
      <DialogTitle id="confirm-dialog-title">{title}</DialogTitle>
      {body != null && body !== '' && (
        <DialogContent>
          <DialogContentText sx={{ whiteSpace: 'pre-line' }}>{body}</DialogContentText>
        </DialogContent>
      )}
      <DialogActions>
        <Button onClick={onCancel} disabled={busy} color="inherit">
          {cancelLabel}
        </Button>
        <Button
          onClick={onConfirm}
          disabled={busy}
          autoFocus
          variant="contained"
          color={danger ? 'error' : 'primary'}
        >
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * useConfirm — promise-based adapter around ConfirmDialog.
 *
 * Returns `{ confirm, confirmDialog }`:
 *   - `confirm(options)` opens the dialog and resolves to `true` (confirmed) or
 *     `false` (cancelled/Escape). `options` are ConfirmDialog props (title,
 *     message, confirmLabel, danger, …).
 *   - `confirmDialog` is the element to render once in the component tree.
 *
 * Usage:
 *   const { confirm, confirmDialog } = useConfirm()
 *   async function onDelete() {
 *     if (!(await confirm({ title: 'Delete?', message: '…', danger: true, confirmLabel: 'Delete' }))) return
 *     await doDelete()
 *   }
 *   return (<>… {confirmDialog}</>)
 */
export function useConfirm() {
  const [state, setState] = useState({ open: false, options: {} })
  const resolverRef = useRef(null)

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve
      setState({ open: true, options })
    })
  }, [])

  const settle = useCallback((result) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setState((s) => ({ ...s, open: false }))
    if (resolve) resolve(result)
  }, [])

  const confirmDialog = (
    <ConfirmDialog
      open={state.open}
      {...state.options}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  )

  return { confirm, confirmDialog }
}

export default ConfirmDialog
