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
import { SidebarNavIcon } from '../components/icons/SidebarNavIcon'

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

describe('JL-278 distinct sidebar icons for Activity and Audit Log', () => {
  it('renders different icons for the Activity and Audit Log nav items', () => {
    renderSidebar()
    const activitySvg = screen.getByRole('link', { name: 'Activity' }).querySelector('svg')
    const auditSvg = screen.getByRole('link', { name: 'Audit Log' }).querySelector('svg')

    expect(activitySvg).not.toBeNull()
    expect(auditSvg).not.toBeNull()

    // Distinct named glyphs — no longer both the 'recent' clock
    expect(activitySvg.getAttribute('data-icon')).toBe('activity')
    expect(auditSvg.getAttribute('data-icon')).toBe('audit')
    expect(activitySvg.getAttribute('data-icon')).not.toBe(auditSvg.getAttribute('data-icon'))

    // The rendered svg markup itself differs (different paths)
    expect(activitySvg.innerHTML).not.toBe(auditSvg.innerHTML)
  })

  it('neither Activity nor Audit Log reuses the recent clock glyph', () => {
    renderSidebar()
    const { container } = render(<SidebarNavIcon name="recent" />)
    const clockPath = container.querySelector('svg[data-icon="recent"] path').getAttribute('d')

    const activitySvg = screen.getByRole('link', { name: 'Activity' }).querySelector('svg')
    const auditSvg = screen.getByRole('link', { name: 'Audit Log' }).querySelector('svg')
    const activityPaths = [...activitySvg.querySelectorAll('path')].map((p) => p.getAttribute('d'))
    const auditPaths = [...auditSvg.querySelectorAll('path')].map((p) => p.getAttribute('d'))

    expect(activityPaths).not.toContain(clockPath)
    expect(auditPaths).not.toContain(clockPath)
  })

  it('SidebarNavIcon exposes distinct glyphs for activity and audit names', () => {
    const { container: a } = render(<SidebarNavIcon name="activity" />)
    const { container: b } = render(<SidebarNavIcon name="audit" />)
    const activitySvg = a.querySelector('svg')
    const auditSvg = b.querySelector('svg')

    expect(activitySvg.getAttribute('data-icon')).toBe('activity')
    expect(auditSvg.getAttribute('data-icon')).toBe('audit')
    expect(activitySvg.innerHTML).not.toBe(auditSvg.innerHTML)
    // Not the unnamed fallback circle either
    expect(activitySvg.querySelector('circle')).toBeNull()
  })
})
