// JL-421 / JL-430 / JL-431 — the team directory.
//
// Note the distinction this whole epic turns on: this page lists Atlassian-style
// TEAMS. `/teams` (TeamsPage) is the workspace member directory and is a
// different thing entirely — JL-419 exists because they were conflated.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { TeamDirectoryPage } from '../pages/TeamDirectoryPage/TeamDirectoryPage'
import { fetchTeams, createTeam } from '../api/teamApi'

vi.mock('../api/teamApi', () => ({
  fetchTeams: vi.fn(),
  createTeam: vi.fn(),
}))

const TEAMS = [
  { id: 1, name: 'Platform', description: 'Runs the platform', membership: 'OPEN', memberCount: 4, avatarUrl: null },
  { id: 2, name: 'Growth', description: null, membership: 'MEMBER_INVITE', memberCount: 1, avatarUrl: null },
]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/teams']}>
      <TeamDirectoryPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchTeams.mockResolvedValue([])
})

describe('JL-430 — page shell and cards', () => {
  it('renders exactly one plain <h1> as the page title', async () => {
    fetchTeams.mockResolvedValue(TEAMS)
    const { container } = renderPage()
    await screen.findByText('Platform')
    const h1s = container.querySelectorAll('h1')
    expect(h1s).toHaveLength(1)
    expect(h1s[0].textContent).toBe('Teams')
  })

  it('renders a card per team with name, description and member count', async () => {
    fetchTeams.mockResolvedValue(TEAMS)
    renderPage()
    expect(await screen.findByText('Platform')).toBeInTheDocument()
    expect(screen.getByText('Runs the platform')).toBeInTheDocument()
    expect(screen.getByText('4 members')).toBeInTheDocument()
    // Singular, not "1 members".
    expect(screen.getByText('1 member')).toBeInTheDocument()
  })

  it('makes each card a real link to the team profile — not a click handler on a div', async () => {
    fetchTeams.mockResolvedValue(TEAMS)
    renderPage()
    await screen.findByText('Platform')
    const links = screen.getAllByRole('link')
    // role=link means it is keyboard reachable and announces correctly (AC#5).
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/teams/1', '/teams/2'])
  })

  it('renders the empty state, with the create action, when there are no teams', async () => {
    fetchTeams.mockResolvedValue([])
    renderPage()
    const empty = await screen.findByRole('status')
    expect(within(empty).getByText('No teams yet')).toBeInTheDocument()
    expect(within(empty).getByRole('button', { name: /create team/i })).toBeInTheDocument()
  })

  it('says so when a search matches nothing, rather than showing the generic empty state', async () => {
    fetchTeams.mockResolvedValue([])
    renderPage()
    await screen.findByRole('status')
    fireEvent.change(screen.getByLabelText(/search teams by name/i), { target: { value: 'zzz' } })
    expect(await screen.findByText(/no teams match that search/i)).toBeInTheDocument()
  })
})

describe('JL-431 — search', () => {
  it('sends the query to the server rather than filtering a downloaded list', async () => {
    fetchTeams.mockResolvedValue(TEAMS)
    renderPage()
    await screen.findByText('Platform')

    fetchTeams.mockResolvedValue([TEAMS[1]])
    fireEvent.change(screen.getByLabelText(/search teams by name/i), { target: { value: 'grow' } })

    // The point of the assertion: 'grow' reaches the API. A client-side filter
    // would leave fetchTeams called only with undefined.
    await waitFor(() => expect(fetchTeams).toHaveBeenCalledWith('grow'))
    await waitFor(() => expect(screen.queryByText('Platform')).not.toBeInTheDocument())
    expect(screen.getByText('Growth')).toBeInTheDocument()
  })

  it('debounces — typing three characters does not fire three requests', async () => {
    fetchTeams.mockResolvedValue(TEAMS)
    renderPage()
    await screen.findByText('Platform')
    fetchTeams.mockClear()

    const input = screen.getByLabelText(/search teams by name/i)
    fireEvent.change(input, { target: { value: 'p' } })
    fireEvent.change(input, { target: { value: 'pl' } })
    fireEvent.change(input, { target: { value: 'pla' } })

    await waitFor(() => expect(fetchTeams).toHaveBeenCalledWith('pla'))
    expect(fetchTeams).toHaveBeenCalledTimes(1)
  })
})

describe('JL-431 — create team', () => {
  async function openDialog() {
    fetchTeams.mockResolvedValue(TEAMS)
    renderPage()
    await screen.findByText('Platform')
    fireEvent.click(screen.getAllByRole('button', { name: /create team/i })[0])
    return screen.findByRole('dialog')
  }

  it('creates a team and shows it without a manual reload', async () => {
    const dialog = await openDialog()
    createTeam.mockResolvedValue({
      id: 9, name: 'Payments', description: '', membership: 'OPEN', memberCount: 1,
    })
    fetchTeams.mockResolvedValue([...TEAMS, { id: 9, name: 'Payments', description: '', membership: 'OPEN', memberCount: 1 }])

    fireEvent.change(within(dialog).getByLabelText(/team name/i), { target: { value: 'Payments' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(createTeam).toHaveBeenCalledWith({
      name: 'Payments', description: '', membership: 'OPEN',
    }))
    expect(await screen.findByText('Payments')).toBeInTheDocument()
  })

  it('rejects a missing name with a visible message and never calls the API', async () => {
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: /^create$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/team name is required/i)
    expect(createTeam).not.toHaveBeenCalled()
  })

  it('surfaces the server rejection instead of swallowing it', async () => {
    const dialog = await openDialog()
    createTeam.mockRejectedValue(new Error('Team name must be 120 characters or fewer'))
    fireEvent.change(within(dialog).getByLabelText(/team name/i), { target: { value: 'x' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /^create$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/120 characters or fewer/i)
  })

  it('offers both membership modes and explains what each one means', async () => {
    const dialog = await openDialog()
    // The enum values alone ("OPEN" / "MEMBER_INVITE") tell a first-time reader
    // nothing, so the labels carry the meaning (JL-431).
    fireEvent.mouseDown(within(dialog).getByLabelText(/who can join/i))
    const options = await screen.findAllByRole('option')
    const labels = options.map((o) => o.textContent)
    expect(labels.some((l) => /anyone in the workspace can join/i.test(l))).toBe(true)
    expect(labels.some((l) => /a team lead adds people/i.test(l))).toBe(true)
  })

  it('renders the create form inside a real dialog (focus trap, Escape-to-close)', async () => {
    // MUI Dialog provides the semantics JL-367 had to retrofit onto hand-rolled
    // overlays. Asserting role=dialog is what proves we used it.
    const dialog = await openDialog()
    expect(dialog).toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('JL-421 — workspace isolation', () => {
  it('renders exactly what the (workspace-scoped) endpoint returns, and nothing more', async () => {
    // Scoping itself is enforced and tested server-side (JL-427): the API filters
    // by req.workspaceId and 404s a foreign team. The client's obligation is not
    // to invent rows the server did not send — so an empty response must render
    // the empty state, not a stale or merged list.
    fetchTeams.mockResolvedValue(TEAMS)
    const { rerender } = renderPage()
    await screen.findByText('Platform')

    fetchTeams.mockResolvedValue([])
    rerender(
      <MemoryRouter initialEntries={['/teams?w=2']}>
        <TeamDirectoryPage key="other-workspace" />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.queryByText('Platform')).not.toBeInTheDocument())
    expect(await screen.findByText('No teams yet')).toBeInTheDocument()
  })
})
