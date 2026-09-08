// JL-466 — the backlog row's flag button flags; it does not change status.
//
// It used to be a button classed `flag-btn`, whose entire content was a flag
// glyph, calling onMove() with a status from this chain:
//
//   Backlog -> To Do -> In Progress -> Done
//
// Two things were wrong at once. It impersonated JL-215's impediment flag —
// which exists, and whose chip this very row renders. And the chain predated
// JL-306's QA statuses, so it skipped up to four of them and turned
// **Cancelled into Done**: one unconfirmed click on what looked like a flag
// marked a cancelled issue complete.
//
// The terminal-status cases below are the point of this file. A test that only
// checked "clicking the flag sets flagged" would pass even if the status chain
// were still there behind it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ISSUE_STATUSES } from '../constants'

const handleUpdate = vi.fn(() => Promise.resolve())
const handleMove = vi.fn(() => Promise.resolve())

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ handleUpdate, handleMove }),
}))

let canEdit = true
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ canEditIssue: canEdit }),
}))

import { BacklogIssueRow } from '../components/issues/BacklogIssueRow'

const issueAt = (status, extra = {}) => ({
  id: 11,
  key: 'TP-11',
  title: 'A story',
  status,
  priority: 'Medium',
  issueType: 'Task',
  assignee: 'Alex Rivera',
  projectId: 1,
  flagged: false,
  ...extra,
})

function renderRow(issue) {
  return render(
    <MemoryRouter>
      <BacklogIssueRow
        issue={issue}
        onMove={handleMove}
        onOpen={vi.fn()}
        isSelected={false}
        onToggleSelect={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />
    </MemoryRouter>,
  )
}

const flagBtn = () => screen.getByRole('button', { name: /add flag|remove flag/i })

describe('JL-466 — the flag button flags', () => {
  beforeEach(() => { canEdit = true; vi.clearAllMocks() })

  it('toggles the impediment flag, not the status', async () => {
    renderRow(issueAt('To Do'))
    await fireEvent.click(flagBtn())

    await waitFor(() => expect(handleUpdate).toHaveBeenCalledWith(11, { flagged: true }))
    expect(handleMove).not.toHaveBeenCalled()
  })

  it('unflags an already-flagged issue', async () => {
    renderRow(issueAt('To Do', { flagged: true }))
    expect(flagBtn()).toHaveAccessibleName('Remove flag')
    await fireEvent.click(flagBtn())
    await waitFor(() => expect(handleUpdate).toHaveBeenCalledWith(11, { flagged: false }))
  })

  it('says what it does, rather than being a bare glyph', () => {
    // The old button's accessible name was the character "⚑".
    renderRow(issueAt('To Do'))
    expect(flagBtn()).toHaveAccessibleName('Add flag')
    expect(flagBtn()).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('JL-466 — no status change from any status', () => {
  beforeEach(() => { canEdit = true; vi.clearAllMocks() })

  // Every canonical status, derived — not a hardcoded list, which is the very
  // habit that produced the original chain.
  it.each(ISSUE_STATUSES)('clicking the flag on a %s issue never calls onMove', async (status) => {
    renderRow(issueAt(status))
    await fireEvent.click(flagBtn())
    await waitFor(() => expect(handleUpdate).toHaveBeenCalled())
    expect(handleMove).not.toHaveBeenCalled()
  })

  it('cannot turn a Cancelled issue into Done', async () => {
    // The specific defect. Called out separately from the loop above because
    // it is the one with consequences that outlive the click.
    renderRow(issueAt('Cancelled'))
    await fireEvent.click(flagBtn())
    await waitFor(() => expect(handleUpdate).toHaveBeenCalled())

    expect(handleMove).not.toHaveBeenCalled()
    const moved = handleMove.mock.calls.map((c) => c[1])
    expect(moved).not.toContain('Done')
  })

  it('cannot advance a Done issue anywhere', async () => {
    renderRow(issueAt('Done'))
    await fireEvent.click(flagBtn())
    await waitFor(() => expect(handleUpdate).toHaveBeenCalled())
    expect(handleMove).not.toHaveBeenCalled()
  })
})

describe('JL-466 — Viewers get no flag control', () => {
  beforeEach(() => { canEdit = false; vi.clearAllMocks() })

  it('offers no toggle', () => {
    renderRow(issueAt('To Do'))
    expect(screen.queryByRole('button', { name: /add flag|remove flag/i })).toBeNull()
  })

  it('still shows the flagged chip, which is a read-only indicator', () => {
    renderRow(issueAt('To Do', { flagged: true }))
    expect(screen.getByText('Flagged')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove flag/i })).toBeNull()
  })
})
