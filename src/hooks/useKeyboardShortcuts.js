import { useEffect, useRef } from 'react'

/**
 * Returns true when the event originated from an editable element
 * (input, textarea, select, or a contentEditable region). Global
 * shortcuts must be ignored while the user is typing.
 */
export function isEditableTarget(target) {
  if (!target) return false
  if (target.isContentEditable) return true
  const tag = String(target.tagName || '').toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}

/**
 * Global keyboard-shortcut layer (JL-164).
 *
 * Listens for document-level keydown events and fires the injected
 * callbacks for power-user shortcuts:
 *   c        -> onCreate       (open Create Issue modal)
 *   /        -> onFocusSearch  (focus the Topbar global search)
 *   g then b -> onNavigate('/board')
 *   g then d -> onNavigate('/dashboard')
 *   ?        -> onShowHelp      (open the Shortcuts help dialog)
 *
 * Shortcuts are ignored while typing in an input/textarea/select/
 * contentEditable, and while a modifier key (Ctrl/Meta/Alt) is held.
 *
 * Callbacks are read through refs so the listener is attached once and
 * never re-attaches when the parent re-renders with new callback
 * identities (which would otherwise drop an in-progress `g` sequence).
 *
 * @param {object} handlers
 * @param {() => void} [handlers.onCreate]
 * @param {() => void} [handlers.onFocusSearch]
 * @param {(path: string) => void} [handlers.onNavigate]
 * @param {() => void} [handlers.onShowHelp]
 * @param {boolean} [handlers.enabled=true]
 * @param {number} [handlers.sequenceTimeout=1000] ms window for `g`-chords
 */
export function useKeyboardShortcuts({
  onCreate,
  onFocusSearch,
  onNavigate,
  onShowHelp,
  enabled = true,
  sequenceTimeout = 1000,
} = {}) {
  const handlersRef = useRef({})
  handlersRef.current = { onCreate, onFocusSearch, onNavigate, onShowHelp }

  const gPendingRef = useRef(false)
  const gTimerRef = useRef(null)

  useEffect(() => {
    if (!enabled) return undefined

    function clearSequence() {
      gPendingRef.current = false
      if (gTimerRef.current) {
        clearTimeout(gTimerRef.current)
        gTimerRef.current = null
      }
    }

    function handleKeyDown(event) {
      if (isEditableTarget(event.target)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const { key } = event
      const { onCreate: create, onFocusSearch: focusSearch, onNavigate: navigate, onShowHelp: showHelp } =
        handlersRef.current

      // Second key of a `g` chord.
      if (gPendingRef.current) {
        clearSequence()
        if (key === 'b') {
          event.preventDefault()
          navigate?.('/board')
          return
        }
        if (key === 'd') {
          event.preventDefault()
          navigate?.('/dashboard')
          return
        }
        // Unrecognised follow-up key: fall through to normal handling.
      }

      if (key === 'g') {
        gPendingRef.current = true
        if (gTimerRef.current) clearTimeout(gTimerRef.current)
        gTimerRef.current = setTimeout(() => {
          gPendingRef.current = false
          gTimerRef.current = null
        }, sequenceTimeout)
        return
      }

      if (key === 'c') {
        event.preventDefault()
        create?.()
        return
      }
      if (key === '/') {
        event.preventDefault()
        focusSearch?.()
        return
      }
      if (key === '?') {
        event.preventDefault()
        showHelp?.()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      clearSequence()
    }
  }, [enabled, sequenceTimeout])
}

/** Shortcut definitions shared by the help dialog. */
export const KEYBOARD_SHORTCUTS = [
  { keys: ['c'], description: 'Create a new issue' },
  { keys: ['/'], description: 'Focus the search box' },
  { keys: ['g', 'b'], description: 'Go to Board' },
  { keys: ['g', 'd'], description: 'Go to Dashboard' },
  { keys: ['?'], description: 'Show this help dialog' },
]
