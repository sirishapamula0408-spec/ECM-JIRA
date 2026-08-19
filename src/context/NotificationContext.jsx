import { createContext, useContext } from 'react'

// JL-407: component-free by design — see NotificationProvider.jsx.
export const NotificationContext = createContext(null)

export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) throw new Error('useNotifications must be used within NotificationProvider')
  return context
}
