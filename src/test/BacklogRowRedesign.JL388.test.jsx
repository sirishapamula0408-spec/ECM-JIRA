// JL-388: the backlog row rebuilt on the shared components.
//
// Before this ticket a backlog row rendered:
//   - a raw native <select> for status (Atlassian Jira never does this),
//   - no issue-type icon at all, so Story/Bug/Task were indistinguishable,
//   - and `<span className="backlog-row-minus">-</span>` — a HARDCODED dash
//     with no data binding whatsoever, which is why every row in the review
//     screenshots showed "-" and the column carried no information.
//
// The dash is the important one. The column was NOT dead: `storyPoints` is on
// the issue already (`server/routes/issues.js` maps
// `storyPoints: row.story_points ?? null`, and the backlog sort reads it), so
// the fix is to bind the column to that value and render NOTHING when there is
// no estimate. The "renders nothing when storyPoints is null" test below is the
// regression guard against the literal ever coming back.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { BacklogIssueRow } from '../components/issues/BacklogIssueRow'
import { ISSUE_STATUSES } from '../constants'

const baseIssue = {
  id: 7,
  key: 'TP-7',
  title: 'Rebuild the backlog row',
  issueType: 'Story',
  status: 'To Do',
  priority: 'High',
  assignee: 'Alice Doe',
  projectId: 1,
  sprintId: null,
  storyPoints: null,
  dueDate: null,
  flagged: false,
}

let rowProps

beforeEach(() => {
  rowProps = {
    onMove: vi.fn(),
    onOpen: vi.fn(),
    isSelected: false,
    onToggleSelect: vi.fn(),
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
  }
})

function renderRow(overrides = {}, props = {}) {
  return render(<BacklogIssueRow issue={{ ...baseIssue, ...overrides }} {...rowProps} {...props} />)
}

function statusTrigger() {
  return screen.getByRole('button', { name: /^Status for / })
}

// ── status: the lozenge replaces the native select ──

describe('JL-388 — backlog row status control', () => {
  it('renders no native <select> anywhere on the row', () => {
    const { container } = renderRow()
    expect(container.querySelector('select')).toBeNull()
    expect(document.querySelector('select')).toBeNull()
    // the old row-specific select class is gone too
    expect(document.querySelector('.backlog-status-select')).toBeNull()
  })

  it('renders the status as the shared lozenge, labelled with the issue key', () => {
    renderRow({ status: 'In Progress' })
    const trigger = screen.getByRole('button', { name: 'Status for TP-7: In Progress' })
    expect(trigger).toHaveClass('status-lozenge')
    expect(trigger).toHaveClass('backlog-status-lozenge')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveTextContent('In Progress')
  })

  it('offers the canonical transitions and calls onMove(issue.id, next) on selection', async () => {
    renderRow({ status: 'To Do' })
    fireEvent.click(statusTrigger())

    const menu = await screen.findByRole('menu')
    for (const status of ISSUE_STATUSES) {
      expect(within(menu).getByRole('menuitem', { name: new RegExp(status) })).toBeInTheDocument()
    }

    fireEvent.click(within(menu).getByRole('menuitem', { name: /Code Review/ }))
    expect(rowProps.onMove).toHaveBeenCalledTimes(1)
    expect(rowProps.onMove).toHaveBeenCalledWith(7, 'Code Review')
  })

  it('does not fire onMove when the current status is re-selected', async () => {
    renderRow({ status: 'To Do' })
    fireEvent.click(statusTrigger())

    const menu = await screen.findByRole('menu')
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^To Do/ }))
    expect(rowProps.onMove).not.toHaveBeenCalled()
  })

  it('renders no interactive status control for a read-only user', () => {
    const { container } = renderRow({ status: 'Backlog' }, { canEdit: false })

    expect(container.querySelector('select')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Status for / })).toBeNull()

    const lozenge = container.querySelector('.status-lozenge')
    expect(lozenge).toHaveClass('status-lozenge-readonly')
    expect(lozenge.tagName).toBe('SPAN')
    expect(lozenge).toHaveTextContent('Backlog')
    // still announced with its state, just not operable
    expect(lozenge).toHaveAttribute('aria-label', 'Status for TP-7: Backlog')
  })
})

// ── issue-type icon ──

describe('JL-388 — issue-type icon', () => {
  it.each(['Story', 'Bug', 'Task', 'Sub-task'])('renders the %s type icon beside the title', (issueType) => {
    const { container } = renderRow({ issueType })
    const icon = screen.getByRole('img', { name: issueType })
    expect(icon).toBeInTheDocument()
    // it sits inside the title button, next to the key and summary
    expect(container.querySelector('.backlog-issue-main').contains(icon)).toBe(true)
  })

  it('does not throw and still shows a glyph when the type is missing', () => {
    expect(() => renderRow({ issueType: null })).not.toThrow()
    expect(screen.getByRole('img', { name: 'Unknown issue type' })).toBeInTheDocument()
  })
})

// ── story points: the hardcoded dash, replaced by real data ──

describe('JL-388 — story-point badge', () => {
  it('renders the estimate when the issue has one', () => {
    const { container } = renderRow({ storyPoints: 5 })
    const badge = container.querySelector('.backlog-points-badge')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('5')
    expect(badge).toHaveAttribute('aria-label', 'Estimate: 5 story points')
  })

  it('treats 0 as a real estimate rather than "no estimate"', () => {
    const { container } = renderRow({ storyPoints: 0 })
    expect(container.querySelector('.backlog-points-badge')).toHaveTextContent('0')
  })

  it('renders NOTHING — not a dash — when storyPoints is null', () => {
    const { container } = renderRow({ storyPoints: null })
    expect(container.querySelector('.backlog-points-badge')).toBeNull()
    // regression guard: the hardcoded literal and its class must stay gone
    expect(container.querySelector('.backlog-row-minus')).toBeNull()
    expect(
      Array.from(container.querySelectorAll('.backlog-issue-actions *')).some(
        (el) => el.textContent.trim() === '-',
      ),
    ).toBe(false)
  })

  it('renders nothing when storyPoints is undefined or a non-number', () => {
    const { container: missing } = renderRow({ storyPoints: undefined })
    expect(missing.querySelector('.backlog-points-badge')).toBeNull()

    const { container: junk } = renderRow({ storyPoints: 'abc' })
    expect(junk.querySelector('.backlog-points-badge')).toBeNull()
  })
})

// ── everything else on the row survives the rebuild ──

describe('JL-388 — the rest of the row is intact', () => {
  it('still renders the impediment flag chip when flagged', () => {
    renderRow({ flagged: true })
    expect(screen.getByRole('img', { name: 'Flagged as impediment' })).toBeInTheDocument()
    expect(screen.getByText('Flagged')).toBeInTheDocument()
    expect(document.querySelector('.backlog-issue-row')).toHaveClass('backlog-issue-flagged')
  })

  it('still renders the blocked chip with its blockers', () => {
    renderRow({}, { blocked: { isBlocked: true, blockedBy: ['TP-1', 'TP-2'] } })
    const chip = screen.getByLabelText('Blocked by TP-1, TP-2')
    expect(chip).toHaveClass('backlog-blocked-chip')
  })

  it('still renders the due-date badge', () => {
    const { container } = renderRow({ dueDate: '2020-01-01' })
    const badge = container.querySelector('.due-badge')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('Overdue')
  })

  it('still renders the selection checkbox, the key/title link and the assignee avatar', () => {
    const { container } = renderRow()
    expect(screen.getByLabelText('Select TP-7')).toBeInTheDocument()
    expect(screen.getByText('TP-7')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Rebuild the backlog row'))
    expect(rowProps.onOpen).toHaveBeenCalled()

    expect(container.querySelector('.member-avatar')).toHaveTextContent('AL')
  })
})
