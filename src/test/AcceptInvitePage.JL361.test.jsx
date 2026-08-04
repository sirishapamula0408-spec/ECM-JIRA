import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { AcceptInvitePage } from '../pages/AcceptInvitePage/AcceptInvitePage'
import { acceptInvitation, lookupInvitation } from '../api/memberApi'

// JL-361: the page is the destination of the token link in the invite email.
// Only the two invitation endpoints matter here, but the module is stubbed
// wholesale so its other exports don't drag in the real API client.
vi.mock('../api/memberApi', () => ({
  lookupInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
}))

function renderAt(token) {
  const search = token == null ? '' : `?token=${encodeURIComponent(token)}`
  return render(
    <MemoryRouter initialEntries={[`/accept-invite${search}`]}>
      <AcceptInvitePage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AcceptInvitePage (JL-361)', () => {
  it('looks the token up from the query string and redeems it', async () => {
    lookupInvitation.mockResolvedValueOnce({
      email: 'newbie@test.com', role: 'Member', status: 'pending', expired: false, valid: true,
    })
    acceptInvitation.mockResolvedValueOnce({ ok: true, member: { id: 1, role: 'Member' } })

    renderAt('tok-123')

    await waitFor(() => expect(lookupInvitation).toHaveBeenCalledWith('tok-123'))
    expect(await screen.findByText(/newbie@test.com/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }))

    await waitFor(() => {
      expect(acceptInvitation).toHaveBeenCalledWith('tok-123', { name: 'newbie' })
    })
    expect(await screen.findByText(/you're now a member/i)).toBeInTheDocument()
  })

  it('explains that a link without a token cannot be redeemed', async () => {
    renderAt(null)
    expect(await screen.findByText(/missing its token/i)).toBeInTheDocument()
    expect(lookupInvitation).not.toHaveBeenCalled()
  })

  it('reports an unknown token instead of offering to accept', async () => {
    lookupInvitation.mockRejectedValueOnce(new Error('Invitation not found'))
    renderAt('ghost')
    expect(await screen.findByText(/invitation not found/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /accept invitation/i })).not.toBeInTheDocument()
  })

  it('refuses to redeem an expired invitation', async () => {
    lookupInvitation.mockResolvedValueOnce({
      email: 'old@test.com', role: 'Member', status: 'pending', expired: true, valid: false,
    })
    renderAt('stale')
    expect(await screen.findByText(/has expired/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /accept invitation/i })).not.toBeInTheDocument()
  })

  it('surfaces a server error from the accept call', async () => {
    lookupInvitation.mockResolvedValueOnce({
      email: 'newbie@test.com', role: 'Viewer', status: 'pending', expired: false, valid: true,
    })
    acceptInvitation.mockRejectedValueOnce(new Error('This invitation has been revoked'))

    renderAt('tok-123')
    fireEvent.click(await screen.findByRole('button', { name: /accept invitation/i }))

    expect(await screen.findByText(/has been revoked/i)).toBeInTheDocument()
  })
})
