import { useEffect } from 'react'

// Base app name — keep in sync with the <title> in index.html
export const APP_NAME = 'ECM Project Tracker'

/**
 * Sets the browser tab title to "<title> · ECM Project Tracker" while the
 * page is mounted, and restores the previous title on unmount.
 */
export function usePageTitle(title) {
  useEffect(() => {
    if (!title) return undefined
    const previousTitle = document.title
    document.title = `${title} · ${APP_NAME}`
    return () => {
      document.title = previousTitle
    }
  }, [title])
}

export default usePageTitle
