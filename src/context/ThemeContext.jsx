import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return window.localStorage.getItem('jira_theme') || 'light' } catch { return 'light' }
  })

  useEffect(() => {
    document.documentElement.classList.toggle('app-theme-dark', theme === 'dark')
    try { window.localStorage.setItem('jira_theme', theme) } catch { /* ignore */ }
  }, [theme])

  const onThemeChange = useCallback((nextTheme) => setTheme(nextTheme), [])

  return (
    <ThemeContext.Provider value={{ theme, onThemeChange }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
