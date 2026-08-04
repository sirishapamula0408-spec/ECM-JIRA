import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { fetchNotifications, markNotificationRead, markAllNotificationsRead, deleteNotification, clearReadNotifications } from '../api/notificationApi'
import { setUnreadTitleCount } from '../hooks/usePageTitle'

const NotificationContext = createContext(null)

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)

  // JL-221: mirror the unread count into the browser tab title as a "(N) "
  // prefix; cleared when the count drops to 0 or the provider unmounts.
  useEffect(() => {
    setUnreadTitleCount(unreadCount)
    return () => setUnreadTitleCount(0)
  }, [unreadCount])

  const loadNotifications = useCallback(async () => {
    try {
      const data = await fetchNotifications({ limit: 30 })
      setNotifications(data.notifications || [])
      setUnreadCount(data.unreadCount || 0)
    } catch {
      // ignore
    }
  }, [])

  const markRead = useCallback(async (id) => {
    // JL-341: clicking an already-read notification used to decrement
    // unreadCount unconditionally, driving the bell badge (and the JL-221
    // tab-title mirror derived from it) below the real number of unread
    // rows. An already-read row needs no server call either — the API would
    // just re-set is_read = TRUE — so we skip the request entirely instead
    // of firing a redundant PATCH per click.
    const target = notifications.find((n) => n.id === id)
    if (target && target.is_read) return
    try {
      await markNotificationRead(id)
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n))
      // JL-341: only decrement when we know the row was unread. If the id is
      // not in local state (no current caller does this) we still mark it
      // server-side but leave the count alone; the next loadNotifications()
      // resyncs from the server total.
      if (target && !target.is_read) {
        setUnreadCount((prev) => Math.max(0, prev - 1))
      }
    } catch {
      // ignore
    }
  }, [notifications])

  const markAllRead = useCallback(async () => {
    try {
      await markAllNotificationsRead()
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
      setUnreadCount(0)
    } catch {
      // ignore
    }
  }, [])

  const dismiss = useCallback(async (id) => {
    const target = notifications.find((n) => n.id === id)
    const removeLocally = () => {
      setNotifications((prev) => prev.filter((n) => n.id !== id))
      if (target && !target.is_read) {
        setUnreadCount((prev) => Math.max(0, prev - 1))
      }
    }
    try {
      await deleteNotification(id)
      removeLocally()
    } catch (err) {
      // JL-364: DELETE /:id no longer reports success for rows that don't
      // exist — it 404s. A 404 here means the row is already gone server-side
      // (deleted in another tab, or swept by clear-read), so pruning it locally
      // is the correct resync. Any other error keeps the row visible.
      if (err?.status === 404) {
        removeLocally()
      }
    }
  }, [notifications])

  const clearRead = useCallback(async () => {
    try {
      await clearReadNotifications()
      setNotifications((prev) => prev.filter((n) => !n.is_read))
    } catch {
      // ignore
    }
  }, [])

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, loadNotifications, markRead, markAllRead, dismiss, clearRead }}>
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) throw new Error('useNotifications must be used within NotificationProvider')
  return context
}
