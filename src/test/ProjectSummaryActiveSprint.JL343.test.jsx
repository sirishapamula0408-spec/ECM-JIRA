// JL-343: the "Active Sprint" stat card on ProjectSummaryPage permanently
// showed "-" because it looked for `s.status === 'active'` while the sprints
// API returns an `isStarted` boolean (mapSprint in server/routes/sprints.js
// has no `status` key). It also searched ALL sprints instead of just the
// current project's. These tests pin the fixed behavior: project-scoped
// `isStarted` lookup, a sensible empty state, and a "+N" hint when parallel
// sprints (JL-124) leave more than one started.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ProjectSummaryPage } from '../pages/ProjectSummaryPage/ProjectSummaryPage'

let mockIssues = []
let mockSprints = []

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: mockIssues }),
}))

vi.mock('../context/SprintContext', () => ({
  useSprints: () => ({ sprints: mockSprints }),
}))

vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({ members: [] }),
}))

vi.mock('../api/projectApi', () => ({
  fetchProjectById: vi.fn().mockResolvedValue({
    id: 1,
    name: 'Apollo',
    key: 'APL',
    type: 'Software',
    lead: 'Alice',
    avatar_color: '#0052cc',
  }),
}))

function renderPage(projectId = 1) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectSummaryPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

// The stat cards are label/value pairs; grab the value next to "Active Sprint".
function activeSprintCardValue() {
  const label = screen.getByText('Active Sprint')
  const card = label.closest('.ps-stat-card')
  return card.querySelector('.ps-stat-value').textContent
}

beforeEach(() => {
  mockIssues = []
  mockSprints = []
})

describe('ProjectSummaryPage — Active Sprint stat card (JL-343)', () => {
  it('shows the started sprint name for the current project (not "-")', async () => {
    mockSprints = [
      { id: 1, name: 'Sprint 3', isStarted: false },
      { id: 2, name: 'Sprint 4', isStarted: true },
    ]
    mockIssues = [
      { id: 10, key: 'APL-1', title: 'In sprint', status: 'In Progress', priority: 'High', issueType: 'Task', projectId: 1, sprintId: 2 },
      { id: 11, key: 'APL-2', title: 'Backlog item', status: 'Backlog', priority: 'Low', issueType: 'Story', projectId: 1, sprintId: null },
    ]
    renderPage(1)
    // wait for the async project fetch to resolve
    await screen.findByText('Apollo')
    expect(activeSprintCardValue()).toBe('Sprint 4')
    expect(activeSprintCardValue()).not.toBe('-')
  })

  it('does not show a started sprint that belongs to a different project', async () => {
    // Sprint 9 is started but only project 2's issues reference it; project 1
    // must not claim it on its summary card.
    mockSprints = [{ id: 9, name: 'Other Team Sprint', isStarted: true }]
    mockIssues = [
      { id: 20, key: 'APL-1', title: 'Our issue', status: 'To Do', priority: 'Medium', issueType: 'Task', projectId: 1, sprintId: null },
      { id: 21, key: 'ZZ-1', title: 'Their issue', status: 'In Progress', priority: 'High', issueType: 'Bug', projectId: 2, sprintId: 9 },
    ]
    renderPage(1)
    await screen.findByText('Apollo')
    expect(screen.queryByText('Other Team Sprint')).toBeNull()
    expect(activeSprintCardValue()).toBe('-')
  })

  it('renders the "-" empty state when the project has no started sprint', async () => {
    mockSprints = [{ id: 1, name: 'Sprint 1', isStarted: false }]
    mockIssues = [
      { id: 30, key: 'APL-1', title: 'Planned', status: 'To Do', priority: 'Low', issueType: 'Task', projectId: 1, sprintId: 1 },
    ]
    renderPage(1)
    await screen.findByText('Apollo')
    expect(activeSprintCardValue()).toBe('-')
  })

  it('indicates additional started sprints with a "+N" hint (JL-124 parallel sprints)', async () => {
    mockSprints = [
      { id: 1, name: 'Sprint 4', isStarted: true },
      { id: 2, name: 'Sprint 5', isStarted: true },
    ]
    mockIssues = [
      { id: 40, key: 'APL-1', title: 'A', status: 'To Do', priority: 'Low', issueType: 'Task', projectId: 1, sprintId: 1 },
      { id: 41, key: 'APL-2', title: 'B', status: 'To Do', priority: 'Low', issueType: 'Task', projectId: 1, sprintId: 2 },
    ]
    renderPage(1)
    await screen.findByText('Apollo')
    expect(activeSprintCardValue()).toBe('Sprint 4 +1')
  })
})
