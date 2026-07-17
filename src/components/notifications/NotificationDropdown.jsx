import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotifications } from '../../context/NotificationContext'
import { timeAgo } from '../../utils/timeAgo'
import './NotificationDropdown.css'

const TYPE_ICONS = {
  mention: '@',
  comment: '\uD83D\uDCAC',
  approval: '\u2705',
  assignment: '\uD83D\uDC64',
  status: '\u27A1\uFE0F',
  watcher: '\uD83D\uDC41\uFE0F',
}

export function NotificationDropdown({ open, onClose }) {
  const { notifications, unreadCount, markRead, markAllRead, dismiss, clearRead, loadNotifications } = useNotifications()
  const navigate = useNavigate()
  const ref = useRef(null)

  useEffect(() => {
    if (open) loadNotifications()
  }, [open, loadNotifications])

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        onClose()
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, onClose])

  if (!open) return null

  function handleClick(n) {
    markRead(n.id)
    if (n.issue_id) {
      navigate(`/issues/${n.issue_id}`)
    }
    onClose()
  }

  return (
    <div className="notif-dropdown" ref={ref}>
      <div className="notif-header">
        <h3>Notifications</h3>
        <div className="notif-header-actions">
          {unreadCount > 0 && (
            <button type="button" className="notif-mark-all" onClick={markAllRead}>
              Mark all read
            </button>
          )}
          {notifications.some((n) => n.is_read) && (
            <button type="button" className="notif-clear-read" onClick={clearRead}>
              Clear read
            </button>
          )}
        </div>
      </div>
      <div className="notif-list">
        {notifications.length === 0 ? (
          <p className="notif-empty">No notifications</p>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className={`notif-item${n.is_read ? '' : ' notif-item--unread'}`}
            >
              <button
                type="button"
                className="notif-item-main"
                onClick={() => handleClick(n)}
              >
                <span className="notif-icon">{TYPE_ICONS[n.type] || '\uD83D\uDD14'}</span>
                <div className="notif-content">
                  <span className="notif-title">{n.title}</span>
                  {n.message && <span className="notif-message">{n.message}</span>}
                  <span className="notif-time">{timeAgo(n.created_at)}</span>
                </div>
                {!n.is_read && <span className="notif-unread-dot" />}
              </button>
              <button
                type="button"
                className="notif-dismiss"
                title="Dismiss"
                aria-label={`Dismiss notification: ${n.title}`}
                onClick={() => dismiss(n.id)}
              >
                &times;
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
