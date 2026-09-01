// JL-422 / JL-432 / JL-433 / JL-434 — the team profile page.
//
// NOTE ON WHAT THESE TESTS DO NOT PROVE: jsdom applies no stylesheets, so
// nothing here says anything about how the page looks. Every assertion is about
// structure, semantics and behaviour.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

import { TeamProfilePage } from '../pages/TeamProfilePage/TeamProfilePage'
import {
  fetchTeam, updateTeam, addTeamMember, removeTeamMember, updateTeamMemberRole,
  addTeamLink, removeTeamLink,
} from '../api/teamApi'
import { fetchMembers } from '../api/memberApi'

vi.mock('../api/teamApi', () => ({
  fetchTeam: vi.fn(),
  updateTeam: vi.fn(),
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
  updateTeamMemberRole: vi.fn(),
  addTeamLink: vi.fn(),
  removeTeamLink: vi.fn(),
  uploadTeamAvatar: vi.fn(),
}))

vi.mock('../api/memberApi', () => ({ fetchMembers: vi.fn() }))

// The page reads only `currentMember` off the member context; a mutable holder
// keeps each test's identity local instead of threading a provider through.
let currentMember = null
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({ currentMember }),
}))

const LEAD = { memberId: 1, role: 'Lead', name: 'Ada Lead', email: 'ada@test.com' }
const PLAIN = { memberId: 2, role: 'Member', name: 'Bo Member', email: 'bo@test.com' }

function team(overrides = {}) {
  return {
    id: 7,
    name: 'Platform',
    description: 'Runs the platform',
    avatarUrl: null,
    membership: 'OPEN',
    memberCount: 2,
    members: [LEAD, PLAIN],
    links: [],
    viewerRole: null,
    canManage: false,
    ...overrides,
  }
}

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={['/teams/7']}>
      <Routes>
        <Route path="/teams/:teamId" element={<TeamProfilePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  currentMember = { memberId: 2, workspaceRole: 'Member', isOwner: false }
  fetchMembers.mockResolvedValue([
    { id: 1, name: 'Ada Lead', email: 'ada@test.com' },
    { id: 2, name: 'Bo Member', email: 'bo@test.com' },
    { id: 3, name: 'Cy Outsider', email: 'cy@test.com' },
  ])
})

describe('JL-432 — header', () => {
  it('renders the name, description, member count and a single plain <h1>', async () => {
    fetchTeam.mockResolvedValue(team())
    const { container } = renderProfile()
    expect(await screen.findByText('Runs the platform')).toBeInTheDocument()
    const h1s = container.querySelectorAll('h1')
    expect(h1s).toHaveLength(1)
    expect(h1s[0].textContent).toBe('Platform')
    expect(screen.getByText(/2 members/)).toBeInTheDocument()
  })

  it('renders a not-found state for an unknown team instead of crashing (AC#6)', async () => {
    fetchTeam.mockRejectedValue(Object.assign(new Error('Team not found'), { status: 404 }))
    const { container } = renderProfile()
    expect(await screen.findByText(/could not find that team/i)).toBeInTheDocument()
    expect(container.querySelectorAll('h1')).toHaveLength(1)
  })
})

describe('JL-432 — Join / Leave follows the membership mode', () => {
  it('OPEN: a non-member sees Join, and joining calls the API', async () => {
    currentMember = { memberId: 3, workspaceRole: 'Member', isOwner: false }
    fetchTeam.mockResolvedValue(team({ membership: 'OPEN' }))
    addTeamMember.mockResolvedValue([])
    renderProfile()
    const join = await screen.findByRole('button', { name: /join team/i })
    fireEvent.click(join)
    await waitFor(() => expect(addTeamMember).toHaveBeenCalledWith('7', 3, 'Member'))
  })

  it('MEMBER_INVITE: no Join button is offered at all', async () => {
    currentMember = { memberId: 3, workspaceRole: 'Member', isOwner: false }
    fetchTeam.mockResolvedValue(team({ membership: 'MEMBER_INVITE' }))
    renderProfile()
    await screen.findByText('Platform')
    // Rendering a button the server would always refuse is the thing the ticket
    // says not to do.
    expect(screen.queryByRole('button', { name: /join team/i })).not.toBeInTheDocument()
    expect(screen.getByText(/invite only/i)).toBeInTheDocument()
  })

  it('an existing member sees Leave, and leaving calls the API', async () => {
    fetchTeam.mockResolvedValue(team())
    removeTeamMember.mockResolvedValue([])
    renderProfile()
    fireEvent.click(await screen.findByRole('button', { name: /leave team/i }))
    await waitFor(() => expect(removeTeamMember).toHaveBeenCalledWith('7', 2))
  })
})

describe('JL-422 — permission paths', () => {
  it('a plain member gets a read-only page: no edit, no role selects, no add/remove', async () => {
    fetchTeam.mockResolvedValue(team({ canManage: false, viewerRole: 'Member' }))
    renderProfile()
    await screen.findByText('Platform')
    expect(screen.queryByRole('button', { name: /edit team/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/team role for/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add member/i })).not.toBeInTheDocument()
    // Roles are still visible, just not editable.
    expect(screen.getAllByText('Lead').length).toBeGreaterThan(0)
  })

  it('a team Lead gets the edit controls', async () => {
    currentMember = { memberId: 1, workspaceRole: 'Member', isOwner: false }
    fetchTeam.mockResolvedValue(team({ canManage: true, viewerRole: 'Lead' }))
    renderProfile()
    expect(await screen.findByRole('button', { name: /edit team/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/team role for Ada Lead/i)).toBeInTheDocument()
  })

  it('a workspace Admin who is not on the team also gets them', async () => {
    currentMember = { memberId: 99, workspaceRole: 'Admin', isOwner: false }
    fetchTeam.mockResolvedValue(team({ canManage: true, viewerRole: null }))
    renderProfile()
    expect(await screen.findByRole('button', { name: /edit team/i })).toBeInTheDocument()
  })

  it('saving the edit dialog PATCHes the team', async () => {
    currentMember = { memberId: 1, workspaceRole: 'Member', isOwner: false }
    fetchTeam.mockResolvedValue(team({ canManage: true, viewerRole: 'Lead' }))
    updateTeam.mockResolvedValue({})
    renderProfile()
    fireEvent.click(await screen.findByRole('button', { name: /edit team/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/team name/i), { target: { value: 'Platform Core' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }))
    await waitFor(() => expect(updateTeam).toHaveBeenCalledWith('7', expect.objectContaining({ name: 'Platform Core' })))
  })
})

describe('JL-433 — members section', () => {
  it('lists every member with their role', async () => {
    fetchTeam.mockResolvedValue(team())
    renderProfile()
    expect(await screen.findByText('Ada Lead')).toBeInTheDocument()
    expect(screen.getByText('Bo Member')).toBeInTheDocument()
    expect(screen.getByText('ada@test.com')).toBeInTheDocument()
  })

  it('lets a Lead change a role through an aria-labelled select', async () => {
    currentMember = { memberId: 1, workspaceRole: 'Member', isOwner: false }
    fetchTeam.mockResolvedValue(team({ canManage: true, viewerRole: 'Lead' }))
    updateTeamMemberRole.mockResolvedValue([])
    renderProfile()
    const select = await screen.findByLabelText(/team role for Bo Member/i)
    fireEvent.mouseDown(select)
    fireEvent.click(await screen.findByRole('option', { name: 'Lead' }))
    await waitFor(() => expect(updateTeamMemberRole).toHaveBeenCalledWith('7', 2, 'Lead'))
  })

  it('offers only workspace members who are not already on the team', async () => {
    currentMember = { memberId: 1, workspaceRole: 'Member', isOwner: false }
    fetchTeam.mockResolvedValue(team({ canManage: true, viewerRole: 'Lead' }))
    renderProfile()
    const picker = await screen.findByLabelText(/add a workspace member/i)
    fireEvent.mouseDown(picker)
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(options.some((o) => /Cy Outsider/.test(o))).toBe(true)
    expect(options.some((o) => /Ada Lead/.test(o))).toBe(false)
  })

  it('shows the last-Lead refusal rather than appearing to succeed', async () => {
    // JL-428 decided this is REFUSED with a 409. JL-433 says the UI must
    // communicate the outcome, and the wording is the server's, not a duplicate
    // client-side rule.
    currentMember = { memberId: 1, workspaceRole: 'Admin', isOwner: false }
    fetchTeam.mockResolvedValue(team({ canManage: true, viewerRole: 'Lead' }))
    removeTeamMember.mockRejectedValue(new Error('A team must keep at least one Lead. Promote someone else first.'))
    renderProfile()
    await screen.findByText('Ada Lead')
    fireEvent.click(screen.getByRole('button', { name: /remove Ada Lead from the team/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one Lead/i)
  })
})

describe('JL-434 — links, the cap and URL sanitisation', () => {
  const link = (id, label, url) => ({ id, teamId: 7, label, url })

  it('renders a safe link as an anchor carrying rel="noopener noreferrer"', async () => {
    fetchTeam.mockResolvedValue(team({ links: [link(1, 'Docs', 'https://example.com/docs')] }))
    renderProfile()
    const anchor = await screen.findByRole('link', { name: 'Docs' })
    expect(anchor).toHaveAttribute('href', 'https://example.com/docs')
    expect(anchor.getAttribute('rel')).toContain('noopener')
    expect(anchor.getAttribute('rel')).toContain('noreferrer')
  })

  it.each([
    ['javascript:alert(1)'],
    ['JavaScript:alert(1)'],
    ['java\tscript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox(1)'],
    ['//evil.example.com/x'],
  ])('neutralises %s — never rendered as an href', async (url) => {
    // Stored XSS aimed at everyone who views the team. The check is the shared
    // src/utils/sanitizeHtml.js allow-list (JL-368 + JL-358), not a local regex.
    fetchTeam.mockResolvedValue(team({ links: [link(1, 'Bad', url)] }))
    const { container } = renderProfile()
    await screen.findByText(/blocked link/i)
    expect(screen.queryByRole('link', { name: 'Bad' })).not.toBeInTheDocument()
    for (const a of container.querySelectorAll('a')) {
      expect(a.getAttribute('href')).not.toBe(url)
    }
  })

  it('adds a link as a Lead', async () => {
    currentMember = { memberId: 1, workspaceRole: 'Member', isOwner: false }
    fetchTeam.mockResolvedValue(team({ canManage: true, viewerRole: 'Lead' }))
    addTeamLink.mockResolvedValue({})
    renderProfile()
    fireEvent.change(await screen.findByLabelText(/^label$/i), { target: { value: 'Runbook' } })
    fireEvent.change(screen.getByLabelText(/^url$/i), { target: { value: 'https://example.com/run' } })
    fireEvent.click(screen.getByRole('button', { name: /add link/i }))
    await waitFor(() => expect(addTeamLink).toHaveBeenCalledWith('7', {
      label: 'Runbook', url: 'https://example.com/run',
    }))
  })

  it('removes a link as a Lead', async () => {
    currentMember = { memberId: 1, workspaceRole: 'Member', isOwner: false }
    fetchTeam.mockResolvedValue(team({
      canManage: true, viewerRole: 'Lead', links: [link(5, 'Docs', 'https://example.com')],
    }))
    removeTeamLink.mockResolvedValue({})
    renderProfile()
    await screen.findByRole('link', { name: 'Docs' })
    fireEvent.click(screen.getByRole('button', { name: /remove link Docs/i }))
    await waitFor(() => expect(removeTeamLink).toHaveBeenCalledWith('7', 5))
  })

  it('disables Add at the 10-link cap and says why', async () => {
    currentMember = { memberId: 1, workspaceRole: 'Member', isOwner: false }
    const links = Array.from({ length: 10 }, (_, i) => link(i + 1, `L${i}`, `https://example.com/${i}`))
    fetchTeam.mockResolvedValue(team({ canManage: true, viewerRole: 'Lead', links }))
    renderProfile()
    const add = await screen.findByRole('button', { name: /add link/i })
    expect(add).toBeDisabled()
    expect(screen.getByText(/at most 10 links/i)).toBeInTheDocument()
  })

  it('shows how many of the 10 slots are used before the cap is hit', async () => {
    currentMember = { memberId: 1, workspaceRole: 'Member', isOwner: false }
    fetchTeam.mockResolvedValue(team({
      canManage: true, viewerRole: 'Lead', links: [link(1, 'a', 'https://a.test')],
    }))
    renderProfile()
    expect(await screen.findByText(/1 of 10 links used/i)).toBeInTheDocument()
  })

  it('surfaces the server 409 if the cap is hit anyway, rather than swallowing it', async () => {
    currentMember = { memberId: 1, workspaceRole: 'Member', isOwner: false }
    fetchTeam.mockResolvedValue(team({ canManage: true, viewerRole: 'Lead' }))
    addTeamLink.mockRejectedValue(new Error('A team can have at most 10 links. Remove one before adding another.'))
    renderProfile()
    fireEvent.change(await screen.findByLabelText(/^label$/i), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText(/^url$/i), { target: { value: 'https://a.test' } })
    fireEvent.click(screen.getByRole('button', { name: /add link/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/at most 10 links/i)
  })

  it('gives a plain member no add or remove controls for links', async () => {
    fetchTeam.mockResolvedValue(team({ links: [link(1, 'Docs', 'https://a.test')] }))
    renderProfile()
    await screen.findByRole('link', { name: 'Docs' })
    expect(screen.queryByRole('button', { name: /add link/i })).not.toBeInTheDocument()
  })
})

describe('JL-422 — the "Worked on" region is reserved for JL-423', () => {
  it('renders the placeholder section', async () => {
    fetchTeam.mockResolvedValue(team())
    renderProfile()
    expect(await screen.findByRole('heading', { name: /worked on/i })).toBeInTheDocument()
  })
})
