import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * useFocusMainOnRouteChange (JL-220)
 *
 * After client-side navigation, keyboard/screen-reader focus would
 * otherwise stay on the unmounted page (falling back to <body>). This
 * hook moves focus to <main id="main-content"> (which has tabIndex={-1})
 * whenever the pathname changes, so the new page is announced and the
 * next Tab press starts from the top of the content region.
 *
 * The initial render is intentionally skipped — we only manage focus on
 * actual route *changes*, never on first load.
 *
 * JL-187 (fosasoft): a navigation that only RENAMES the current page can opt
 * out with `navigate(to, { state: { keepFocus: true } })`. The page editor
 * does this when its first autosave turns /wiki/new into
 * /wiki/pages/:id/edit: the same editor stays mounted, and pulling focus to
 * <main> there would swallow whatever the author types next.
 */
export function useFocusMainOnRouteChange() {
  const { pathname, state } = useLocation()
  const isFirstRender = useRef(true)
  const keepFocus = Boolean(state?.keepFocus)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (keepFocus) return
    const main = document.getElementById('main-content')
    if (main) main.focus()
    // keepFocus is read for the navigation that changed `pathname`; it must
    // not itself trigger a focus move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])
}
