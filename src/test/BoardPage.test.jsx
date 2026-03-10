import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BoardPage } from '../pages/BoardPage/BoardPage'

vi.mock('../context/IssueContext', () => ({
  useIssues: vi.fn(),
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}))

import { useIssues } from '../context/IssueContext'
import { usePermissions } from '../hooks/usePermissions'

const mockIssues = [
  { id: 1, key: 'TEST-1', title: 'Issue One', issueType: 'Task', status: 'To Do', projectId: 1, sprintId: null },
  { id: 2, key: 'TEST-2', title: 'Issue Two', issueType: 'Bug', status: 'In Progress', projectId: 1, sprintId: null },
]

function setupMocks(permOverrides = {}) {
  useIssues.mockReturnValue({
    issues: mockIssues,
    handleMove: vi.fn(),
  })

  usePermissions.mockReturnValue({
    loaded: true,
    canEditIssue: true,
    canManageSprints: false,
    isAdmin: false,
    ...permOverrides,
  })
}

function renderBoard() {
  return render(
    <MemoryRouter initialEntries={['/board']}>
      <BoardPage />
    </MemoryRouter>,
  )
}

describe('BoardPage RBAC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should make cards draggable when user canEditIssue', () => {
    setupMocks({ canEditIssue: true })
    renderBoard()
    const cards = document.querySelectorAll('.kanban-card-draggable')
    expect(cards.length).toBeGreaterThan(0)
    cards.forEach((card) => {
      expect(card.getAttribute('draggable')).toBe('true')
    })
  })

  it('should disable drag when user cannot edit issues', () => {
    setupMocks({ canEditIssue: false })
    renderBoard()
    const cards = document.querySelectorAll('.kanban-card-draggable')
    expect(cards.length).toBeGreaterThan(0)
    cards.forEach((card) => {
      expect(card.getAttribute('draggable')).toBe('false')
    })
  })

  it('should enable status selects when user canEditIssue', () => {
    setupMocks({ canEditIssue: true })
    renderBoard()
    const selects = screen.getAllByRole('combobox')
    selects.forEach((select) => {
      expect(select).not.toBeDisabled()
    })
  })

  it('should disable status selects when user cannot edit issues', () => {
    setupMocks({ canEditIssue: false })
    renderBoard()
    const selects = screen.getAllByRole('combobox')
    selects.forEach((select) => {
      expect(select).toBeDisabled()
    })
  })

  it('should show delete board option for admins', () => {
    setupMocks({ isAdmin: true })
    renderBoard()
    fireEvent.click(screen.getByLabelText('More actions'))
    expect(screen.getByText('Delete board')).toBeInTheDocument()
  })

  it('should hide delete board option for non-admins without sprint permission', () => {
    setupMocks({ isAdmin: false, canManageSprints: false })
    renderBoard()
    fireEvent.click(screen.getByLabelText('More actions'))
    expect(screen.queryByText('Delete board')).not.toBeInTheDocument()
  })

  it('should show delete board option for users with canManageSprints', () => {
    setupMocks({ canManageSprints: true })
    renderBoard()
    fireEvent.click(screen.getByLabelText('More actions'))
    expect(screen.getByText('Delete board')).toBeInTheDocument()
  })
})
