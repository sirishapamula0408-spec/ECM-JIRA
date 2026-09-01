import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../api/projectApi', () => ({
  fetchProjectById: vi.fn(() => Promise.resolve({ id: 6, name: 'Verify QW2' })),
}))

import { ProjectTopPanel } from '../components/layout/ProjectTopPanel'

function renderAt(pathname) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <ProjectTopPanel hasProjects />
    </MemoryRouter>,
  )
}

const strip = () => screen.queryByRole('navigation', { name: /project views/i })

// JL-405 — the fifth instance of this change, after JL-373 (/teams),
// JL-374 (/users), JL-375 (/audit-log) and JL-376 (/activity). Filters,
// Portfolio and Report Builder have no project context, so a strip offering
// Summary / Timeline / Backlog / Active sprints / Reports / List was advertising
// project views from pages that are not scoped to a project.
describe('ProjectTopPanel — hidden on the utility pages (JL-405)', () => {
  for (const route of ['/filters', '/portfolio', '/report-builder']) {
    it(`does not render the navigation strip at ${route}`, () => {
      renderAt(route)
      expect(strip()).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /backlog/i })).not.toBeInTheDocument()
    })

    it(`does not render the navigation strip at a nested ${route} sub-path`, () => {
      renderAt(`${route}/42`)
      expect(strip()).not.toBeInTheDocument()
    })
  }

  // The assertion that gives the negatives their meaning: hiding the strip
  // everywhere would satisfy every test above.
  it('still renders the navigation strip inside a project (positive control)', async () => {
    renderAt('/projects/6/backlog')
    expect(await screen.findByRole('navigation', { name: /project views/i })).toBeInTheDocument()
  })

  it('still renders on the non-project pages that legitimately show it', async () => {
    // /board, /backlog and /list are NOT in HIDDEN_ROUTES and must keep the strip.
    for (const route of ['/board', '/backlog', '/list']) {
      const { unmount } = renderAt(route)
      expect(
        await screen.findByRole('navigation', { name: /project views/i }),
        `strip should still render at ${route}`,
      ).toBeInTheDocument()
      unmount()
    }
  })

  it('leaves the previously hidden pages hidden (regression control)', () => {
    for (const route of ['/dashboard', '/profile', '/activity', '/audit-log', '/members', '/users']) {
      const { unmount } = renderAt(route)
      expect(strip(), `${route} should stay hidden`).not.toBeInTheDocument()
      unmount()
    }
  })

  it('keeps HIDDEN_ROUTES in its documented order', () => {
    // The file says "base entries first, then page routes in alphabetical
    // order"; appending to the end would break that convention silently.
    const here = path.dirname(fileURLToPath(import.meta.url))
    const text = fs.readFileSync(
      path.join(here, '..', 'components', 'layout', 'ProjectTopPanel.jsx'), 'utf8',
    )
    const block = text.match(/const HIDDEN_ROUTES = \[([^\]]*)\]/)[1]
    const routes = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1])
    const pageRoutes = routes.slice(4) // after the four base entries
    expect(pageRoutes).toEqual([...pageRoutes].sort())
    for (const added of ['/filters', '/portfolio', '/report-builder']) {
      expect(routes, added).toContain(added)
    }
  })
})
