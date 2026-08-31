// JL-417 — Teams page member management, aligned with Atlassian's patterns.
//
// Four things changed, and each has a distinct failure mode worth pinning:
//   1. The page carried TWO functionally identical invite forms. JL-247 had
//      already declared the header flow "the single canonical invite path"; the
//      panel form was the leftover. Only one may render now — but the pending
//      invitations list, resend, revoke and the delivery badge must survive,
//      because they lived in the same panel.
//   2. Role was a read-only pill. It is now a Select, except for Owner rows.
//      The server owns the Owner / last-Admin rules, so the UI must SURFACE a
//      rejection rather than pre-empt it — a client-side copy of that rule is
//      how the two drift apart.
//   3. Active / Invited / Deactivated collapsed onto two colours, and the
//      Actions cell printed the literal word "Active" for every non-Invited
//      row — including Deactivated ones, contradicting their own Status cell.
//   4. The Status filter now defaults to Active.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

vi.mock('../api/memberApi', () => ({
  fetchMembers: vi.fn(),
  fetchInvitations: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  resendInvitation: vi.fn(),
  inviteMember: vi.fn(),
  resendMemberInvite: vi.fn(),
  updateProfile: vi.fn(),
  deleteMember: vi.fn(),
  bulkDeleteMembers: vi.fn(),
  updateMemberRole: vi.fn(),
  deactivateMember: vi.fn(),
  reactivateMember: vi.fn(),
}))
vi.mock('../api/workspaceApi', () => ({
  fetchWorkspaceSettings: vi.fn(() => Promise.resolve({})),
  updateProjectCreationPolicy: vi.fn(),
}))
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}))

import { TeamsPage } from '../pages/TeamsPage/TeamsPage'
import { MemberProvider } from '../context/MemberProvider'
import { usePermissions } from '../hooks/usePermissions'
import {
  fetchMembers, fetchInvitations,
  updateMemberRole, deactivateMember, reactivateMember,
} from '../api/memberApi'
import { fetchWorkspaceSettings } from '../api/workspaceApi'

const OWNER = { id: 1, name: 'Ada Owner', email: 'ada@example.com', role: 'Admin', status: 'Active', is_owner: true, task_count: 4 }
const ADMIN = { id: 2, name: 'Grace Admin', email: 'grace@example.com', role: 'Admin', status: 'Active', is_owner: false, task_count: 7 }
const MEMBER = { id: 3, name: 'Alan Member', email: 'alan@example.com', role: 'Member', status: 'Active', is_owner: false, task_count: 0 }
const INVITED = { id: 4, name: 'Ines Invited', email: 'ines@example.com', role: 'Viewer', status: 'Invited', is_owner: false, task_count: 0 }
const OFF = { id: 5, name: 'Dana Off', email: 'dana@example.com', role: 'Member', status: 'Deactivated', is_owner: false, task_count: 2 }

const ALL = [OWNER, ADMIN, MEMBER, INVITED, OFF]

function renderPage() {
  return render(
    <BrowserRouter>
      <MemberProvider>
        <TeamsPage />
      </MemberProvider>
    </BrowserRouter>,
  )
}

async function renderLoaded() {
  const utils = renderPage()
  await waitFor(() => expect(screen.queryByText(/Loading team members/i)).not.toBeInTheDocument())
  return utils
}

/** The Status filter defaults to Active, so widen it when a test needs everyone. */
async function showAllStatuses() {
  fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'all' } })
  await waitFor(() => expect(screen.getByText('Dana Off')).toBeInTheDocument())
}

/**
 * Pick a role from the inline editor.
 *
 * MUI's Select renders a button-like div plus a hidden input, not a native
 * <select>, so fireEvent.change throws "element does not have a value setter".
 * The interaction is: mouseDown to open the listbox, then click the option.
 */
async function selectRole(memberName, role) {
  fireEvent.mouseDown(screen.getByLabelText(`Change role for ${memberName}`))
  const listbox = await screen.findByRole('listbox')
  fireEvent.click(within(listbox).getByRole('option', { name: role }))
}

/** The <tr> for a member, so assertions can be scoped to one row. */
function rowFor(name) {
  return screen.getByText(name).closest('tr')
}

beforeEach(() => {
  vi.clearAllMocks()
  usePermissions.mockReturnValue({ canInviteMembers: true, isAdmin: true })
  fetchMembers.mockResolvedValue(ALL)
  fetchInvitations.mockResolvedValue([])
  fetchWorkspaceSettings.mockResolvedValue({ project_creation_policy: 'all_members' })
  updateMemberRole.mockResolvedValue({})
  deactivateMember.mockResolvedValue({})
  reactivateMember.mockResolvedValue({})
})

// ─────────────────────── 1. one invite form ───────────────────────

describe('JL-417 — the duplicate invite form is gone', () => {
  it('renders no invite form until the header toggle is used', async () => {
    await renderLoaded()

    // The always-on panel form used to be here from first paint.
    expect(screen.queryByRole('button', { name: /Send Invitation/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Invite Members$/i })).not.toBeInTheDocument()
  })

  it('still opens exactly one invite form from the header', async () => {
    await renderLoaded()

    fireEvent.click(screen.getByRole('button', { name: /Invite Member/i }))

    expect(await screen.findByRole('heading', { name: /Invite a new member/i })).toBeInTheDocument()
    // One email field, not two.
    expect(screen.getAllByPlaceholderText(/Email address/i)).toHaveLength(1)
  })

  it('keeps the pending-invitations panel, which shared the removed form', async () => {
    fetchInvitations.mockResolvedValue([
      { id: 9, email: 'pending@example.com', role: 'Member', status: 'pending', expires_at: '2030-01-01', email_status: 'sent' },
    ])
    await renderLoaded()

    expect(await screen.findByRole('heading', { name: /Pending Invitations/i })).toBeInTheDocument()
    expect(screen.getByText('pending@example.com')).toBeInTheDocument()
    // JL-323's delivery badge lived in this panel and must survive.
    expect(screen.getByText('Sent')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Revoke/i })).toBeInTheDocument()
  })
})

// ─────────────────────── 2. inline role editing ───────────────────────

describe('JL-417 — inline role editing', () => {
  it('offers a role dropdown for a non-Owner member', async () => {
    await renderLoaded()

    expect(screen.getByLabelText(`Change role for ${MEMBER.name}`)).toBeInTheDocument()
  })

  it('leaves the Owner row static — ownership is a flag, not an assignable role', async () => {
    await renderLoaded()

    expect(screen.queryByLabelText(`Change role for ${OWNER.name}`)).not.toBeInTheDocument()
    expect(within(rowFor(OWNER.name)).getByText('Admin')).toBeInTheDocument()
  })

  it('PATCHes the new role and refreshes the list', async () => {
    await renderLoaded()

    await selectRole(MEMBER.name, 'Admin')

    await waitFor(() => expect(updateMemberRole).toHaveBeenCalledWith(MEMBER.id, 'Admin'))
    // Two calls: the initial load and the post-change refresh.
    await waitFor(() => expect(fetchMembers).toHaveBeenCalledTimes(2))
  })

  it('does not call the API when the role is unchanged', async () => {
    await renderLoaded()

    // Re-picking the value the row already has must not issue a PATCH.
    await selectRole(MEMBER.name, MEMBER.role)

    expect(updateMemberRole).not.toHaveBeenCalled()
  })

  it('surfaces a server rejection instead of silently reverting', async () => {
    // The last-Admin rule lives on the server; the UI must show its refusal
    // rather than re-implement the check.
    updateMemberRole.mockRejectedValue(new Error('Cannot demote the last Admin'))
    await renderLoaded()

    await selectRole(ADMIN.name, 'Viewer')

    expect(await screen.findByText(/Cannot demote the last Admin/i)).toBeInTheDocument()
  })
})

// ─────────────────── 3. status pills and the Actions cell ───────────────────

describe('JL-417 — Active, Invited and Deactivated are distinguishable', () => {
  it('gives each status its own pill class', async () => {
    await renderLoaded()
    await showAllStatuses()

    expect(within(rowFor(MEMBER.name)).getByText('Active')).toHaveClass('pill-green')
    expect(within(rowFor(INVITED.name)).getByText('Invited')).toHaveClass('pill-yellow')
    expect(within(rowFor(OFF.name)).getByText('Deactivated')).toHaveClass('pill-red')
  })

  it('never prints the word "Active" on a Deactivated row', async () => {
    await renderLoaded()
    await showAllStatuses()

    const row = rowFor(OFF.name)
    // The Status cell legitimately says "Deactivated"; nothing in the row may
    // claim the member is Active.
    expect(within(row).queryByText('Active')).not.toBeInTheDocument()
    expect(within(row).getByText('Deactivated')).toBeInTheDocument()
  })

  it('offers Deactivate on an active member and Reactivate on a deactivated one', async () => {
    await renderLoaded()
    await showAllStatuses()

    expect(screen.getByLabelText(`Deactivate ${MEMBER.name}`)).toBeInTheDocument()
    expect(screen.getByLabelText(`Reactivate ${OFF.name}`)).toBeInTheDocument()
  })

  it('offers neither on the Owner row', async () => {
    await renderLoaded()

    expect(screen.queryByLabelText(`Deactivate ${OWNER.name}`)).not.toBeInTheDocument()
  })

  it('shows Resend, not Deactivate, on an Invited row', async () => {
    await renderLoaded()
    await showAllStatuses()

    const row = rowFor(INVITED.name)
    expect(within(row).getByRole('button', { name: /Resend Invite/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(`Deactivate ${INVITED.name}`)).not.toBeInTheDocument()
  })

  it('deactivates and refreshes', async () => {
    await renderLoaded()

    fireEvent.click(screen.getByLabelText(`Deactivate ${MEMBER.name}`))

    await waitFor(() => expect(deactivateMember).toHaveBeenCalledWith(MEMBER.id))
    await waitFor(() => expect(fetchMembers).toHaveBeenCalledTimes(2))
  })

  it('reactivates and refreshes', async () => {
    await renderLoaded()
    await showAllStatuses()

    fireEvent.click(screen.getByLabelText(`Reactivate ${OFF.name}`))

    await waitFor(() => expect(reactivateMember).toHaveBeenCalledWith(OFF.id))
    expect(deactivateMember).not.toHaveBeenCalled()
  })

  it('surfaces a failed deactivate', async () => {
    deactivateMember.mockRejectedValue(new Error('Member is protected'))
    await renderLoaded()

    fireEvent.click(screen.getByLabelText(`Deactivate ${MEMBER.name}`))

    expect(await screen.findByText(/Member is protected/i)).toBeInTheDocument()
  })

  it('keeps Delete available alongside Deactivate — they are different operations', async () => {
    await renderLoaded()

    expect(screen.getByLabelText(`Delete ${MEMBER.name}`)).toBeInTheDocument()
    expect(screen.getByLabelText(`Deactivate ${MEMBER.name}`)).toBeInTheDocument()
  })
})

// ─────────────────────── 4. status filter default ───────────────────────

describe('JL-417 — the Status filter defaults to Active', () => {
  it('hides Invited and Deactivated members on first load', async () => {
    await renderLoaded()

    expect(screen.getByText(MEMBER.name)).toBeInTheDocument()
    expect(screen.queryByText(INVITED.name)).not.toBeInTheDocument()
    expect(screen.queryByText(OFF.name)).not.toBeInTheDocument()
  })

  it('shows everyone once the filter is cleared', async () => {
    await renderLoaded()
    await showAllStatuses()

    expect(screen.getByText(INVITED.name)).toBeInTheDocument()
    expect(screen.getByText(OFF.name)).toBeInTheDocument()
  })

  it('reports the filtered count, not the raw total', async () => {
    await renderLoaded()

    // 3 Active of 5 total.
    expect(screen.getByText(/3 of 5 members/i)).toBeInTheDocument()
  })
})

// ─────────────────────── regression guards ───────────────────────

describe('JL-417 — the rest of the page is undisturbed', () => {
  it('keeps the JL-409 plain <h1> page title', async () => {
    await renderLoaded()

    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('Teams')
    expect(h1.tagName).toBe('H1')
  })

  it('keeps the JL-413 Project Creation panel and its shared classes', async () => {
    const { container } = await renderLoaded()

    const panel = screen.getByRole('heading', { name: /Project Creation/i }).closest('article')
    expect(panel).toHaveClass('teams-security-panel')
    expect(container.querySelector('.teams-security-form')).not.toBeNull()
  })

  it('keeps the JL-252 bulk-selection checkboxes', async () => {
    await renderLoaded()

    // Deliberately NOT removed to match Atlassian, which documents no bulk
    // multi-select — ours is the better behaviour here.
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
  })

  it('still surfaces a member load failure rather than an empty state', async () => {
    fetchMembers.mockRejectedValue(new Error('Network down'))
    renderPage()

    await waitFor(() => expect(screen.queryByText(/Loading team members/i)).not.toBeInTheDocument())
    expect(screen.queryByText(/No team members yet/i)).not.toBeInTheDocument()
  })

  it('renders the task count supplied by the server', async () => {
    await renderLoaded()

    // The value is now derived server-side; the page must show what it is given
    // rather than the old always-zero stored column.
    expect(within(rowFor(ADMIN.name)).getByText('7')).toBeInTheDocument()
  })
})
