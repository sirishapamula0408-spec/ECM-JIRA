import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Skeleton from '@mui/material/Skeleton'
import Typography from '@mui/material/Typography'

/**
 * Reusable loading block. Renders a centered spinner (default) or a set of
 * skeleton lines, with an optional label. Pair with `EmptyState` for "no data"
 * and `ErrorState` for failures.
 *
 * @param {object} props
 * @param {string} [props.label] optional text shown under the spinner
 * @param {'spinner'|'skeleton'} [props.variant]
 * @param {number} [props.rows] number of skeleton rows when variant="skeleton"
 */
export function LoadingState({ label, variant = 'spinner', rows = 3 }) {
  if (variant === 'skeleton') {
    return (
      <Box className="loading-state" aria-busy="true" aria-live="polite" sx={{ p: 2, width: '100%' }}>
        {label && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {label}
          </Typography>
        )}
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} variant="text" height={28} sx={{ mb: 0.5 }} />
        ))}
      </Box>
    )
  }

  return (
    <Box
      className="loading-state"
      role="status"
      aria-busy="true"
      aria-live="polite"
      sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, p: 4 }}
    >
      <CircularProgress size={32} />
      {label && (
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
      )}
    </Box>
  )
}

/**
 * Inline error surface with an optional retry button. Complements the global
 * ErrorBoundary for recoverable, in-page async failures.
 *
 * @param {object} props
 * @param {string|Error} [props.error] the error to display
 * @param {() => void} [props.onRetry] retry handler; shows a "Try again" button
 * @param {string} [props.title]
 */
export function ErrorState({ error, onRetry, title = 'Something went wrong' }) {
  const message = error instanceof Error ? error.message : error
  return (
    <Box className="error-state" sx={{ p: 2, width: '100%' }}>
      <Alert
        severity="error"
        action={
          onRetry ? (
            <Button color="inherit" size="small" onClick={onRetry}>
              Try again
            </Button>
          ) : undefined
        }
      >
        {title}
        {message ? `: ${message}` : ''}
      </Alert>
    </Box>
  )
}

export default LoadingState
