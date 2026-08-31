// JL-413 — the Security Policy panel is gone from the Teams page.
//
// JL-134 put an org-wide security policy form on /teams: require-MFA, minimum
// password length, uppercase/number/symbol requirements and password rotation.
// JL-413 removes that admin form. This is a UI-only removal: the backend route,
// the passwordPolicy service, the security_policies table and every enforcement
// call site stay exactly as they were, so the stored policy is still applied at
// login, signup, password change and invitation acceptance.
//
// The two things worth guarding are therefore:
//   1. the panel is really gone, for every role, and the page no longer talks
//      to /api/security-policy at all; and
//   2. the removal did not take the Project Creation panel with it — that panel
//      sits immediately above and SHARES the .teams-security-panel and
//      .teams-security-form class names, which makes it the obvious casualty of
//      a careless cleanup.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

// ── Mock the API layer TeamsPage talks to ──
vi.mock('../api/memberApi', () => ({
  fetchMembers: vi.fn(),
  fetchInvitations: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  inviteMember: vi.fn(),
  resendMemberInvite: vi.fn(),
  updateProfile: vi.fn(),
}))
vi.mock('../api/workspaceApi', () => ({
  fetchWorkspaceSettings: vi.fn(() => Promise.resolve({})),
  updateProjectCreationPolicy: vi.fn(),
}))

// Deliberately NOT mocking ../api/securityPolicyApi. If TeamsPage still imported
// it, the module would load for real and its fetch would escape into the test —
// so the absence of a mock here is itself part of the assertion.

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}))

import { TeamsPage } from '../pages/TeamsPage/TeamsPage'
import { MemberProvider } from '../context/MemberProvider'
import { usePermissions } from '../hooks/usePermissions'
import { fetchMembers, fetchInvitations } from '../api/memberApi'
import { fetchWorkspaceSettings } from '../api/workspaceApi'

const MEMBERS = [
  { id: 1, name: 'Ada Lovelace', email: 'ada@example.com', role: 'Admin', status: 'Active' },
  { id: 2, name: 'Grace Hopper', email: 'grace@example.com', role: 'Member', status: 'Active' },
]

function renderPage() {
  return render(
    <BrowserRouter>
      <MemberProvider>
        <TeamsPage />
      </MemberProvider>
    </BrowserRouter>,
  )
}

/** Wait for the page to settle past its loading state. */
async function renderLoaded() {
  renderPage()
  await waitFor(() => expect(screen.queryByText(/Loading team members/i)).not.toBeInTheDocument())
}

beforeEach(() => {
  vi.clearAllMocks()
  usePermissions.mockReturnValue({ canInviteMembers: true, isAdmin: true })
  fetchMembers.mockResolvedValue(MEMBERS)
  fetchInvitations.mockResolvedValue([])
  fetchWorkspaceSettings.mockResolvedValue({ project_creation_policy: 'all_members' })
})

// ───────────────────────── the panel is gone ─────────────────────────

describe('JL-413 — Security Policy panel removed from the Teams page', () => {
  it('does not render the Security Policy heading for an admin', async () => {
    await renderLoaded()

    // An admin is the role that used to see it, so this is the meaningful case.
    expect(screen.queryByRole('heading', { name: /Security Policy/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/Security Policy/i)).not.toBeInTheDocument()
  })

  it('does not render any of the policy controls', async () => {
    await renderLoaded()

    expect(screen.queryByLabelText(/two-factor authentication/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Require all users to enable two-factor/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Minimum password length/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Require at least one uppercase letter/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Require at least one number/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Require at least one symbol/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Password rotation/i)).not.toBeInTheDocument()
  })

  it('has no "Save Policy" button', async () => {
    await renderLoaded()

    expect(screen.queryByRole('button', { name: /Save Policy/i })).not.toBeInTheDocument()
  })

  it('leaves no policy checkbox behind, while keeping the member-selection ones', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(screen.queryByText(/Loading team members/i)).not.toBeInTheDocument())

    // .teams-security-check was the class the four policy checkboxes used; its
    // CSS is deleted, so any surviving element would now be unstyled too.
    expect(container.querySelectorAll('.teams-security-check')).toHaveLength(0)
    // Nothing checkbox-shaped may remain inside the shared form wrapper.
    expect(container.querySelectorAll('.teams-security-form input[type="checkbox"]')).toHaveLength(0)

    // The row-selection checkboxes from JL-252 belong to the members table and
    // must survive — asserting "no checkboxes at all" would wrongly pass if the
    // bulk-delete feature broke.
    const remaining = screen.queryAllByRole('checkbox')
    expect(remaining.length).toBeGreaterThan(0)
    remaining.forEach((box) => expect(box.closest('.teams-security-form')).toBeNull())
  })

  it('is gone for a non-admin too, who never saw it', async () => {
    usePermissions.mockReturnValue({ canInviteMembers: false, isAdmin: false })
    await renderLoaded()

    expect(screen.queryByText(/Security Policy/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save Policy/i })).not.toBeInTheDocument()
  })
})

// ───────────────── the page no longer calls the endpoint ─────────────────

describe('JL-413 — the Teams page no longer talks to /api/security-policy', () => {
  it('issues no request to the security-policy endpoint while rendering', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    })

    await renderLoaded()

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('security-policy'))).toBe(false)

    fetchSpy.mockRestore()
  })

  it('renders fully without the securityPolicyApi module being mocked', async () => {
    // This file never mocks ../api/securityPolicyApi. If TeamsPage still
    // imported it, the real module would be pulled in and its unmocked network
    // call would surface here rather than in production.
    await renderLoaded()

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
  })
})

// ───────────── the neighbouring panel survived the removal ─────────────

describe('JL-413 — Project Creation panel is unaffected', () => {
  it('still renders for an admin, sharing the class names the removed panel used', async () => {
    await renderLoaded()

    expect(screen.getByRole('heading', { name: /Project Creation/i })).toBeInTheDocument()
    expect(screen.getByText(/Who can create projects/i)).toBeInTheDocument()
  })

  it('keeps its select and both options', async () => {
    await renderLoaded()

    // Scope to the panel: the members table has its own role/status filter
    // dropdowns, so a bare getByRole('combobox') matches several.
    const panel = screen.getByRole('heading', { name: /Project Creation/i }).closest('article')
    const select = within(panel).getByRole('combobox')
    expect(within(select).getByRole('option', { name: /All members/i })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: /Admins only/i })).toBeInTheDocument()
  })

  it('keeps its own Save button, which is NOT the removed "Save Policy" one', async () => {
    await renderLoaded()

    const save = screen.getByRole('button', { name: /^Save$/i })
    expect(save).toBeInTheDocument()
    expect(save).toHaveAttribute('type', 'submit')
  })

  it('still applies the shared layout classes, so trimming the CSS did not orphan it', async () => {
    await renderLoaded()

    const heading = screen.getByRole('heading', { name: /Project Creation/i })
    const panel = heading.closest('article')
    expect(panel).toHaveClass('teams-security-panel')
    expect(panel.querySelector('.teams-security-form')).not.toBeNull()
  })

  it('is hidden from a non-admin, exactly as before', async () => {
    usePermissions.mockReturnValue({ canInviteMembers: false, isAdmin: false })
    await renderLoaded()

    expect(screen.queryByRole('heading', { name: /Project Creation/i })).not.toBeInTheDocument()
  })
})

// ───────────────────── the rest of the page still works ─────────────────────

describe('JL-413 — the removal did not disturb the rest of the Teams page', () => {
  it('still lists team members', async () => {
    await renderLoaded()

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
  })

  it('still surfaces a member load failure rather than swallowing it', async () => {
    fetchMembers.mockRejectedValue(new Error('Network down'))
    renderPage()

    // The removed panel used to swallow its own load errors; that must not have
    // leaked into how the page reports a genuine members failure.
    await waitFor(() => expect(screen.queryByText(/Loading team members/i)).not.toBeInTheDocument())
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()
  })

  it('renders without crashing when the workspace settings call fails', async () => {
    // The Project Creation panel is the remaining consumer of that call; a
    // failure there must not take the page down now that its neighbour is gone.
    fetchWorkspaceSettings.mockRejectedValue(new Error('settings unavailable'))
    await renderLoaded()

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
  })
})
