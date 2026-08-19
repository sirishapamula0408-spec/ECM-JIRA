import { createContext, useContext } from 'react'

// JL-407: component-free by design — see MemberProvider.jsx.
export const MemberContext = createContext(null)

export function useMembers() {
  const context = useContext(MemberContext)
  if (!context) throw new Error('useMembers must be used within MemberProvider')
  return context
}
