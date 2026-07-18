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
 */
export function useFocusMainOnRouteChange() {
  const { pathname } = useLocation()
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    const main = document.getElementById('main-content')
    if (main) main.focus()
  }, [pathname])
}
