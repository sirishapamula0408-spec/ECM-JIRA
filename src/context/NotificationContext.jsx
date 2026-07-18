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
    try {
      await markNotificationRead(id)
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n))
      setUnreadCount((prev) => Math.max(0, prev - 1))
    } catch {
      // ignore
    }
  }, [])

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
    try {
      await deleteNotification(id)
      setNotifications((prev) => prev.filter((n) => n.id !== id))
      if (target && !target.is_read) {
        setUnreadCount((prev) => Math.max(0, prev - 1))
      }
    } catch {
      // ignore
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
