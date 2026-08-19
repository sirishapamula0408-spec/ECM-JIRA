import { createContext, useContext } from 'react'

// JL-407: component-free by design — see AppDataProvider.jsx.
export const AppDataContext = createContext(null)

export function useAppData() {
  const context = useContext(AppDataContext)
  if (!context) throw new Error('useAppData must be used within AppDataProvider')
  return context
}
