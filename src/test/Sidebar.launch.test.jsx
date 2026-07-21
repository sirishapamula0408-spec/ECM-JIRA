import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

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
      'Dashboards',
      'Portfolio',
      'Report Builder',
      'Advanced Roadmap',
      'Shared Dashboards',
      'Cross-Project Boards',
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
