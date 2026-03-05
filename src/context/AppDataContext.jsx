import { createContext, useCallback, useContext, useState } from 'react'

const AppDataContext = createContext(null)

export function AppDataProvider({ children }) {
  const [dashboard, setDashboard] = useState(null)
  const [roadmap, setRoadmap] = useState([])
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadAppData = useCallback((data) => {
    setDashboard(data.dashboard)
    setRoadmap(data.roadmap)
    setActivity(data.activity)
  }, [])

  const setAppLoading = useCallback((value) => setLoading(value), [])
  const setAppError = useCallback((value) => setError(value), [])

  return (
    <AppDataContext.Provider value={{ dashboard, roadmap, activity, loading, error, loadAppData, setAppLoading, setAppError }}>
      {children}
    </AppDataContext.Provider>
  )
}

export function useAppData() {
  const context = useContext(AppDataContext)
  if (!context) throw new Error('useAppData must be used within AppDataProvider')
  return context
}
