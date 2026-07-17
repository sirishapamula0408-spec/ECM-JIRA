import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { NotificationPreferencesSection } from '../components/notifications/NotificationPreferencesSection'
import { fetchNotificationPreferences, updateNotificationPreferences } from '../api/notificationApi'

vi.mock('../api/notificationApi', () => ({
  fetchNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
}))

// GET returns the DB row (snake_case), as server/routes/notifications.js does.
const dbPrefs = {
  user_email: 'sirisha@sedintechnologies.com',
  in_app: true,
  email_enabled: false,
  email_digest: 'daily',
  muted_types: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchNotificationPreferences.mockResolvedValue({ ...dbPrefs })
  updateNotificationPreferences.mockResolvedValue({ ...dbPrefs })
})

describe('NotificationPreferencesSection (JL-200)', () => {
  it('renders current preferences from the API', async () => {
    render(<NotificationPreferencesSection />)

    expect(screen.getByText('Notification Preferences')).toBeInTheDocument()
    await waitFor(() => expect(fetchNotificationPreferences).toHaveBeenCalledTimes(1))

    const inApp = await screen.findByRole('switch', { name: 'In-app notifications' })
    const email = screen.getByRole('switch', { name: 'Email notifications' })
    expect(inApp).toBeChecked()
    expect(email).not.toBeChecked()

    const digest = screen.getByLabelText('Email digest frequency')
    expect(digest).toHaveValue('daily')
  })

  it('toggling the email switch calls updateNotificationPreferences with the new value', async () => {
    render(<NotificationPreferencesSection />)
    const email = await screen.findByRole('switch', { name: 'Email notifications' })

    fireEvent.click(email)

    await waitFor(() => expect(updateNotificationPreferences).toHaveBeenCalledTimes(1))
    expect(updateNotificationPreferences).toHaveBeenCalledWith({
      inApp: true,
      emailEnabled: true,
      emailDigest: 'daily',
      mutedTypes: [],
    })
    expect(await screen.findByText('Preferences saved')).toBeInTheDocument()
    expect(email).toBeChecked()
  })

  it('toggling the in-app switch off sends inApp: false', async () => {
    render(<NotificationPreferencesSection />)
    const inApp = await screen.findByRole('switch', { name: 'In-app notifications' })

    fireEvent.click(inApp)

    await waitFor(() => expect(updateNotificationPreferences).toHaveBeenCalledWith({
      inApp: false,
      emailEnabled: false,
      emailDigest: 'daily',
      mutedTypes: [],
    }))
  })

  it('changing digest frequency saves the selected value', async () => {
    render(<NotificationPreferencesSection />)
    const digest = await screen.findByLabelText('Email digest frequency')

    fireEvent.change(digest, { target: { value: 'weekly' } })

    await waitFor(() => expect(updateNotificationPreferences).toHaveBeenCalledWith({
      inApp: true,
      emailEnabled: false,
      emailDigest: 'weekly',
      mutedTypes: [],
    }))
    expect(digest).toHaveValue('weekly')
  })

  it('shows an error message when saving fails', async () => {
    updateNotificationPreferences.mockRejectedValueOnce(new Error('Server unavailable'))
    render(<NotificationPreferencesSection />)
    const email = await screen.findByRole('switch', { name: 'Email notifications' })

    fireEvent.click(email)

    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable')
  })

  it('shows an error message when loading fails', async () => {
    fetchNotificationPreferences.mockRejectedValueOnce(new Error('Network down'))
    render(<NotificationPreferencesSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Network down')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})
