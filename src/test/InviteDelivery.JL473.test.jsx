/* ================================================================
   JL-473 — the User Management page must say whether the invite
   email actually went out.

   Reported as "inviting a user sends no email". The send path was
   intact; what was missing was any way to know. POST /api/members has
   returned `email_status` / `email_error` since JL-323 and this page
   discarded both, branching only on whether a password was typed:

       showToast(payload.password
         ? `Created account for ...`
         : `Invited ...`)

   So a delivered invite, one the provider rejected, and one that was
   never attempted because SMTP is unset all produced the same green
   toast. The member record is created in every one of those cases, so
   this is a severity-and-wording problem, not a flow problem — and
   these tests are written against that distinction.
   ================================================================ */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

import { describeInviteOutcome } from '../utils/inviteOutcome'
import { InviteDeliveryBadge } from '../components/common/InviteDeliveryBadge'

vi.mock('../api/memberApi', () => ({
  fetchMembersPage: vi.fn(),
  createMember: vi.fn(),
  updateMemberRole: vi.fn(),
  deleteMember: vi.fn(),
  bulkDeleteMembers: vi.fn(),
  deactivateMember: vi.fn(),
  reactivateMember: vi.fn(),
  fetchUserAuditLog: vi.fn(() => Promise.resolve([])),
  inviteMember: vi.fn(),
  resendMemberInvite: vi.fn(),
  updateProfile: vi.fn(),
  fetchMembers: vi.fn(() => Promise.resolve([])),
}))

import { UserManagementPage } from '../pages/UserManagementPage/UserManagementPage'
import { MemberProvider } from '../context/MemberProvider'
import { fetchMembersPage, createMember } from '../api/memberApi'

/* ---------------------------------------------------------------- *
 * The pure mapping
 * ---------------------------------------------------------------- */
describe('JL-473 — describeInviteOutcome', () => {
  it('reports a delivered invite as a success that says so', () => {
    const out = describeInviteOutcome({ name: 'Ada', email_status: 'sent' }, 'ada@x.com', false)
    expect(out.severity).toBe('success')
    expect(out.message).toContain('Ada')
    expect(out.message).toMatch(/sent/i)
  })

  it('reports an unconfigured mailer as a WARNING, not a success', () => {
    // The account exists and an admin can still hand over credentials, so it is
    // not an error — but nobody was told anything, so it is not success either.
    const out = describeInviteOutcome({ name: 'Ada', email_status: 'skipped' }, 'ada@x.com', false)
    expect(out.severity).toBe('warning')
    expect(out.message).toMatch(/not configured/i)
  })

  it('reports a provider rejection as an error, carrying the reason', () => {
    const out = describeInviteOutcome(
      { name: 'Ada', email_status: 'failed', email_error: '550 mailbox unavailable' },
      'ada@x.com', false,
    )
    expect(out.severity).toBe('error')
    expect(out.message).toContain('550 mailbox unavailable')
  })

  it('still reads sensibly when a failure carries no reason', () => {
    const out = describeInviteOutcome({ name: 'Ada', email_status: 'failed' }, 'ada@x.com', false)
    expect(out.severity).toBe('error')
    expect(out.message).toMatch(/could not be sent\./)
  })

  it('says "created", not "invited", when a temporary password was set', () => {
    const out = describeInviteOutcome(
      { name: 'Ada', email_status: 'not_applicable' }, 'ada@x.com', true,
    )
    expect(out.severity).toBe('success')
    expect(out.message).toMatch(/Created account/)
  })

  it('falls back to the old neutral wording against a server that sends no status', () => {
    // An older API, or a field we did not get. Inventing a delivery claim here
    // would be the same defect in the other direction.
    const out = describeInviteOutcome({ name: 'Ada' }, 'ada@x.com', false)
    expect(out.severity).toBe('success')
    expect(out.message).toBe('Invited Ada.')
  })

  it('falls back to the email address when the response carries no name', () => {
    const out = describeInviteOutcome({ email_status: 'sent' }, 'ada@x.com', false)
    expect(out.message).toContain('ada@x.com')
  })

  it('tolerates a null response body', () => {
    expect(() => describeInviteOutcome(null, 'ada@x.com', false)).not.toThrow()
  })
})

/* ---------------------------------------------------------------- *
 * The badge
 * ---------------------------------------------------------------- */
describe('JL-473 — InviteDeliveryBadge', () => {
  const renderBadge = (props) => render(<InviteDeliveryBadge {...props} />)

  it('labels each delivery state distinctly', () => {
    for (const [status, label] of [
      ['sent', 'Sent'], ['failed', 'Failed'], ['skipped', 'Not sent'], ['unknown', 'Unknown'],
    ]) {
      const { unmount } = renderBadge({ status })
      expect(screen.getByText(label)).toBeInTheDocument()
      unmount()
    }
  })

  it('treats an unrecognised status as unknown rather than rendering nothing', () => {
    renderBadge({ status: 'something-new' })
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('puts the failure reason in the tooltip, not in the badge text', () => {
    const { container } = renderBadge({ status: 'failed', error: '550 mailbox unavailable' })
    const badge = container.querySelector('.pill')
    // The badge stays one word so it is scannable down a column...
    expect(badge.textContent).toBe('Failed')
    // ...and the sentence an admin needs is still reachable.
    expect(badge.getAttribute('title')).toContain('550 mailbox unavailable')
  })

  it('says plainly that nothing was attempted, for an unknown address', () => {
    const { container } = renderBadge({ status: 'unknown' })
    expect(container.querySelector('.pill').getAttribute('title'))
      .toMatch(/No delivery attempt recorded/i)
  })

  it('takes the JL-472 lozenge shape rather than the round chip', () => {
    const { container } = renderBadge({ status: 'sent' })
    const badge = container.querySelector('.pill')
    expect(badge.classList.contains('pill--lozenge')).toBe(true)
    expect(badge.classList.contains('pill-green')).toBe(true)
  })
})

/* ---------------------------------------------------------------- *
 * The page
 * ---------------------------------------------------------------- */
const MEMBERS = [
  { id: 1, name: 'Alice Johnson', email: 'alice@example.com', role: 'Admin', status: 'Active', task_count: 3, email_status: 'unknown' },
  { id: 2, name: 'Bob Pending', email: 'bob@example.com', role: 'Member', status: 'Invited', task_count: 0, email_status: 'sent', email_sent_at: '2026-09-01T10:00:00Z' },
  { id: 3, name: 'Carol Bounced', email: 'carol@example.com', role: 'Viewer', status: 'Invited', task_count: 0, email_status: 'failed', email_error: '550 no such mailbox' },
]

function renderPage() {
  return render(
    <BrowserRouter>
      <MemberProvider>
        <UserManagementPage />
      </MemberProvider>
    </BrowserRouter>,
  )
}

async function renderLoaded() {
  renderPage()
  await waitFor(() => expect(screen.getByText('Alice Johnson')).toBeInTheDocument())
}

const rowFor = (name) => screen.getByText(name).closest('tr')

async function submitInvite(email = 'new@example.com') {
  fireEvent.click(screen.getByRole('button', { name: /add user/i }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText(/full name/i), { target: { value: 'New Person' } })
  fireEvent.change(within(dialog).getByLabelText(/email/i), { target: { value: email } })
  fireEvent.click(within(dialog).getByRole('button', { name: /^add user$/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchMembersPage.mockResolvedValue({ items: MEMBERS, total: MEMBERS.length, limit: 25, offset: 0 })
})

describe('JL-473 — the member list shows invite delivery state', () => {
  it('badges an invited member whose email was delivered', async () => {
    await renderLoaded()
    expect(within(rowFor('Bob Pending')).getByText('Sent')).toBeInTheDocument()
  })

  it('badges an invited member whose email bounced, with the reason in the tooltip', async () => {
    await renderLoaded()
    const badge = within(rowFor('Carol Bounced')).getByText('Failed')
    expect(badge.getAttribute('title')).toContain('550 no such mailbox')
  })

  it('shows no delivery badge for an active member — the column is about people waiting', async () => {
    await renderLoaded()
    const row = rowFor('Alice Johnson')
    expect(within(row).queryByText('Sent')).toBeNull()
    expect(within(row).queryByText('Unknown')).toBeNull()
  })

  it('adds the column header', async () => {
    await renderLoaded()
    expect(screen.getByRole('columnheader', { name: /invite email/i })).toBeInTheDocument()
  })
})

describe('JL-473 — the invite toast reports the real outcome', () => {
  it('confirms delivery when the server says it sent', async () => {
    createMember.mockResolvedValue({
      id: 9, name: 'New Person', email: 'new@example.com', status: 'Invited', email_status: 'sent',
    })
    await renderLoaded()
    await submitInvite()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/invitation email sent/i)
    expect(alert.className).toMatch(/Success/)
  })

  it('warns — does not celebrate — when SMTP is not configured', async () => {
    createMember.mockResolvedValue({
      id: 9, name: 'New Person', email: 'new@example.com', status: 'Invited', email_status: 'skipped',
    })
    await renderLoaded()
    await submitInvite()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/no invitation email was sent/i)
    expect(alert.className).toMatch(/Warning/)
    // The old behaviour — a plain green "Invited ..." — must not come back.
    expect(alert.className).not.toMatch(/Success/)
  })

  it('surfaces the provider error when the send failed', async () => {
    createMember.mockResolvedValue({
      id: 9, name: 'New Person', email: 'new@example.com', status: 'Invited',
      email_status: 'failed', email_error: '535 authentication failed',
    })
    await renderLoaded()
    await submitInvite()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('535 authentication failed')
    expect(alert.className).toMatch(/Error/)
  })

  it('still reports the member as added when the email failed — the record exists', async () => {
    createMember.mockResolvedValue({
      id: 9, name: 'New Person', email: 'new@example.com', status: 'Invited',
      email_status: 'failed', email_error: 'relay down',
    })
    await renderLoaded()
    await submitInvite()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/was added/i)
  })

  it('closes the dialog and keeps the new member, whatever the email did', async () => {
    createMember.mockResolvedValue({
      id: 9, name: 'New Person', email: 'new@example.com', status: 'Invited', email_status: 'failed',
    })
    await renderLoaded()
    await submitInvite()

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('New Person')).toBeInTheDocument()
  })
})
