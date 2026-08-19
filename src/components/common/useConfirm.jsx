// JL-407: split out of ConfirmDialog.jsx, which exported this hook alongside
// the ConfirmDialog component and so opted the whole module out of Vite fast
// refresh (react-refresh/only-export-components). The dialog is a leaf UI
// component that gets iterated on, so the refresh loss there was a real cost,
// not a notional one.
import { useCallback, useRef, useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

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
