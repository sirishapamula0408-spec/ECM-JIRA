// JL-456 — Timeline and Wiki are gone from the project header tab strip.
//
// The interesting half of this ticket is NOT the removal. It is that the Wiki
// tab was the only link to /projects/:id/wiki anywhere in the application:
// no sidebar entry (the sidebar carries workspace-level paths only, and the
// wiki needs a projectId), no quick action, no link from the issue view.
// Deleting it outright would have left JL-48 — hierarchical pages, versioning,
// full-text search, issue<->page links and server/routes/wiki.js — running and
// unreachable.
//
// So the absence assertions below are paired with reachability assertions. An
// absence test alone would still pass on the day someone deletes the wiki
// feature entirely, which is exactly the outcome this ticket must not cause.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('../api/projectApi', () => ({
  fetchProjectById: vi.fn(() => Promise.resolve({ id: 6, name: 'Verify QW2' })),
}))

import { ProjectTopPanel } from '../components/layout/ProjectTopPanel'

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ProjectTopPanel hasProjects />
    </MemoryRouter>,
  )

describe('JL-456 — the tabs are gone', () => {
  it('offers no Timeline tab inside a project', async () => {
    renderAt('/projects/6/board')
    await screen.findByRole('link', { name: /^backlog$/i })
    expect(screen.queryByRole('link', { name: /^timeline$/i })).not.toBeInTheDocument()
  })

  it('offers no Wiki tab inside a project', async () => {
    renderAt('/projects/6/board')
    await screen.findByRole('link', { name: /^backlog$/i })
    expect(screen.queryByRole('link', { name: /^wiki$/i })).not.toBeInTheDocument()
  })

  it('keeps the rest of the strip intact', async () => {
    renderAt('/projects/6/board')
    for (const label of [/^summary$/i, /^backlog$/i, /^active sprints$/i, /^reports$/i, /^list$/i, /^settings$/i]) {
      expect(await screen.findByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('offers neither tab outside a project either', () => {
    renderAt('/backlog')
    expect(screen.queryByRole('link', { name: /^timeline$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^wiki$/i })).not.toBeInTheDocument()
  })
})

describe('JL-456 — the routes and the breadcrumb are untouched', () => {
  // Removing a tab must not break a bookmark, and must not blank the
  // breadcrumb tail on a page that still renders.
  it('still names Timeline in the breadcrumb on the roadmap route', async () => {
    renderAt('/projects/6/roadmap')
    const crumb = await screen.findByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumb).getByText('Timeline')).toBeInTheDocument()
  })

  it('still names Wiki in the breadcrumb on the wiki route', async () => {
    renderAt('/projects/6/wiki')
    const crumb = await screen.findByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumb).getByText('Wiki')).toBeInTheDocument()
  })

  it('keeps the project breadcrumb itself unchanged', async () => {
    renderAt('/projects/6/wiki')
    const crumb = await screen.findByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumb).getByRole('button', { name: 'Projects' })).toBeInTheDocument()
    expect(within(crumb).getByRole('button', { name: 'Verify QW2' })).toBeInTheDocument()
  })
})

describe('JL-456 — the wiki is still reachable by clicking', () => {
  // The guard that gives this ticket its teeth. If someone later removes these
  // buttons, or deletes the wiki feature, this fails — where an absence-only
  // test would happily go green.
  it('ProjectSummaryPage links to the project wiki', () => {
    const src = readSource('src/pages/ProjectSummaryPage/ProjectSummaryPage.jsx')
    expect(src).toMatch(/navigate\(`\/projects\/\$\{projectId\}\/wiki`\)/)
  })

  it('ProjectDetailPage links to the project wiki', () => {
    const src = readSource('src/pages/ProjectDetailPage/ProjectDetailPage.jsx')
    expect(src).toMatch(/navigate\(`\/projects\/\$\{projectId\}\/wiki`\)/)
  })

  it('the wiki route still exists to be linked to', () => {
    const src = readSource('src/App.jsx')
    expect(src).toMatch(/path="\/projects\/:projectId\/wiki"/)
  })

  it('roadmap keeps its two existing entry points', () => {
    for (const f of ['src/pages/ProjectSummaryPage/ProjectSummaryPage.jsx', 'src/pages/ProjectDetailPage/ProjectDetailPage.jsx']) {
      expect(readSource(f), f).toMatch(/navigate\(`\/projects\/\$\{projectId\}\/roadmap`\)/)
    }
  })
})

// Read from disk rather than rendering those two pages: both pull in the full
// app-data context stack, and what needs guarding here is the existence of a
// link, which is a textual property of the source.
//
// Resolved from cwd (the project root under vitest) rather than
// import.meta.url: this is a `client` test and runs through Vite's transform,
// where import.meta.url is a served URL rather than a filesystem path.
function readSource(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}
