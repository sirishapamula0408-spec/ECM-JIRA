// JL-407: the AppDataProvider component lives here, apart from AppDataContext.jsx
// which now exports only the context object and the useAppData hook. A module that
// exports a component alongside anything else opts out of Vite fast refresh
// (react-refresh/only-export-components). Splitting this way keeps every
// existing `import { useX } from '../context/XContext'` working — only the
// handful of provider imports (App.jsx and the test harnesses) moved.

import { useCallback, useState } from 'react'
import { AppDataContext } from './AppDataContext'

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
