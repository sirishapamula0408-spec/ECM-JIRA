// JL-407: the IssueProvider component lives here, apart from IssueContext.jsx
// which now exports only the context object and the useIssue hook. A module that
// exports a component alongside anything else opts out of Vite fast refresh
// (react-refresh/only-export-components). Splitting this way keeps every
// existing `import { useX } from '../context/XContext'` working — only the
// handful of provider imports (App.jsx and the test harnesses) moved.

import { useCallback, useState } from 'react'
import { createIssue, fetchIssues, updateIssue, updateIssueStatus, deleteIssue } from '../api/issueApi'
import { IssueContext } from './IssueContext'

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

  const handleDelete = useCallback(async (id) => {
    await deleteIssue(id)
    setIssues((current) => current.filter((issue) => issue.id !== id))
  }, [])

  return (
    <IssueContext.Provider value={{ issues, loadIssues, reloadIssues, handleCreate, handleUpdate, handleMove, handleDelete }}>
      {children}
    </IssueContext.Provider>
  )
}
