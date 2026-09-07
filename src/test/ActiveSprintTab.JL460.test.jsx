// JL-460 — the Active sprints tab appears only when a sprint is started.
//
// Without one the tab led to ActiveSprintPage's "No active sprints" empty
// state: a tab promising content its destination could not give.
//
// BOTH states are asserted, and that pairing is the point. A test that only
// checked the tab was absent would pass just as happily on the day someone
// deletes the tab outright — which is the outcome this ticket must not cause,
// since the tab is meant to come back by itself the moment a sprint starts.
//
// The predicate under test is deliberately the GLOBAL one
// (`sprints.some(s => s.isStarted)`), matching ActiveSprintPage.jsx:33 rather
// than ProjectSummaryPage's project-scoped version (JL-343). Sprints in this
// schema are workspace-global with no project_id and the page never reads
// projectId, so scoping the tab while the page stays global would hide the tab
// on a project whose page would still have rendered content. See the comment in
// ProjectTopPanel.jsx.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api/projectApi', () => ({
  fetchProjectById: vi.fn(() => Promise.resolve({ id: 6, name: 'Verify QW2' })),
}))

// Swapped per test — the whole subject of this file.
let mockSprints = []
vi.mock('../context/SprintContext', () => ({
  useSprints: () => ({ sprints: mockSprints }),
}))

import { ProjectTopPanel } from '../components/layout/ProjectTopPanel'

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ProjectTopPanel hasProjects />
    </MemoryRouter>,
  )

const activeSprintTab = () => screen.queryByRole('link', { name: /^active sprints$/i })

describe('JL-460 — no started sprint', () => {
  beforeEach(() => { mockSprints = [] })

  it('does not offer the Active sprints tab', async () => {
    renderAt('/projects/6/board')
    await screen.findByRole('link', { name: /^backlog$/i })
    expect(activeSprintTab()).toBeNull()
  })

  it('does not offer it outside a project either', () => {
    renderAt('/backlog')
    expect(activeSprintTab()).toBeNull()
  })

  it('leaves every other tab in place', async () => {
    renderAt('/projects/6/board')
    for (const label of [/^summary$/i, /^backlog$/i, /^reports$/i, /^list$/i, /^settings$/i]) {
      expect(await screen.findByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('still names Active sprints in the breadcrumb on that route', async () => {
    // The route stays reachable by URL, so the breadcrumb tail must still label
    // it — the same treatment JL-456 gave Timeline and Wiki.
    renderAt('/projects/6/active-sprint')
    const crumb = await screen.findByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumb).getByText('Active sprints')).toBeInTheDocument()
  })

  it('treats a sprint that exists but is not started as no active sprint', () => {
    // A planned-but-unstarted sprint is exactly the case this ticket is about.
    mockSprints = [{ id: 1, name: 'Sprint 1', isStarted: false }]
    renderAt('/projects/6/board')
    expect(activeSprintTab()).toBeNull()
  })
})

describe('JL-460 — a started sprint exists', () => {
  beforeEach(() => {
    mockSprints = [{ id: 1, name: 'Sprint 1', isStarted: true }]
  })

  it('offers the Active sprints tab', async () => {
    renderAt('/projects/6/board')
    expect(await screen.findByRole('link', { name: /^active sprints$/i })).toBeInTheDocument()
  })

  it('points it at the project-scoped route', async () => {
    renderAt('/projects/6/board')
    const tab = await screen.findByRole('link', { name: /^active sprints$/i })
    expect(tab).toHaveAttribute('href', '/projects/6/active-sprint')
  })

  it('marks it active on the active-sprint page', async () => {
    renderAt('/projects/6/active-sprint')
    const tab = await screen.findByRole('link', { name: /^active sprints$/i })
    expect(tab.className).toMatch(/active/)
  })

  it('shows it when only one of several sprints is started', () => {
    // JL-124 allows parallel sprints; one started among many is still "active".
    mockSprints = [
      { id: 1, name: 'Sprint 1', isStarted: false },
      { id: 2, name: 'Sprint 2', isStarted: true },
      { id: 3, name: 'Sprint 3', isStarted: false },
    ]
    renderAt('/projects/6/board')
    expect(activeSprintTab()).toBeInTheDocument()
  })
})

describe('JL-460 — degrades rather than throwing', () => {
  it('treats a missing sprint list as no active sprint', () => {
    // The context is populated by a fetch; an early render can see undefined.
    // A crash in the header would take out every page.
    mockSprints = undefined
    renderAt('/projects/6/board')
    expect(activeSprintTab()).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Project Views' })).toBeInTheDocument()
  })

  it('ignores a malformed sprint row', () => {
    mockSprints = [null, undefined, {}, { isStarted: true }]
    renderAt('/projects/6/board')
    // The well-formed-enough row still counts; the junk must not throw.
    expect(activeSprintTab()).toBeInTheDocument()
  })
})
