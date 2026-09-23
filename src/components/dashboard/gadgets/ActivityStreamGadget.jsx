import { useEffect, useState, useRef } from 'react'
import { ActivityItem } from '../../activity/ActivityItem'
import { EmptyState } from '../../common/EmptyState'
import { fetchActivity } from '../../../api/dashboardApi'

/*
 * JL-472: the empty state is the shared <EmptyState> (JL-244), not a local
 * <p> + <small>.
 *
 * The bespoke version had no icon, no heading element, and used <small> for
 * what is a description rather than fine print — and it carried its own colour
 * and padding, which meant its dark-theme treatment had to be remembered
 * separately and never was. EmptyState brings all of that, and this gadget now
 * looks like every other empty state in the app instead of like itself.
 */
const EMPTY_ICON = (
  <svg viewBox="0 0 40 40" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 20h6l4-9 6 18 4-11 2.5 4H36" />
  </svg>
)

export function ActivityStreamGadget({ activity: initialActivity, config }) {
  const [items, setItems] = useState(initialActivity || [])
  const intervalRef = useRef(null)
  const refreshInterval = config.refreshInterval || 30000

  // JL-407: `items` can't be plain derived state — the poller below replaces it
  // — but a fresh `initialActivity` prop must still win. That reset is now done
  // during render (React's "adjusting state when a prop changes" pattern) rather
  // than in an effect. React restarts the render immediately instead of
  // committing, so the list never paints one frame of the previous prop's items,
  // and the state update is skipped entirely when the prop is unchanged.
  const [lastProp, setLastProp] = useState(initialActivity)
  if (initialActivity !== lastProp) {
    setLastProp(initialActivity)
    setItems(initialActivity || [])
  }

  useEffect(() => {
    intervalRef.current = setInterval(async () => {
      try {
        const data = await fetchActivity()
        if (Array.isArray(data)) setItems(data)
      } catch { /* ignore refresh errors */ }
    }, refreshInterval)

    return () => clearInterval(intervalRef.current)
  }, [refreshInterval])

  if (items.length === 0) {
    return (
      <EmptyState
        icon={EMPTY_ICON}
        title="No activity yet"
        description="Create some issues or invite teammates to see activity here."
      />
    )
  }

  return (
    <div className="activity-stream-gadget">
      <ul className="activity-list">
        {items.slice(0, 20).map((item) => (
          <ActivityItem key={item.id} item={item} />
        ))}
      </ul>
    </div>
  )
}
