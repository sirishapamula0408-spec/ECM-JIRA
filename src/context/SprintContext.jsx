import { createContext, useCallback, useContext, useState } from 'react'
import { completeSprint, createSprint, deleteSprint, startSprint, updateSprint } from '../api/sprintApi'

const SprintContext = createContext(null)

export function SprintProvider({ children }) {
  const [sprints, setSprints] = useState([])

  const loadSprints = useCallback((data) => setSprints(data), [])

  const handleCreateSprint = useCallback(async (payload) => {
    const created = await createSprint(payload)
    setSprints((current) => [...current, created])
    return created
  }, [])

  const handleStartSprint = useCallback(async (sprintId) => {
    const updated = await startSprint(sprintId)
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

export function useSprints() {
  const context = useContext(SprintContext)
  if (!context) throw new Error('useSprints must be used within SprintProvider')
  return context
}
