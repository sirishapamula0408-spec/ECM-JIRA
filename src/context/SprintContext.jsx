import { createContext, useContext } from 'react'

// JL-407: component-free by design — see SprintProvider.jsx.
export const SprintContext = createContext(null)

export function useSprints() {
  const context = useContext(SprintContext)
  if (!context) throw new Error('useSprints must be used within SprintProvider')
  return context
}
