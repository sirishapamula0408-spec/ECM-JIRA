import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { lightTheme, darkTheme } from '../theme/muiTheme'

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

  const muiTheme = useMemo(() => (theme === 'dark' ? darkTheme : lightTheme), [theme])

  return (
    <ThemeContext.Provider value={{ theme, onThemeChange }}>
      <MuiThemeProvider theme={muiTheme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
