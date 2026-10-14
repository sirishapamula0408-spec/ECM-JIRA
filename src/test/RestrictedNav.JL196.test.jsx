import { describe, it, expect, vi } from 'vitest'
import { render, screen, renderHook } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/* ================================================================
   JL-196 — a workspace Member or Viewer who is not Admin/Lead of any
   project sees only Dashboard and Projects in the left panel, and the
   other pages redirect to the Dashboard when opened by URL.
   System admins and project admins keep the full navigation.
   ================================================================ */

const { state } = vi.hoisted(() => ({
  state: { currentMember: null, perms: { loaded: true, hasRestrictedNav: false } },
}))

vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({ currentMember: state.currentMember, members: [] }),
}))
vi.mock('../hooks/usePluginContributions', () => ({
  usePluginContributions: () => ({ contributions: [], loading: false }),
}))
vi.mock('../api/projectApi', () => ({ fetchProjects: vi.fn(() => Promise.resolve([])) }))
// JiraLayout's children are not under test here.
vi.mock('../components/layout/ProjectTopPanel', () => ({ ProjectTopPanel: () => null }))

import { usePermissions } from '../hooks/usePermissions'
import { isPathAllowedForRestrictedNav } from '../utils/restrictedNav'

/* ── who is restricted ─────────────────────────────────────────── */

const me = (workspaceRole, projectRoles = [], isOwner = false) => ({
  workspaceRole, isOwner, projectRoles, projectCreationPolicy: 'all_members',
})
const pr = (projectId, role) => ({ projectId, projectKey: `P${projectId}`, projectName: `P${projectId}`, role })

describe('usePermissions().hasRestrictedNav', () => {
  it.each([
    ['a workspace Member in no project', me('Member'), true],
    ['a workspace Member who is a project Member', me('Member', [pr(4, 'Member')]), true],
    ['a workspace Viewer who is a project Viewer', me('Viewer', [pr(4, 'Viewer')]), true],
    ['a workspace Member who is a project Admin', me('Member', [pr(4, 'Admin')]), false],
    ['a workspace Viewer who leads a project', me('Viewer', [pr(4, 'Lead')]), false],
    ['a system admin', me('Admin'), false],
    ['the workspace Owner', me('Admin', [], true), false],
  ])('%s → %s', (_label, member, expected) => {
    state.currentMember = member
    const { result } = renderHook(() => usePermissions())
    expect(result.current.hasRestrictedNav).toBe(expected)
  })

  it('is false until the user has loaded, so nothing is decided early', () => {
    state.currentMember = null
    const { result } = renderHook(() => usePermissions())
    expect(result.current.loaded).toBe(false)
    expect(result.current.hasRestrictedNav).toBe(false)
  })
})

/* ── which pages stay reachable ────────────────────────────────── */

describe('isPathAllowedForRestrictedNav', () => {
  it.each([
    '/', '/dashboard', '/projects', '/projects/4', '/projects/4/backlog', '/projects/4/board',
    '/projects/4/settings', '/projects/4/list', '/issues/OICL-11', '/browse/OICL-11', '/profile',
  ])('allows %s', (path) => {
    expect(isPathAllowedForRestrictedNav(path)).toBe(true)
  })

  it.each([
    '/teams', '/teams/3', '/workflow-editor', '/activity', '/audit-log', '/filters', '/portfolio',
    '/report-builder', '/advanced-roadmap', '/shared-dashboards', '/cross-project-boards', '/members',
    '/users', '/webhooks', '/automation', '/backlog', '/board', '/reports', '/list',
  ])('blocks %s', (path) => {
    expect(isPathAllowedForRestrictedNav(path)).toBe(false)
  })
})

/* ── the left panel ────────────────────────────────────────────── */

describe('Sidebar', () => {
  async function renderSidebar(member) {
    state.currentMember = member
    const { Sidebar } = await import('../components/layout/Sidebar')
    return render(
      <MemoryRouter>
        <Sidebar collapsed={false} onCreateProject={() => {}} projectRefreshKey={0} hasProjects />
      </MemoryRouter>,
    )
  }
  const HIDDEN = ['Teams', 'Workflows', 'Activity', 'Audit Log', 'Filters', 'Portfolio', 'Report Builder']

  it('shows only Dashboard and Projects to a restricted Member', async () => {
    await renderSidebar(me('Member', [pr(4, 'Member')]))
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Dashboards' })).toHaveAttribute('href', '/dashboard')
    for (const label of HIDDEN) expect(screen.queryByText(label)).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Workspace tools' })).not.toBeInTheDocument()
  })

  it('keeps the full panel for a project admin', async () => {
    await renderSidebar(me('Member', [pr(4, 'Admin')]))
    for (const label of ['Projects', 'Dashboards', ...HIDDEN]) expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('keeps the full panel, plus Members and Users, for a system admin', async () => {
    await renderSidebar(me('Admin'))
    for (const label of ['Projects', 'Dashboards', 'Members', 'Users', ...HIDDEN]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })
})

/* ── the URL guard ─────────────────────────────────────────────── */

describe('JiraLayout route guard', () => {
  async function renderAt(path, member) {
    state.currentMember = member
    const { JiraLayout } = await import('../components/layout/JiraLayout')
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<JiraLayout collapsed={false} hasProjects loading={false} error="" />}>
            <Route path="/" element={<h1>Dashboard page</h1>} />
            <Route path="/teams" element={<h1>Teams page</h1>} />
            <Route path="/audit-log" element={<h1>Audit page</h1>} />
            <Route path="/projects/:projectId/backlog" element={<h1>Backlog page</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
  }

  it('sends a restricted Member who types a hidden page’s URL to the Dashboard', async () => {
    await renderAt('/teams', me('Member', [pr(4, 'Member')]))
    expect(await screen.findByRole('heading', { name: 'Dashboard page' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Teams page' })).not.toBeInTheDocument()
  })

  it('lets a restricted Member into their project pages', async () => {
    await renderAt('/projects/4/backlog', me('Viewer', [pr(4, 'Viewer')]))
    expect(await screen.findByRole('heading', { name: 'Backlog page' })).toBeInTheDocument()
  })

  it.each([
    ['a project lead', me('Member', [pr(4, 'Lead')])],
    ['a system admin', me('Admin')],
  ])('does not block %s', async (_label, member) => {
    await renderAt('/audit-log', member)
    expect(await screen.findByRole('heading', { name: 'Audit page' })).toBeInTheDocument()
  })

  it('does not redirect before permissions load (no bounce on refresh)', async () => {
    await renderAt('/teams', null)
    expect(await screen.findByRole('heading', { name: 'Teams page' })).toBeInTheDocument()
  })
})
