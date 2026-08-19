import { useEffect, useState, useRef } from 'react'
import { ActivityItem } from '../../activity/ActivityItem'
import { fetchActivity } from '../../../api/dashboardApi'

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
      <div className="activity-stream-empty">
        <p>No activity yet</p>
        <small>Create some issues or invite teammates to see activity here.</small>
      </div>
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
