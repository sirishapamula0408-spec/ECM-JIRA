// JL-387 — the board card, rebuilt on the shared components.
//
// Before this ticket a board card showed the issue key, the title, the type as
// a line of plain grey body text, and a raw native <select> for status. There
// was no assignee (so a column could not be scanned for ownership), no priority
// (the backlog had one, the board did not) and no estimate; and the select made
// every card ~40% taller than it needed to be.
//
// These tests pin the new composition: StatusLozenge (JL-384) instead of the
// select, IssueTypeIcon (JL-385) instead of the type text, and an assignee
// avatar coloured by avatarStyle (JL-386), a priority dot and a story-point
// badge in a single meta row.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { BoardPage } from '../pages/BoardPage/BoardPage'
import { avatarStyle } from '../utils/avatarColour'

// ── Mocks ──────────────────────────────────────────────────────────────────
const mockHandleMove = vi.fn()

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: mockIssues, handleMove: mockHandleMove }),
}))

let mockPerms = { canManageProjectSettings: true, canEditIssue: true }
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => mockPerms,
}))

const mockFetchBoardConfig = vi.fn()
const mockSaveBoardConfig = vi.fn()
vi.mock('../api/boardConfigApi', () => ({
  fetchBoardConfig: (...args) => mockFetchBoardConfig(...args),
  saveBoardConfig: (...args) => mockSaveBoardConfig(...args),
  ESTIMATION_STATISTIC_OPTIONS: [
    { value: 'story_points', label: 'Story Points' },
    { value: 'time_estimate', label: 'Original Time Estimate' },
    { value: 'issue_count', label: 'Issue Count' },
  ],
}))

const mockFetchProjectStatuses = vi.fn()
vi.mock('../api/issueConfigApi', () => ({
  fetchProjectStatuses: (...args) => mockFetchProjectStatuses(...args),
}))

vi.mock('../api/labelApi', () => ({
  fetchProjectLabels: () => Promise.resolve([]),
  fetchIssueLabels: () => Promise.resolve([]),
}))

let mockIssues = []

const baseIssues = [
  {
    id: 1,
    key: 'JL-1',
    title: 'Setup project',
    issueType: 'Task',
    status: 'To Do',
    priority: 'High',
    assignee: 'Alice Anderson',
    storyPoints: 5,
    sprintId: 7,
    projectId: 1,
  },
  {
    id: 2,
    key: 'JL-2',
    title: 'Fix login bug',
    issueType: 'Bug',
    status: 'In Progress',
    priority: 'Low',
    assignee: '',
    storyPoints: null,
    sprintId: null,
    projectId: 1,
  },
]

const statusRows = [
  { id: 10, project_id: 1, name: 'Backlog', position: 0, category: 'todo' },
  { id: 11, project_id: 1, name: 'To Do', position: 1, category: 'todo' },
  { id: 12, project_id: 1, name: 'In Progress', position: 2, category: 'inprogress' },
  { id: 13, project_id: 1, name: 'Done', position: 3, category: 'done' },
]

const emptyConfig = {
  projectId: 1,
  swimlaneBy: 'none',
  wipLimits: {},
  quickFilters: [],
  estimationStatistic: 'story_points',
  columns: [],
}

function renderBoard() {
  return render(
    <MemoryRouter initialEntries={['/projects/1/board']}>
      <Routes>
        <Route path="/projects/:projectId/board" element={<BoardPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

// Resolve a rendered card by its title.
async function findCard(title) {
  await screen.findByText(title)
  return screen.getByText(title).closest('.card')
}

beforeEach(() => {
  window.localStorage.clear()
  mockIssues = baseIssues.map((issue) => ({ ...issue }))
  mockPerms = { canManageProjectSettings: true, canEditIssue: true }
  mockHandleMove.mockReset().mockResolvedValue({})
  mockFetchBoardConfig.mockReset().mockResolvedValue(emptyConfig)
  mockSaveBoardConfig.mockReset().mockResolvedValue({})
  mockFetchProjectStatuses.mockReset().mockResolvedValue(statusRows)
})

describe('JL-387 — status is a lozenge, not a native select', () => {
  it('renders no native <select> anywhere on a card', async () => {
    renderBoard()
    const card = await findCard('Setup project')

    expect(card.querySelector('select')).toBeNull()
    expect(within(card).queryByRole('combobox')).toBeNull()
  })

  it('leaves no <select> on ANY card on the board', async () => {
    renderBoard()
    await screen.findByText('Setup project')

    const cards = [...document.querySelectorAll('.card')]
    expect(cards.length).toBe(2)
    for (const card of cards) expect(card.querySelector('select')).toBeNull()
  })

  it('renders the status as a StatusLozenge carrying the current status', async () => {
    renderBoard()
    const card = await findCard('Setup project')

    const lozenge = card.querySelector('.status-lozenge')
    expect(lozenge).toBeTruthy()
    expect(lozenge.tagName).toBe('BUTTON')
    expect(lozenge).toHaveTextContent('To Do')
    expect(within(card).getByRole('button', { name: 'Status for JL-1: To Do' })).toBeInTheDocument()
  })

  it('colours the lozenge from the board own per-project category map', async () => {
    renderBoard()
    const inProgress = await findCard('Fix login bug')

    // 'In Progress' is tagged inprogress by the project-statuses response, so
    // the lozenge must agree with the column heading above it.
    expect(inProgress.querySelector('.status-lozenge')).toHaveClass('status-lozenge-cat-inprogress')
    const todo = await findCard('Setup project')
    // JL-457: the class is named after the category (todo) rather than after the
    // visual it produced (neutral). Same grey; `.status-lozenge-cat-neutral` is
    // kept in the stylesheet as an alias for call sites that still pass it.
    expect(todo.querySelector('.status-lozenge')).toHaveClass('status-lozenge-cat-todo')
  })

  it('offers the project workflow statuses as transitions', async () => {
    renderBoard()
    const card = await findCard('Setup project')
    fireEvent.click(within(card).getByRole('button', { name: /^Status for JL-1:/ }))

    const menu = await screen.findByRole('menu')
    for (const name of ['Backlog', 'To Do', 'In Progress', 'Done']) {
      expect(within(menu).getByRole('menuitem', { name })).toBeInTheDocument()
    }
    expect(within(menu).queryByRole('menuitem', { name: 'Code Review' })).toBeNull()
  })

  it('moves the issue through handleMove, preserving the sprint id', async () => {
    renderBoard()
    const card = await findCard('Setup project')
    fireEvent.click(within(card).getByRole('button', { name: /^Status for JL-1:/ }))

    const menu = await screen.findByRole('menu')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'In Progress' }))

    await waitFor(() => expect(mockHandleMove).toHaveBeenCalledTimes(1))
    expect(mockHandleMove).toHaveBeenCalledWith(1, 'In Progress', 7)
  })

  it('passes null for an issue that belongs to no sprint', async () => {
    renderBoard()
    const card = await findCard('Fix login bug')
    fireEvent.click(within(card).getByRole('button', { name: /^Status for JL-2:/ }))

    const menu = await screen.findByRole('menu')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Done' }))

    await waitFor(() => expect(mockHandleMove).toHaveBeenCalledTimes(1))
    expect(mockHandleMove).toHaveBeenCalledWith(2, 'Done', null)
  })
})

describe('JL-387 — issue type is an icon, not a line of text', () => {
  it('renders the type as an IssueTypeIcon beside the title', async () => {
    renderBoard()
    const card = await findCard('Setup project')

    const icon = within(card).getByRole('img', { name: 'Task' })
    expect(icon.tagName.toLowerCase()).toBe('svg')
    expect(card.querySelector('.kanban-card-title').contains(icon)).toBe(true)
  })

  it('uses the issue own type for each card', async () => {
    renderBoard()
    const bug = await findCard('Fix login bug')
    expect(within(bug).getByRole('img', { name: 'Bug' })).toBeInTheDocument()
  })

  it('no longer spends a whole text block on the type name', async () => {
    renderBoard()
    const card = await findCard('Setup project')

    // The old markup was `<p>{issue.issueType}</p>` — a full 14px line plus an
    // 8px margin under the title. Nothing on the card renders "Task" as text.
    expect(card.querySelector('p')).toBeNull()
    expect(within(card).queryByText('Task')).toBeNull()
  })
})

describe('JL-387 — assignee avatar', () => {
  it('renders the assignee initials with the colour derived from the person', async () => {
    renderBoard()
    const card = await findCard('Setup project')

    const avatar = card.querySelector('.kanban-card-avatar')
    expect(avatar).toBeTruthy()
    expect(avatar).toHaveTextContent('AL')
    expect(avatar).toHaveAttribute('aria-label', 'Assignee: Alice Anderson')
    // Colour comes from JL-386 so board avatars match the rest of the app.
    expect(avatar.getAttribute('style')).toContain('--avatar-bg-')
    expect(avatar.getAttribute('style')).toContain(avatarStyle('Alice Anderson').background)
  })

  it('gives two different people two different colours', async () => {
    mockIssues = [
      { ...baseIssues[0] },
      { ...baseIssues[1], assignee: 'Bob Brown' },
    ]
    renderBoard()
    await screen.findByText('Setup project')

    const [a, b] = [...document.querySelectorAll('.kanban-card-avatar')]
    expect(a.getAttribute('style')).not.toBe(b.getAttribute('style'))
  })

  it('degrades to a neutral placeholder when the issue is unassigned', async () => {
    renderBoard()
    const card = await findCard('Fix login bug')

    const avatar = card.querySelector('.kanban-card-avatar')
    expect(avatar).toBeTruthy()
    expect(avatar).toHaveClass('kanban-card-avatar-unassigned')
    expect(avatar).toHaveAttribute('aria-label', 'Unassigned')
    // Unassigned is not a person, so it gets no derived colour at all.
    expect(avatar.getAttribute('style')).toBeNull()
  })
})

describe('JL-387 — priority indicator', () => {
  it('renders the shared priority mark the backlog and sprint board use', async () => {
    renderBoard()
    const card = await findCard('Setup project')

    const mark = card.querySelector('.priority-mark')
    expect(mark).toBeTruthy()
    expect(mark).toHaveClass('priority-high')
    expect(mark).toHaveAttribute('aria-label', 'Priority: High')
  })

  it('reflects each issue own priority', async () => {
    renderBoard()
    const card = await findCard('Fix login bug')
    expect(card.querySelector('.priority-mark')).toHaveClass('priority-low')
  })

  it('falls back to Medium when an issue carries no priority', async () => {
    mockIssues = [{ ...baseIssues[0], priority: null }]
    renderBoard()
    const card = await findCard('Setup project')

    expect(card.querySelector('.priority-mark')).toHaveClass('priority-medium')
  })
})

describe('JL-387 — story-point badge', () => {
  it('renders the badge when the issue has story points', async () => {
    renderBoard()
    const card = await findCard('Setup project')

    const badge = card.querySelector('.kanban-card-points')
    expect(badge).toBeTruthy()
    expect(badge).toHaveTextContent('5')
    expect(badge).toHaveAttribute('aria-label', 'Story points: 5')
  })

  it('renders NOTHING — not even a dash — when story points are null', async () => {
    renderBoard()
    const card = await findCard('Fix login bug')

    expect(card.querySelector('.kanban-card-points')).toBeNull()
    // No placeholder dash either — the meta row simply has one fewer chip.
    // (Checked on the meta row, since the issue KEY legitimately has a hyphen.)
    expect(card.querySelector('.kanban-card-meta').textContent).not.toContain('-')
  })

  it('renders a zero-point estimate rather than treating 0 as missing', async () => {
    mockIssues = [{ ...baseIssues[0], storyPoints: 0 }]
    renderBoard()
    const card = await findCard('Setup project')

    expect(card.querySelector('.kanban-card-points')).toHaveTextContent('0')
  })
})

describe('JL-387 — read-only (Viewer) path', () => {
  beforeEach(() => { mockPerms = { canManageProjectSettings: false, canEditIssue: false } })

  it('renders no interactive status control at all', async () => {
    renderBoard()
    const card = await findCard('Setup project')

    expect(card.querySelector('select')).toBeNull()
    expect(within(card).queryByRole('button', { name: /^Status for/ })).toBeNull()
    expect(card.querySelector('button.status-lozenge')).toBeNull()
  })

  it('still shows the status, as a read-only lozenge', async () => {
    renderBoard()
    const card = await findCard('Setup project')

    const lozenge = card.querySelector('.status-lozenge')
    expect(lozenge.tagName).toBe('SPAN')
    expect(lozenge).toHaveClass('status-lozenge-readonly')
    expect(lozenge).toHaveClass('kanban-status-readonly')
    expect(lozenge).toHaveTextContent('To Do')
  })

  it('still shows assignee, priority and estimate — read-only, not stripped', async () => {
    renderBoard()
    const card = await findCard('Setup project')

    expect(card.querySelector('.kanban-card-avatar')).toBeTruthy()
    expect(card.querySelector('.priority-mark')).toBeTruthy()
    expect(card.querySelector('.kanban-card-points')).toHaveTextContent('5')
  })
})

describe('JL-387 — density', () => {
  // jsdom does no layout, so height cannot be read off the DOM. What CAN be
  // asserted is the structure the height follows from: the card is three rows,
  // and the two blocks that cost the most vertical space (the type paragraph
  // and the native select line) are gone.
  it('is built from exactly three rows', async () => {
    renderBoard()
    const card = await findCard('Setup project')

    expect(card.querySelector('.kanban-card-top')).toBeTruthy()
    expect(card.querySelector('.kanban-card-title')).toBeTruthy()
    expect(card.querySelector('.kanban-card-meta')).toBeTruthy()
    expect(card.children.length).toBe(3)
  })

  it('keeps status, priority, estimate and assignee on ONE row', async () => {
    renderBoard()
    const card = await findCard('Setup project')
    const meta = card.querySelector('.kanban-card-meta')

    expect(meta.querySelector('.status-lozenge')).toBeTruthy()
    expect(meta.querySelector('.priority-mark')).toBeTruthy()
    expect(meta.querySelector('.kanban-card-points')).toBeTruthy()
    expect(meta.querySelector('.kanban-card-avatar')).toBeTruthy()
  })

  it('pulls the due-date badge onto the key row instead of a line of its own', async () => {
    mockIssues = [{ ...baseIssues[0], dueDate: '2099-01-01' }]
    renderBoard()
    const card = await findCard('Setup project')

    const badge = card.querySelector('.due-badge')
    expect(badge).toBeTruthy()
    expect(card.querySelector('.kanban-card-top').contains(badge)).toBe(true)
  })
})
