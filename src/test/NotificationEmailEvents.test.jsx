// Per-event email switches on the Profile page ("Email me when…"). Each switch
// is stored inverted, as a muted notification type; email is on by default.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { NotificationPreferencesSection } from '../components/notifications/NotificationPreferencesSection'
import { fetchNotificationPreferences, updateNotificationPreferences } from '../api/notificationApi'

vi.mock('../api/notificationApi', () => ({
  fetchNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
}))

const ASSIGNED = 'An issue is assigned to me'
const STATUS = 'An issue I am assigned, reported or watch changes status'

beforeEach(() => {
  vi.clearAllMocks()
  updateNotificationPreferences.mockResolvedValue({})
})

describe('Email me when… switches', () => {
  it('treats a user with no saved preferences as email ON, with every event on', async () => {
    // A response without email_enabled is read as on, matching the server default.
    fetchNotificationPreferences.mockResolvedValue({ in_app: true, email_digest: 'off', muted_types: [] })
    render(<NotificationPreferencesSection />)

    expect(await screen.findByRole('switch', { name: 'Email notifications' })).toBeChecked()
    for (const name of [ASSIGNED, STATUS, 'An issue I reported is created', 'Someone comments on an issue I watch', 'Someone @mentions me']) {
      expect(screen.getByRole('switch', { name })).toBeChecked()
    }
  })

  it('switching an event off saves it as a muted type, and back on removes it', async () => {
    fetchNotificationPreferences.mockResolvedValue({ in_app: true, email_enabled: true, email_digest: 'off', muted_types: ['comment'] })
    render(<NotificationPreferencesSection />)

    const status = await screen.findByRole('switch', { name: STATUS })
    expect(screen.getByRole('switch', { name: 'Someone comments on an issue I watch' })).not.toBeChecked()

    fireEvent.click(status)
    await waitFor(() => expect(updateNotificationPreferences).toHaveBeenLastCalledWith({
      inApp: true, emailEnabled: true, emailDigest: 'off', mutedTypes: ['comment', 'status_changed'],
    }))

    fireEvent.click(screen.getByRole('switch', { name: 'Someone comments on an issue I watch' }))
    await waitFor(() => expect(updateNotificationPreferences).toHaveBeenLastCalledWith({
      inApp: true, emailEnabled: true, emailDigest: 'off', mutedTypes: ['status_changed'],
    }))
  })

  it('greys the event switches out while email is off', async () => {
    fetchNotificationPreferences.mockResolvedValue({ in_app: true, email_enabled: false, email_digest: 'off', muted_types: [] })
    render(<NotificationPreferencesSection />)

    const assigned = await screen.findByRole('switch', { name: ASSIGNED })
    expect(assigned).toBeDisabled()
    expect(assigned).not.toBeChecked()
  })
})
