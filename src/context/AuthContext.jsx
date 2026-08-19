import { createContext, useContext } from 'react'

// JL-407: component-free by design — see AuthProvider.jsx.
export const AuthContext = createContext(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
