import { useEffect, useState, useRef } from 'react'
import { ActivityItem } from '../../activity/ActivityItem'
import { fetchActivity } from '../../../api/dashboardApi'

export function ActivityStreamGadget({ activity: initialActivity, config }) {
  const [items, setItems] = useState(initialActivity || [])
  const intervalRef = useRef(null)
  const refreshInterval = config.refreshInterval || 30000

  useEffect(() => {
    setItems(initialActivity || [])
  }, [initialActivity])

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
