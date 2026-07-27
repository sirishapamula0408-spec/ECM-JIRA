import { useEffect } from 'react'

/**
 * JL-242: Warns the user before leaving/refreshing the tab while there are
 * unsaved changes. Registers a `beforeunload` handler on window while
 * `isDirty` is truthy and removes it as soon as the changes are saved,
 * discarded, or the component unmounts.
 *
 * The browser shows its own generic confirmation dialog — custom messages
 * are ignored by modern browsers, but `preventDefault()` + a non-undefined
 * `returnValue` are both set for cross-browser support.
 *
 * Usage: `useUnsavedChangesWarning(isDirty)` — call unconditionally (Rules
 * of Hooks) and derive `isDirty` so it is only true while the user is
 * actually editing with genuine unsaved changes.
 */
export function useUnsavedChangesWarning(isDirty) {
  useEffect(() => {
    if (!isDirty) return undefined
    const handleBeforeUnload = (event) => {
      event.preventDefault()
      // Legacy Chrome/Edge require returnValue to be set to trigger the prompt.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])
}

export default useUnsavedChangesWarning
