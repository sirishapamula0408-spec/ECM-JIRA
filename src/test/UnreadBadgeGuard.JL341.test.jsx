import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

vi.mock('../api/notificationApi', () => ({
  fetchNotifications: vi.fn(),
  markNotificationRead: vi.fn().mockResolvedValue({ success: true }),
  markAllNotificationsRead: vi.fn().mockResolvedValue({ success: true }),
  deleteNotification: vi.fn().mockResolvedValue({ success: true }),
  clearReadNotifications: vi.fn().mockResolvedValue({ success: true }),
}))

import { fetchNotifications, markNotificationRead } from '../api/notificationApi'
import { NotificationProvider, useNotifications } from '../context/NotificationContext'
import { NotificationDropdown } from '../components/notifications/NotificationDropdown'

// JL-341: two already-read rows plus one unread row, server unread total 1.
// Clicking the read rows must NOT drive the badge below 1.
const NOTIFICATIONS = [
  { id: 1, type: 'comment', title: 'Read one', message: 'a', is_read: true, created_at: new Date().toISOString() },
  { id: 2, type: 'comment', title: 'Read two', message: 'b', is_read: true, created_at: new Date().toISOString() },
  { id: 3, type: 'mention', title: 'Unread mention', message: 'c', is_read: false, created_at: new Date().toISOString() },
]

function UnreadProbe() {
  const { unreadCount } = useNotifications()
  return <div data-testid="unread-count">{unreadCount}</div>
}

function renderDropdown() {
  return render(
    <BrowserRouter>
      <NotificationProvider>
        <UnreadProbe />
        <NotificationDropdown open onClose={() => {}} />
      </NotificationProvider>
    </BrowserRouter>,
  )
}

function clickRow(title) {
  // The row's main button contains the title text; click the button itself.
  fireEvent.click(screen.getByText(title).closest('button'))
}

describe('Unread badge guard (JL-341)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchNotifications.mockResolvedValue({
      notifications: NOTIFICATIONS.map((n) => ({ ...n })),
      unreadCount: 1,
    })
  })

  it('clicking already-read notifications does not decrement the badge', async () => {
    renderDropdown()
    await waitFor(() => expect(screen.getByText('Read one')).toBeInTheDocument())
    expect(screen.getByTestId('unread-count')).toHaveTextContent('1')

    clickRow('Read one')
    clickRow('Read two')

    // The badge must still report the one genuinely unread notification.
    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('1'))
    // JL-341: an already-read row needs no server round-trip either.
    expect(markNotificationRead).not.toHaveBeenCalled()
  })

  it('clicking the unread notification decrements the badge to 0', async () => {
    renderDropdown()
    await waitFor(() => expect(screen.getByText('Unread mention')).toBeInTheDocument())

    clickRow('Unread mention')

    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('0'))
    expect(markNotificationRead).toHaveBeenCalledTimes(1)
    expect(markNotificationRead).toHaveBeenCalledWith(3)
  })

  it('clicking the same unread notification twice does not go negative or double-count', async () => {
    renderDropdown()
    await waitFor(() => expect(screen.getByText('Unread mention')).toBeInTheDocument())

    clickRow('Unread mention')
    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('0'))

    // Second click: the row is now read in state, so nothing should change
    // and no second API call should fire.
    clickRow('Unread mention')
    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('unread-count')).toHaveTextContent('0')
  })
})
