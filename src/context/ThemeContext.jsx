import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles'
import { buildMuiTheme } from '../theme/muiTheme'

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

  // JL-408: MUI had no theme at all, so every MUI component fell back to MUI's
  // defaults — Roboto (never loaded here) and a rem-based scale that multiplied
  // against the 14px root. Building it from the same tokens as variables.css
  // puts MUI text on the project's scale, and keying it to `theme` means the MUI
  // palette follows the same light/dark switch as the CSS custom properties.
  // No CssBaseline: index.css already owns the reset, and adding a second one
  // would fight it.
  const muiTheme = useMemo(() => buildMuiTheme(theme === 'dark' ? 'dark' : 'light'), [theme])

  return (
    <ThemeContext.Provider value={{ theme, onThemeChange }}>
      <MuiThemeProvider theme={muiTheme}>
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
