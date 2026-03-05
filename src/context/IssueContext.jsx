import { createContext, useCallback, useContext, useState } from 'react'
import { createIssue, fetchIssues, updateIssue, updateIssueStatus } from '../api/issueApi'

const IssueContext = createContext(null)

export function IssueProvider({ children }) {
  const [issues, setIssues] = useState([])

  const loadIssues = useCallback((data) => setIssues(data), [])

  const handleCreate = useCallback(async (payload) => {
    const created = await createIssue(payload)
    setIssues((current) => [created, ...current])
    return created
  }, [])

  const reloadIssues = useCallback(async () => {
    const data = await fetchIssues()
    setIssues(data)
  }, [])

  const handleUpdate = useCallback(async (id, fields) => {
    const updated = await updateIssue(id, fields)
    setIssues((current) => current.map((issue) => (issue.id === id ? updated : issue)))
    return updated
  }, [])

  const handleMove = useCallback(async (id, status, sprintId) => {
    const updated = await updateIssueStatus(id, status, sprintId)
    setIssues((current) => current.map((issue) => (issue.id === id ? updated : issue)))
    return updated
  }, [])

  return (
    <IssueContext.Provider value={{ issues, loadIssues, reloadIssues, handleCreate, handleUpdate, handleMove }}>
      {children}
    </IssueContext.Provider>
  )
}

export function useIssues() {
  const context = useContext(IssueContext)
  if (!context) throw new Error('useIssues must be used within IssueProvider')
  return context
}
