// JL-192 — the global Projects list (/projects) has no project selected, so it
// must not show the project tab strip or breadcrumb. Every route UNDER it is a
// project page and must keep both — which is why /projects is hidden by exact
// match rather than added to the prefix deny-list.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api/projectApi', () => ({
  fetchProjectById: vi.fn(() => Promise.resolve({ id: 6, name: 'ECM Platform' })),
}))
vi.mock('../context/SprintContext', () => ({ useSprints: () => ({ sprints: [] }) }))

import { fetchProjectById } from '../api/projectApi'
import { ProjectTopPanel } from '../components/layout/ProjectTopPanel'

const renderAt = (pathname) => render(
  <MemoryRouter initialEntries={[pathname]}>
    <ProjectTopPanel hasProjects />
  </MemoryRouter>,
)
const strip = () => screen.queryByRole('navigation', { name: 'Project Views' })
const breadcrumb = () => screen.queryByRole('navigation', { name: 'Breadcrumb' })

describe('JL-192 — no project navigation on the Projects list', () => {
  beforeEach(() => { vi.clearAllMocks() })

  for (const path of ['/projects', '/projects/']) {
    it(`renders nothing at ${path} and fetches no project`, () => {
      const { container } = renderAt(path)
      expect(strip()).toBeNull()
      expect(breadcrumb()).toBeNull()
      expect(screen.queryByRole('link', { name: /summary|backlog|reports|list/i })).toBeNull()
      // Nothing at all is left behind — no wrapper to leave a gap or border.
      expect(container).toBeEmptyDOMElement()
      expect(fetchProjectById).not.toHaveBeenCalled()
    })
  }

  // Positive controls: the exact match must not leak to the project routes.
  for (const path of ['/projects/6', '/projects/6/backlog', '/projects/6/reports', '/projects/6/list', '/projects/6/settings']) {
    it(`still shows the tabs and breadcrumb at ${path}`, async () => {
      renderAt(path)
      expect(strip()).toBeInTheDocument()
      expect(await screen.findByRole('link', { name: 'ECM Platform' })).toHaveAttribute('href', '/projects/6')
    })
  }

  it('keeps active-tab highlighting inside a project', () => {
    renderAt('/projects/6/backlog')
    expect(screen.getByRole('link', { name: /^backlog$/i })).toHaveClass('active')
    expect(screen.getByRole('link', { name: /^summary$/i })).not.toHaveClass('active')
  })

  it('leaves the global views that legitimately show the strip unchanged', () => {
    renderAt('/backlog')
    expect(strip()).toBeInTheDocument()
  })
})
