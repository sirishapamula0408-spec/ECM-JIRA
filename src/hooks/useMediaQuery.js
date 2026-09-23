import { useCallback, useSyncExternalStore } from 'react'

/*
 * JL-472 — subscribe to a CSS media query from JS.
 *
 * Added for the Filter Results grid, which drops two columns on a narrow
 * viewport. That could not be done in CSS: the grid runs on `table-layout:
 * fixed` with a <colgroup>, and hiding a <th>/<td> pair with `display: none`
 * leaves the colgroup still declaring six columns for a four-column row —
 * exactly the header/body disagreement JL-469 existed to remove. Dropping the
 * column from the source list instead keeps the <col> and the cells derived
 * from one array, so they cannot disagree at any width.
 *
 * Built on useSyncExternalStore rather than useState + useEffect. A media query
 * is the textbook external store, and the effect version has to setState during
 * the effect body to close the gap between first render and subscription —
 * which is a cascading render, and which the repo's lint config rejects
 * outright (react-hooks/set-state-in-effect). useSyncExternalStore reads the
 * live value at render time, so the gap does not exist.
 *
 * Guarded for absence rather than assuming a browser. jsdom does provide
 * matchMedia, but a stub environment or an older one may not, and a dashboard
 * gadget must not be the thing that throws — an unsupported or invalid query
 * simply never matches, which yields the full-width layout, the safe default.
 *
 * `addEventListener` with an `addListener` fallback: Safari did not ship the
 * modern MediaQueryList event API until 14.
 */

// One MediaQueryList per query string. getSnapshot runs on every render, and
// matchMedia() returns a fresh object each call, so caching keeps it cheap —
// and keeps subscribe() and getSnapshot() reading the SAME list.
const listCache = new Map()

function getMediaQueryList(query) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  if (listCache.has(query)) return listCache.get(query)
  let mql = null
  try {
    mql = window.matchMedia(query)
  } catch {
    // An invalid query string throws in some engines. Treat it as "no match"
    // rather than taking the page down.
    mql = null
  }
  listCache.set(query, mql)
  return mql
}

const noopUnsubscribe = () => {}

export function useMediaQuery(query) {
  const subscribe = useCallback((onStoreChange) => {
    const mql = getMediaQueryList(query)
    if (!mql) return noopUnsubscribe
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onStoreChange)
      return () => mql.removeEventListener('change', onStoreChange)
    }
    if (typeof mql.addListener === 'function') {
      mql.addListener(onStoreChange)
      return () => mql.removeListener(onStoreChange)
    }
    return noopUnsubscribe
  }, [query])

  const getSnapshot = useCallback(() => {
    const mql = getMediaQueryList(query)
    return mql ? mql.matches : false
  }, [query])

  // Server snapshot: there is no viewport, so nothing matches — the same safe
  // default an environment without matchMedia gets.
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

export default useMediaQuery
