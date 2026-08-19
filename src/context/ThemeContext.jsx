import { createContext, useContext } from 'react'

// JL-407: component-free by design — see ThemeProvider.jsx.
export const ThemeContext = createContext(null)

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
