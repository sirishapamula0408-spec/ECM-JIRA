import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, renderHook, fireEvent } from '@testing-library/react'
import { usePageTitle, setUnreadTitleCount, APP_NAME } from '../hooks/usePageTitle'
import { NotificationProvider, useNotifications } from '../context/NotificationContext'
import { fetchNotifications, markAllNotificationsRead } from '../api/notificationApi'

vi.mock('../api/notificationApi', () => ({
  fetchNotifications: vi.fn(),
  markNotificationRead: vi.fn().mockResolvedValue({}),
  markAllNotificationsRead: vi.fn().mockResolvedValue({}),
  deleteNotification: vi.fn().mockResolvedValue({}),
  clearReadNotifications: vi.fn().mockResolvedValue({}),
}))

function Consumer() {
  const { loadNotifications, markAllRead } = useNotifications()
  return (
    <>
      <button onClick={loadNotifications}>load</button>
      <button onClick={markAllRead}>mark all</button>
    </>
  )
}

describe('Unread notification count in tab title (JL-221)', () => {
  beforeEach(() => {
    setUnreadTitleCount(0)
    document.title = APP_NAME
    vi.clearAllMocks()
  })

  describe('setUnreadTitleCount', () => {
    it('prefixes the title with "(N) " when count > 0', () => {
      setUnreadTitleCount(3)
      expect(document.title).toBe(`(3) ${APP_NAME}`)
    })

    it('removes the prefix when the count drops to 0', () => {
      setUnreadTitleCount(5)
      expect(document.title).toBe(`(5) ${APP_NAME}`)
      setUnreadTitleCount(0)
      expect(document.title).toBe(APP_NAME)
    })

    it('updates an existing prefix without double-prefixing', () => {
      setUnreadTitleCount(2)
      setUnreadTitleCount(7)
      expect(document.title).toBe(`(7) ${APP_NAME}`)
    })

    it('caps the displayed count at "(9+)"', () => {
      setUnreadTitleCount(12)
      expect(document.title).toBe(`(9+) ${APP_NAME}`)
      setUnreadTitleCount(4)
      expect(document.title).toBe(`(4) ${APP_NAME}`)
    })
  })

  describe('cooperation with usePageTitle (JL-202)', () => {
    it('keeps the prefix when a page title mounts', () => {
      setUnreadTitleCount(3)
      renderHook(() => usePageTitle('Dashboard'))
      expect(document.title).toBe(`(3) Dashboard · ${APP_NAME}`)
    })

    it('does not double-prefix when navigating between pages', () => {
      setUnreadTitleCount(2)
      const { rerender } = renderHook(({ title }) => usePageTitle(title), {
        initialProps: { title: 'Backlog' },
      })
      expect(document.title).toBe(`(2) Backlog · ${APP_NAME}`)
      rerender({ title: 'Reports' })
      expect(document.title).toBe(`(2) Reports · ${APP_NAME}`)
    })

    it('updates the prefix in place while a page title is mounted', () => {
      renderHook(() => usePageTitle('Board'))
      expect(document.title).toBe(`Board · ${APP_NAME}`)
      setUnreadTitleCount(4)
      expect(document.title).toBe(`(4) Board · ${APP_NAME}`)
      setUnreadTitleCount(0)
      expect(document.title).toBe(`Board · ${APP_NAME}`)
    })

    it('restores the previous base title (with current prefix) on unmount', () => {
      setUnreadTitleCount(1)
      const { unmount } = renderHook(() => usePageTitle('Teams'))
      expect(document.title).toBe(`(1) Teams · ${APP_NAME}`)
      unmount()
      expect(document.title).toBe(`(1) ${APP_NAME}`)
      setUnreadTitleCount(0)
      expect(document.title).toBe(APP_NAME)
    })
  })

  describe('NotificationProvider integration', () => {
    it('prefixes the title after loading unread notifications', async () => {
      fetchNotifications.mockResolvedValue({ notifications: [], unreadCount: 3 })
      render(
        <NotificationProvider>
          <Consumer />
        </NotificationProvider>
      )
      expect(document.title).toBe(APP_NAME)

      fireEvent.click(screen.getByText('load'))
      await waitFor(() => expect(document.title).toBe(`(3) ${APP_NAME}`))
    })

    it('clears the prefix when all notifications are marked read', async () => {
      fetchNotifications.mockResolvedValue({ notifications: [], unreadCount: 2 })
      render(
        <NotificationProvider>
          <Consumer />
        </NotificationProvider>
      )
      fireEvent.click(screen.getByText('load'))
      await waitFor(() => expect(document.title).toBe(`(2) ${APP_NAME}`))

      fireEvent.click(screen.getByText('mark all'))
      await waitFor(() => expect(document.title).toBe(APP_NAME))
      expect(markAllNotificationsRead).toHaveBeenCalled()
    })

    it('clears the prefix when the provider unmounts (logout)', async () => {
      fetchNotifications.mockResolvedValue({ notifications: [], unreadCount: 6 })
      const { unmount } = render(
        <NotificationProvider>
          <Consumer />
        </NotificationProvider>
      )
      fireEvent.click(screen.getByText('load'))
      await waitFor(() => expect(document.title).toBe(`(6) ${APP_NAME}`))

      unmount()
      expect(document.title).toBe(APP_NAME)
    })

    it('does not prefix the title when there are no unread notifications', async () => {
      fetchNotifications.mockResolvedValue({ notifications: [], unreadCount: 0 })
      render(
        <NotificationProvider>
          <Consumer />
        </NotificationProvider>
      )
      fireEvent.click(screen.getByText('load'))
      await waitFor(() => expect(fetchNotifications).toHaveBeenCalled())
      expect(document.title).toBe(APP_NAME)
    })
  })
})
