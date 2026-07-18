import { useEffect, useState } from 'react'
import { fetchVotes, voteIssue, unvoteIssue } from '../../api/voteApi'

/**
 * JL-214: Vote / unvote control for an issue.
 * Renders a thumbs-up quick button with the vote count; toggles the current
 * user's vote with an optimistic count update (server response reconciles).
 */
export default function VoteButton({ issueId }) {
  const [hasVoted, setHasVoted] = useState(false)
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!issueId) return
    fetchVotes(issueId)
      .then((data) => {
        setHasVoted(Boolean(data.hasVoted))
        setCount(Number(data.count) || 0)
      })
      .catch(() => {})
  }, [issueId])

  async function handleToggle() {
    if (!issueId) return
    const wasVoted = hasVoted
    // Optimistic update
    setHasVoted(!wasVoted)
    setCount((c) => (wasVoted ? Math.max(0, c - 1) : c + 1))
    try {
      const data = wasVoted ? await unvoteIssue(issueId) : await voteIssue(issueId)
      if (data && typeof data.count === 'number') setCount(data.count)
      if (data && typeof data.hasVoted === 'boolean') setHasVoted(data.hasVoted)
    } catch {
      // Roll back on failure
      setHasVoted(wasVoted)
      setCount((c) => (wasVoted ? c + 1 : Math.max(0, c - 1)))
    }
  }

  return (
    <button
      className={`id-quick-btn${hasVoted ? ' id-quick-btn--active' : ''}`}
      type="button"
      onClick={handleToggle}
      title={hasVoted ? 'Remove your vote' : 'Vote for this issue'}
      aria-pressed={hasVoted}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
      {hasVoted ? 'Voted' : 'Vote'} ({count})
    </button>
  )
}
