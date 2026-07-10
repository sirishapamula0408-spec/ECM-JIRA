import { Component } from 'react'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'

/**
 * Global React error boundary. Catches render-phase errors in its subtree and
 * shows a friendly MUI fallback instead of a blank screen. "Try again" resets
 * the boundary state (re-rendering children); "Reload" reloads the page.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // Surface the error for debugging without crashing the app.
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught an error:', error, info)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  handleReload = () => {
    if (typeof window !== 'undefined') window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box
          className="error-boundary"
          sx={{ p: 3, maxWidth: 640, mx: 'auto', mt: 4 }}
        >
          <Alert severity="error" variant="outlined">
            <AlertTitle>Something went wrong</AlertTitle>
            <Box sx={{ mb: 2 }}>
              An unexpected error occurred while rendering this view.
            </Box>
            {this.state.error?.message && (
              <Box component="pre" className="error-boundary-detail" sx={{ mb: 2, whiteSpace: 'pre-wrap', fontSize: 13, opacity: 0.85 }}>
                {this.state.error.message}
              </Box>
            )}
            <Stack direction="row" spacing={1}>
              <Button variant="contained" color="primary" size="small" onClick={this.handleReset}>
                Try again
              </Button>
              <Button variant="outlined" color="inherit" size="small" onClick={this.handleReload}>
                Reload
              </Button>
            </Stack>
          </Alert>
        </Box>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
