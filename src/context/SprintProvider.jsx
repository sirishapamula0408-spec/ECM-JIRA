// JL-407: the SprintProvider component lives here, apart from SprintContext.jsx
// which now exports only the context object and the useSprint hook. A module that
// exports a component alongside anything else opts out of Vite fast refresh
// (react-refresh/only-export-components). Splitting this way keeps every
// existing `import { useX } from '../context/XContext'` working — only the
// handful of provider imports (App.jsx and the test harnesses) moved.

import { useCallback, useState } from 'react'
import { completeSprint, createSprint, deleteSprint, startSprint, updateSprint } from '../api/sprintApi'
import { SprintContext } from './SprintContext'

export function SprintProvider({ children }) {
  const [sprints, setSprints] = useState([])

  const loadSprints = useCallback((data) => setSprints(data), [])

  const handleCreateSprint = useCallback(async (payload) => {
    const created = await createSprint(payload)
    setSprints((current) => [...current, created])
    return created
  }, [])

  const handleStartSprint = useCallback(async (sprintId, projectId) => {
    const updated = await startSprint(sprintId, projectId)
    setSprints((current) => current.map((s) => (s.id === sprintId ? updated : s)))
    return updated
  }, [])

  const handleUpdateSprint = useCallback(async (sprintId, payload) => {
    const updated = await updateSprint(sprintId, payload)
    setSprints((current) => current.map((s) => (s.id === sprintId ? updated : s)))
    return updated
  }, [])

  const handleCompleteSprint = useCallback(async (sprintId) => {
    const updated = await completeSprint(sprintId)
    setSprints((current) => current.map((s) => (s.id === sprintId ? updated : s)))
    return updated
  }, [])

  const handleDeleteSprint = useCallback(async (sprintId) => {
    await deleteSprint(sprintId)
    setSprints((current) => current.filter((s) => s.id !== sprintId))
  }, [])

  return (
    <SprintContext.Provider value={{ sprints, loadSprints, handleCreateSprint, handleStartSprint, handleUpdateSprint, handleCompleteSprint, handleDeleteSprint }}>
      {children}
    </SprintContext.Provider>
  )
}
