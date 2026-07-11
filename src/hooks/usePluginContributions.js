import { useEffect, useState } from 'react'
import { fetchContributions } from '../api/pluginApi'

/**
 * JL-145: Load the merged, host-sanitized declarative contributions for one
 * extension point. The backend only returns SAFE contributions (validated urls,
 * enabled manifests only) — the host renders these as data, never as code.
 *
 * @param {string} extensionPoint one of the known EXTENSION_POINTS
 * @returns {{ contributions: Array, loading: boolean }}
 */
export function usePluginContributions(extensionPoint) {
  const [contributions, setContributions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchContributions(extensionPoint)
      .then((data) => { if (active) setContributions(Array.isArray(data) ? data : []) })
      .catch(() => { if (active) setContributions([]) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [extensionPoint])

  return { contributions, loading }
}
