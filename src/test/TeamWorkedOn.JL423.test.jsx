// JL-423 — the "Worked on" feed on the team profile.
//
// The server side (the actor join, the tenant scoping, the 100-cap) is proved in
// server/__tests__/team-activity-JL423.test.js. What this file proves is that
// the page asks for the right thing and renders what comes back — including the
// empty case, which is the state most teams will be in on day one.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

import { TeamProfilePage, WORKED_ON_LIMIT } from '../pages/TeamProfilePage/TeamProfilePage'
import { fetchTeam, removeTeamMember } from '../api/teamApi'
import { fetchMembers } from '../api/memberApi'
import { fetchActivity } from '../api/dashboardApi'

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
vi.mock('../api/dashboardApi', () => ({ fetchActivity: vi.fn() }))

let currentMember = null
vi.mock('../context/MemberContext', () => ({ useMembers: () => ({ currentMember }) }))

const TEAM = {
  id: 7,
  name: 'Platform',
  description: 'Runs the platform',
  avatarUrl: null,
  membership: 'OPEN',
  memberCount: 1,
  members: [{ memberId: 2, role: 'Member', name: 'Bo Member', email: 'bo@test.com' }],
  links: [],
  viewerRole: 'Member',
  canManage: false,
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

const feed = (activities) => ({ activities, total: activities.length, hasMore: false, nextCursor: null })

beforeEach(() => {
  vi.clearAllMocks()
  currentMember = { memberId: 2, workspaceRole: 'Member', isOwner: false }
  fetchTeam.mockResolvedValue(TEAM)
  fetchMembers.mockResolvedValue([{ id: 2, name: 'Bo Member', email: 'bo@test.com' }])
  fetchActivity.mockResolvedValue(feed([]))
})

describe('JL-423 — the request', () => {
  it('asks the activity endpoint for this team, capped at 100', async () => {
    renderProfile()
    await waitFor(() => expect(fetchActivity).toHaveBeenCalledWith({ teamId: '7', limit: WORKED_ON_LIMIT }))
    // Atlassian's documented number, and the same cap the server applies.
    expect(WORKED_ON_LIMIT).toBe(100)
  })
})

describe('JL-423 — rendering', () => {
  it('lists the events in the order the server returned them (newest first)', async () => {
    fetchActivity.mockResolvedValue(feed([
      { id: 3, actor: 'Sarah Johnson', action: 'moved APO-1 to DONE', created_at: '2026-08-31T10:00:00.000Z' },
      { id: 2, actor: 'Emily Chen', action: 'commented on SEC-098', created_at: '2026-08-30T10:00:00.000Z' },
      { id: 1, actor: 'Sarah Johnson', action: 'created APO-1', created_at: '2026-08-29T10:00:00.000Z' },
    ]))
    renderProfile()
    const section = (await screen.findByRole('heading', { name: /worked on/i })).closest('section')
    const rows = within(section).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    // The server orders by id DESC; the page must not re-sort it.
    expect(rows[0]).toHaveTextContent('moved APO-1 to DONE')
    expect(rows[2]).toHaveTextContent('created APO-1')
  })

  it('falls back to happened_at for rows written before created_at existed', async () => {
    // Legacy seed rows carry a free-text 'happened_at' and a NULL created_at.
    fetchActivity.mockResolvedValue(feed([
      { id: 1, actor: 'Sarah Johnson', action: 'moved APO-142 to IN PROGRESS', created_at: null, happened_at: '2 minutes ago' },
    ]))
    renderProfile()
    expect(await screen.findByText('2 minutes ago')).toBeInTheDocument()
  })

  it('renders an empty state for a team whose members have done nothing', async () => {
    fetchActivity.mockResolvedValue(feed([]))
    renderProfile()
    const section = (await screen.findByRole('heading', { name: /worked on/i })).closest('section')
    expect(await within(section).findByText('Nothing yet')).toBeInTheDocument()
  })

  it('renders the empty state rather than crashing when the request fails', async () => {
    fetchActivity.mockRejectedValue(new Error('boom'))
    renderProfile()
    expect(await screen.findByText('Nothing yet')).toBeInTheDocument()
  })
})

describe('JL-423 — membership changes are reflected', () => {
  it('refetches the feed after a membership change', async () => {
    // The actor set is resolved server-side per request, so the only thing the
    // page has to get right is asking again once membership has changed.
    renderProfile()
    await waitFor(() => expect(fetchActivity).toHaveBeenCalledTimes(1))

    removeTeamMember.mockResolvedValue([])
    fireEvent.click(await screen.findByRole('button', { name: /leave team/i }))

    await waitFor(() => expect(fetchActivity).toHaveBeenCalledTimes(2))
  })
})
