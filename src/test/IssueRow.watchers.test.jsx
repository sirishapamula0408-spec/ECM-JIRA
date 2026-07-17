import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IssueRow } from '../components/issues/IssueRow'

const baseIssue = {
  id: 1,
  key: 'TP-1',
  title: 'Do the thing',
  priority: 'Medium',
  issueType: 'Task',
  assignee: 'Alice',
  status: 'To Do',
}

describe('IssueRow watcher count badge (JL-36)', () => {
  it('shows the watcher count badge when watcherCount > 0', () => {
    render(<IssueRow issue={{ ...baseIssue, watcherCount: 3 }} onMove={() => {}} />)
    const badge = screen.getByTitle('3 watchers')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('3')
  })

  it('uses singular label for a single watcher', () => {
    render(<IssueRow issue={{ ...baseIssue, watcherCount: 1 }} onMove={() => {}} />)
    expect(screen.getByTitle('1 watcher')).toBeInTheDocument()
  })

  it('hides the badge when there are no watchers', () => {
    render(<IssueRow issue={{ ...baseIssue, watcherCount: 0 }} onMove={() => {}} />)
    expect(screen.queryByTitle(/watcher/)).not.toBeInTheDocument()
  })

  it('hides the badge when watcherCount is undefined', () => {
    render(<IssueRow issue={baseIssue} onMove={() => {}} />)
    expect(screen.queryByTitle(/watcher/)).not.toBeInTheDocument()
  })
})
