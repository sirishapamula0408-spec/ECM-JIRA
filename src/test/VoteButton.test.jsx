import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('../api/voteApi', () => ({
  fetchVotes: vi.fn(),
  voteIssue: vi.fn(),
  unvoteIssue: vi.fn(),
}))

import { fetchVotes, voteIssue, unvoteIssue } from '../api/voteApi'
import VoteButton from '../components/issues/VoteButton'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('VoteButton (JL-214)', () => {
  it('loads and shows the vote count and unvoted state', async () => {
    fetchVotes.mockResolvedValue({ count: 4, hasVoted: false, voters: [] })

    render(<VoteButton issueId={7} />)
    expect(fetchVotes).toHaveBeenCalledWith(7)
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Vote (4)'))
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking vote calls voteIssue and updates the count and state', async () => {
    fetchVotes.mockResolvedValue({ count: 4, hasVoted: false, voters: [] })
    voteIssue.mockResolvedValue({ success: true, hasVoted: true, count: 5 })

    render(<VoteButton issueId={7} />)
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Vote (4)'))

    fireEvent.click(screen.getByRole('button'))
    expect(voteIssue).toHaveBeenCalledWith(7)
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Voted (5)'))
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
    expect(unvoteIssue).not.toHaveBeenCalled()
  })

  it('clicking again unvotes via unvoteIssue and decrements the count', async () => {
    fetchVotes.mockResolvedValue({ count: 5, hasVoted: true, voters: [] })
    unvoteIssue.mockResolvedValue({ success: true, hasVoted: false, count: 4 })

    render(<VoteButton issueId={7} />)
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Voted (5)'))

    fireEvent.click(screen.getByRole('button'))
    expect(unvoteIssue).toHaveBeenCalledWith(7)
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Vote (4)'))
    expect(voteIssue).not.toHaveBeenCalled()
  })

  it('rolls back the optimistic update when the vote request fails', async () => {
    fetchVotes.mockResolvedValue({ count: 2, hasVoted: false, voters: [] })
    voteIssue.mockRejectedValue(new Error('network'))

    render(<VoteButton issueId={7} />)
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Vote (2)'))

    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Vote (2)'))
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false')
  })
})
