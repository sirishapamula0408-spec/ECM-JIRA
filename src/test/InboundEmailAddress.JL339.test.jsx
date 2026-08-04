import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { InboundEmailPage } from '../pages/InboundEmailPage/InboundEmailPage'

/*
 * JL-339 — The SMTP-test blurb on the Inbound Email page rendered a stray
 * empty parenthesis "()" because a placeholder JSX comment ("current admin")
 * was left inside the parens instead of the signed-in admin's email.
 *   1. When the signed-in user's email is known, it appears in parentheses.
 *   2. When it is unknown, the whole parenthetical is dropped — no "()" and
 *      no literal "undefined".
 */

let mockAuthUser = { email: 'admin@example.com' }

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ authUser: mockAuthUser, isAuthenticated: true }),
}))
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ isAdmin: true, workspaceRole: 'Admin' }),
}))
vi.mock('../hooks/usePageTitle', () => ({ usePageTitle: () => {} }))
vi.mock('../api/inboundEmailApi', () => ({
  fetchInboundEmailSettings: vi.fn(() => Promise.resolve({ settings: [], log: [] })),
  createInboundEmailSetting: vi.fn(() => Promise.resolve({})),
  deleteInboundEmailSetting: vi.fn(() => Promise.resolve({})),
}))
vi.mock('../api/notificationApi', () => ({
  sendTestEmail: vi.fn(() => Promise.resolve({ ok: true, sent: true, configured: true })),
}))
vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn(() => Promise.resolve([])),
}))

async function renderPage() {
  render(
    <MemoryRouter>
      <InboundEmailPage />
    </MemoryRouter>,
  )
  // Let the initial fetch effects settle.
  return await screen.findByText(/Verify your SMTP configuration/)
}

describe('JL-339 — SMTP test blurb shows the signed-in admin email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the signed-in user email in the parenthetical, not empty parens', async () => {
    mockAuthUser = { email: 'admin@example.com' }
    const blurb = await renderPage()
    expect(blurb.textContent).toContain('(admin@example.com)')
    expect(blurb.textContent).not.toContain('()')
  })

  it('drops the parenthetical entirely when no email is available', async () => {
    mockAuthUser = null
    const blurb = await renderPage()
    expect(blurb.textContent).not.toContain('()')
    expect(blurb.textContent).not.toContain('undefined')
    expect(blurb.textContent).toMatch(/your own address\.\s*$/)
  })
})
