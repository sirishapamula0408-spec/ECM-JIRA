import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── Sidebar deps ──
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: vi.fn(() => ({
    canCreateProject: true,
    canManageUsers: true,
    canManageMembers: true,
  })),
}))

vi.mock('../hooks/usePluginContributions', () => ({
  usePluginContributions: vi.fn(() => ({ contributions: [], loading: false })),
}))

vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn(() => Promise.resolve([])),
}))

import { Sidebar } from '../components/layout/Sidebar'

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar
        collapsed={false}
        onToggleSidebar={() => {}}
        onCreateProject={() => {}}
        projectRefreshKey={0}
        hasProjects
      />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('JL-277 launch sidebar', () => {
  const LAUNCH_LABELS = ['Filters', 'Teams', 'Users', 'Activity', 'Workflows', 'Audit Log']

  it('shows the six launch nav sections plus Projects', () => {
    renderSidebar()
    LAUNCH_LABELS.forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument()
    })
    // JL-282: Projects is kept in the launch sidebar as the entry point to boards/backlogs.
    expect(screen.getByText('Projects')).toBeInTheDocument()
  })

  it('renders the six launch items as links to their routes', () => {
    renderSidebar()
    expect(screen.getByRole('link', { name: 'Filters' })).toHaveAttribute('href', '/filters')
    expect(screen.getByRole('link', { name: 'Teams' })).toHaveAttribute('href', '/teams')
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/users')
    expect(screen.getByRole('link', { name: 'Activity' })).toHaveAttribute('href', '/activity')
    expect(screen.getByRole('link', { name: 'Workflows' })).toHaveAttribute('href', '/workflow-editor')
    expect(screen.getByRole('link', { name: 'Audit Log' })).toHaveAttribute('href', '/audit-log')
  })

  it('JL-283: shows the Filters-box utility items as links', () => {
    renderSidebar()
    expect(screen.getByRole('link', { name: 'Dashboards' })).toHaveAttribute('href', '/dashboard')
    expect(screen.getByRole('link', { name: 'Portfolio' })).toHaveAttribute('href', '/portfolio')
    expect(screen.getByRole('link', { name: 'Report Builder' })).toHaveAttribute('href', '/report-builder')
  })

  it('JL-403: no longer advertises Advanced Roadmap, Shared Dashboards or Cross-Project Boards', () => {
    // Inverted rather than deleted: this test used to assert all three were
    // present as links. They are HIDDEN from the nav, not removed — the routes,
    // pages and APIs are untouched, so a bookmark still resolves. Restoring one
    // means putting its label back in LAUNCH_NAV.
    renderSidebar()
    for (const label of ['Advanced Roadmap', 'Shared Dashboards', 'Cross-Project Boards']) {
      expect(screen.queryByRole('link', { name: label }), label).toBeNull()
    }
  })

  it('JL-403: hides them via the allow-list, keeping the definitions and routes', () => {
    // The distinction this guards: dropping the labels from LAUNCH_NAV hides
    // them while leaving the path/icon wiring in utilityItems, so flipping
    // LAUNCH_SIDEBAR to false brings the full nav back and restoring a single
    // entry is a one-word edit. Deleting the utilityItems rows would look
    // identical on screen and silently destroy both of those properties.
    const here = path.dirname(fileURLToPath(import.meta.url))
    const sidebar = fs.readFileSync(
      path.join(here, '..', 'components', 'layout', 'Sidebar.jsx'), 'utf8',
    )
    const launchNav = sidebar.match(/const LAUNCH_NAV = \[([^\]]*)\]/)[1]
    const utilityBlock = sidebar.match(/const utilityItems = \[([\s\S]*?)\]/)[1]

    for (const [label, route] of [
      ['Advanced Roadmap', '/advanced-roadmap'],
      ['Shared Dashboards', '/shared-dashboards'],
      ['Cross-Project Boards', '/cross-project-boards'],
    ]) {
      expect(launchNav, `${label} should be out of LAUNCH_NAV`).not.toContain(label)
      expect(utilityBlock, `${label} definition should remain`).toContain(label)
      expect(utilityBlock, `${route} wiring should remain`).toContain(route)
    }

    // And the routes themselves are untouched, so a bookmark still resolves.
    const app = fs.readFileSync(path.join(here, '..', 'App.jsx'), 'utf8')
    for (const route of ['/advanced-roadmap', '/shared-dashboards', '/cross-project-boards']) {
      expect(app, `${route} route should still exist`).toContain(`path="${route}"`)
    }
  })

  it('hides all non-launch nav items', () => {
    renderSidebar()
    const hidden = [
      'Recent',
      'Webhooks',
      'Inbound Email',
      'Automation',
      'Marketplace',
      'Releases',
      'Goals',
      'Assets',
      'Knowledge Base',
      'Help Center',
      'Queues',
      'Incidents',
      'Apps',
      'BI Export',
    ]
    hidden.forEach((label) => {
      expect(screen.queryByText(label)).toBeNull()
    })
  })

  it('renders the Main navigation block for the kept Projects section', () => {
    renderSidebar()
    // JL-282: with Projects kept, the primary nav landmark renders again.
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
    // The "Show Projects" restore button only appears once Projects is hidden via the menu.
    expect(screen.queryByText('Show Projects')).toBeNull()
  })
})
