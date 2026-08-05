import { useCallback, useEffect, useRef } from 'react'

// Everything a modal can contain that should participate in the Tab cycle.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * useModalDialog (JL-367)
 *
 * Shared dialog semantics for the app's hand-rolled overlay modals, which had
 * none: no Escape-to-close, no focus trap, no focus restoration. A keyboard or
 * screen-reader user could Tab straight out of an open modal into the page
 * behind it, with no standard way to dismiss it. No existing modal in the app
 * implemented this (CreateIssueModal doesn't either — only the MUI Dialog
 * based ones get it for free), so it lives here once for all of them.
 *
 * Usage:
 *   const { dialogRef, handleDialogKeyDown } = useModalDialog(onClose)
 *   <div ref={dialogRef} onKeyDown={handleDialogKeyDown}
 *        role="dialog" aria-modal="true" aria-labelledby="my-title">
 *
 * The caller still supplies role/aria-modal/aria-labelledby in JSX (the
 * accessible name differs per modal); the hook provides the behaviour:
 *
 * - On mount: remembers the previously focused element (the invoking trigger)
 *   and moves focus onto the dialog container itself, so screen readers
 *   announce the dialog's accessible name before the first control.
 * - On unmount: restores focus to the invoking trigger — the part most often
 *   skipped; without it, closing the modal drops focus on <body>.
 * - Escape (anywhere inside, including text inputs) closes the dialog, unless
 *   an inner control already claimed the keypress via preventDefault (e.g. an
 *   autocomplete dismissing its own suggestion list — see MentionInput).
 * - Tab / Shift+Tab wrap within the dialog instead of escaping to the page.
 *
 * handleDialogKeyDown is a React onKeyDown prop (not a native listener) so
 * that inner components' synthetic handlers run first and can stopPropagation
 * to opt out entirely.
 */
export function useModalDialog(onClose) {
  const dialogRef = useRef(null)

  // Keep the latest onClose without re-running the mount effect (callers pass
  // inline closures that change identity every render).
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined

    const previouslyFocused = document.activeElement

    // Focus the container (not the first control) so the dialog's accessible
    // name is announced on open; tabIndex=-1 makes it programmatically
    // focusable without joining the Tab order.
    if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1')
    dialog.focus()

    return () => {
      // Restore focus to the invoking element, if it is still in the page.
      if (
        previouslyFocused &&
        typeof previouslyFocused.focus === 'function' &&
        document.contains(previouslyFocused)
      ) {
        previouslyFocused.focus()
      }
    }
  }, [])

  const handleDialogKeyDown = useCallback((event) => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (event.key === 'Escape') {
      // An inner control that handles Escape itself (e.g. closing its own
      // popup) signals so via preventDefault — don't also close the modal.
      if (event.defaultPrevented) return
      event.stopPropagation()
      onCloseRef.current()
      return
    }

    if (event.key !== 'Tab') return

    const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR))
    if (focusable.length === 0) {
      event.preventDefault()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    // Treat focus on the container itself (initial state) like being outside
    // the cycle: Tab enters at the first control, Shift+Tab at the last.
    const outsideCycle = active === dialog || !dialog.contains(active)

    if (event.shiftKey) {
      if (active === first || outsideCycle) {
        event.preventDefault()
        last.focus()
      }
    } else if (active === last || outsideCycle) {
      event.preventDefault()
      first.focus()
    }
  }, [])

  return { dialogRef, handleDialogKeyDown }
}
