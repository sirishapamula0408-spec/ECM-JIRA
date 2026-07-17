import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

vi.mock('../api/notificationApi', () => ({
  fetchNotifications: vi.fn(),
  markNotificationRead: vi.fn().mockResolvedValue({ success: true }),
  markAllNotificationsRead: vi.fn().mockResolvedValue({ success: true }),
  deleteNotification: vi.fn().mockResolvedValue({ success: true }),
  clearReadNotifications: vi.fn().mockResolvedValue({ success: true, deleted: 1 }),
}))

import {
  fetchNotifications,
  deleteNotification,
  clearReadNotifications,
} from '../api/notificationApi'
import { NotificationProvider, useNotifications } from '../context/NotificationContext'
import { NotificationDropdown } from '../components/notifications/NotificationDropdown'

const NOTIFICATIONS = [
  { id: 1, type: 'mention', title: 'Unread mention', message: 'hi', is_read: false, created_at: new Date().toISOString() },
  { id: 2, type: 'comment', title: 'Read comment', message: 'done', is_read: true, created_at: new Date().toISOString() },
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

describe('Notification cleanup (JL-201)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchNotifications.mockResolvedValue({
      notifications: NOTIFICATIONS.map((n) => ({ ...n })),
      unreadCount: 1,
    })
  })

  it('dismissing a notification removes it from the list', async () => {
    renderDropdown()
    await waitFor(() => expect(screen.getByText('Read comment')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Dismiss notification: Read comment'))

    await waitFor(() => expect(screen.queryByText('Read comment')).not.toBeInTheDocument())
    expect(deleteNotification).toHaveBeenCalledWith(2)
    // Dismissing a read notification does not change the unread badge
    expect(screen.getByTestId('unread-count')).toHaveTextContent('1')
    expect(screen.getByText('Unread mention')).toBeInTheDocument()
  })

  it('dismissing an unread notification decrements the unread count', async () => {
    renderDropdown()
    await waitFor(() => expect(screen.getByText('Unread mention')).toBeInTheDocument())
    expect(screen.getByTestId('unread-count')).toHaveTextContent('1')

    fireEvent.click(screen.getByLabelText('Dismiss notification: Unread mention'))

    await waitFor(() => expect(screen.queryByText('Unread mention')).not.toBeInTheDocument())
    expect(deleteNotification).toHaveBeenCalledWith(1)
    expect(screen.getByTestId('unread-count')).toHaveTextContent('0')
  })

  it('"Clear read" removes read notifications and leaves unread ones', async () => {
    renderDropdown()
    await waitFor(() => expect(screen.getByText('Read comment')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Clear read' }))

    await waitFor(() => expect(screen.queryByText('Read comment')).not.toBeInTheDocument())
    expect(clearReadNotifications).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Unread mention')).toBeInTheDocument()
    expect(screen.getByTestId('unread-count')).toHaveTextContent('1')
    // Button disappears once there are no read notifications left
    expect(screen.queryByRole('button', { name: 'Clear read' })).not.toBeInTheDocument()
  })

  it('does not show "Clear read" when there are no read notifications', async () => {
    fetchNotifications.mockResolvedValue({
      notifications: [NOTIFICATIONS[0]],
      unreadCount: 1,
    })
    renderDropdown()
    await waitFor(() => expect(screen.getByText('Unread mention')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Clear read' })).not.toBeInTheDocument()
  })
})
