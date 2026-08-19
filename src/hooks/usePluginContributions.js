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
    // JL-407: the spinner has to come back when `extensionPoint` changes, and
    // that trigger is a prop change — there is no user event in this hook to
    // hang the flag off, and no render-time derivation for "a request is in
    // flight". On mount the value is already true so React bails out; the one
    // extra render is only paid on an actual extension-point switch.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    setLoading(true)
    fetchContributions(extensionPoint)
      .then((data) => { if (active) setContributions(Array.isArray(data) ? data : []) })
      .catch(() => { if (active) setContributions([]) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [extensionPoint])

  return { contributions, loading }
}
