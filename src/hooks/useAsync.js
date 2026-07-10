import { useCallback, useEffect, useState } from 'react'

/**
 * Tiny async-state helper for consistent loading + error surfacing.
 *
 * @param {(...args: any[]) => Promise<any>} fn  async function to run
 * @param {Array<any>} [deps]  when provided, the fn auto-runs on mount and
 *                             whenever a dependency changes. Omit to run manually.
 * @returns {{ data: any, error: Error|null, loading: boolean, run: (...args:any[]) => Promise<any> }}
 */
export function useAsync(fn, deps) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const run = useCallback(async (...args) => {
    setLoading(true)
    setError(null)
    try {
      const result = await fn(...args)
      setData(result)
      return result
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error(String(err))
      setError(normalized)
      throw normalized
    } finally {
      setLoading(false)
    }
    // fn is intentionally captured; callers control identity via deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ?? [])

  useEffect(() => {
    if (deps === undefined) return
    // Swallow rejection here — error is already captured in state.
    run().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ?? [])

  return { data, error, loading, run }
}

export default useAsync
