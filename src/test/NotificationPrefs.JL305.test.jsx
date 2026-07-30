import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { NotificationPreferencesSection } from '../components/notifications/NotificationPreferencesSection'
import { api } from '../api/client'

/* ------------------------------------------------------------------ *
 * JL-305 — Notification-preferences UI persists via the API
 *
 * Unlike NotificationPreferencesSection.test.jsx (which mocks the
 * notificationApi module), this suite mocks the low-level api client so
 * it verifies the full wiring: the prefs form on ProfilePage really
 * issues PUT /api/notifications/preferences with the JSON body when a
 * preference changes.
 * ------------------------------------------------------------------ */

vi.mock('../api/client', () => ({ api: vi.fn() }))

// GET /api/notifications/preferences returns the DB row in snake_case.
const dbPrefs = {
  user_email: 'sirisha@sedintechnologies.com',
  in_app: true,
  email_enabled: false,
  email_digest: 'off',
  muted_types: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  api.mockImplementation((url, options = {}) => {
    if (url === '/api/notifications/preferences' && !options.method) {
      return Promise.resolve({ ...dbPrefs })
    }
    return Promise.resolve({ ok: true })
  })
})

function getPutCalls() {
  return api.mock.calls.filter(([, options]) => options && options.method === 'PUT')
}

describe('Notification preferences persist to the API (JL-305)', () => {
  it('loads current preferences with GET /api/notifications/preferences', async () => {
    render(<NotificationPreferencesSection />)

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/api/notifications/preferences'),
    )
    const email = await screen.findByRole('switch', { name: 'Email notifications' })
    expect(email).not.toBeChecked()
    expect(getPutCalls()).toHaveLength(0)
  })

  it('saving a toggle change calls PUT /api/notifications/preferences with the new values', async () => {
    render(<NotificationPreferencesSection />)
    const email = await screen.findByRole('switch', { name: 'Email notifications' })

    fireEvent.click(email)

    await waitFor(() => expect(getPutCalls()).toHaveLength(1))
    const [url, options] = getPutCalls()[0]
    expect(url).toBe('/api/notifications/preferences')
    expect(options.method).toBe('PUT')
    expect(JSON.parse(options.body)).toEqual({
      inApp: true,
      emailEnabled: true,
      emailDigest: 'off',
      mutedTypes: [],
    })
    expect(await screen.findByText('Preferences saved')).toBeInTheDocument()
  })

  it('changing the digest frequency issues a PUT with the selected digest', async () => {
    render(<NotificationPreferencesSection />)
    const digest = await screen.findByLabelText('Email digest frequency')

    fireEvent.change(digest, { target: { value: 'weekly' } })

    await waitFor(() => expect(getPutCalls()).toHaveLength(1))
    const [url, options] = getPutCalls()[0]
    expect(url).toBe('/api/notifications/preferences')
    expect(JSON.parse(options.body)).toEqual({
      inApp: true,
      emailEnabled: false,
      emailDigest: 'weekly',
      mutedTypes: [],
    })
  })

  it('surfaces an error when the PUT fails', async () => {
    render(<NotificationPreferencesSection />)
    const inApp = await screen.findByRole('switch', { name: 'In-app notifications' })

    api.mockImplementation((url, options = {}) => {
      if (options.method === 'PUT') return Promise.reject(new Error('Save failed'))
      return Promise.resolve({ ...dbPrefs })
    })
    fireEvent.click(inApp)

    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed')
  })
})
