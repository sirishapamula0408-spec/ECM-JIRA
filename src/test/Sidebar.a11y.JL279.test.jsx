import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/* ================================================================
   JL-279 — Sidebar navigation a11y pass
   (nav landmarks, caret button, disabled-item semantics)
   ================================================================ */

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

function renderSidebar(props = {}) {
  return render(
    <MemoryRouter>
      <Sidebar
        collapsed={false}
        onToggleSidebar={() => {}}
        onCreateProject={() => {}}
        projectRefreshKey={0}
        hasProjects
        {...props}
      />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

describe('JL-279 sidebar a11y', () => {
  it('exposes the sidebar as a navigation landmark, not complementary', () => {
    renderSidebar()
    expect(screen.getByRole('navigation', { name: 'Sidebar' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('every nav landmark has a distinguishing accessible name', () => {
    renderSidebar()
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Workspace tools' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Views and dashboards' })).toBeInTheDocument()
    // No unnamed nav landmarks remain
    screen.getAllByRole('navigation').forEach((nav) => {
      expect(nav).toHaveAccessibleName()
    })
  })

  it('the Projects caret is a real <button> with aria-expanded reflecting state', () => {
    renderSidebar()
    const caret = screen.getByRole('button', { name: 'Expand projects' })
    expect(caret.tagName).toBe('BUTTON')
    expect(caret).toHaveAttribute('aria-expanded', 'false')
    expect(caret).toHaveAttribute('aria-controls', 'sidebar-project-list')

    fireEvent.click(caret)

    const openCaret = screen.getByRole('button', { name: 'Collapse projects' })
    expect(openCaret).toHaveAttribute('aria-expanded', 'true')
    // The controlled project list is now rendered with the matching id
    expect(document.getElementById('sidebar-project-list')).not.toBeNull()
  })

  it('collapse button label toggles between Collapse and Expand sidebar', () => {
    const { unmount } = renderSidebar({ collapsed: false })
    const collapseBtn = screen.getByRole('button', { name: 'Collapse sidebar' })
    expect(collapseBtn).toHaveAttribute('aria-expanded', 'true')
    unmount()

    renderSidebar({ collapsed: true })
    const expandBtn = screen.getByRole('button', { name: 'Expand sidebar' })
    expect(expandBtn).toHaveAttribute('aria-expanded', 'false')
  })

  it('disabled nav items carry aria-disabled="true"', () => {
    renderSidebar({ hasProjects: false })
    // Without project access, Workflows/Filters etc. render as disabled items
    const disabled = document.querySelectorAll('.nav-disabled')
    expect(disabled.length).toBeGreaterThan(0)
    disabled.forEach((el) => {
      expect(el).toHaveAttribute('aria-disabled', 'true')
      expect(el).toHaveAttribute('role', 'link')
    })
    // A disabled item is announced as a disabled link with no navigable href
    const filters = screen.getByRole('link', { name: 'Filters' })
    expect(filters).toHaveAttribute('aria-disabled', 'true')
    expect(filters).not.toHaveAttribute('href')
  })
})
