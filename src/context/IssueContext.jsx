import { createContext, useContext } from 'react'

// JL-407: component-free by design — see IssueProvider.jsx.
export const IssueContext = createContext(null)

export function useIssues() {
  const context = useContext(IssueContext)
  if (!context) throw new Error('useIssues must be used within IssueProvider')
  return context
}
