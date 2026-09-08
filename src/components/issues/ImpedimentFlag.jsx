// JL-215: Flag issue as impediment — JIRA-style "Add flag / Remove flag".
// `ImpedimentFlagIndicator` is the small warning-colored flag icon shown on
// board cards and backlog rows; `ImpedimentFlagToggle` is the sidebar control
// on the issue detail page (hidden for Viewers via usePermissions).
import { useState } from 'react'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import FlagIcon from '@mui/icons-material/Flag'
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined'
import { useIssues } from '../../context/IssueContext'
import { usePermissions } from '../../hooks/usePermissions'
import './ImpedimentFlag.css'

export function ImpedimentFlagIndicator({ className = '' }) {
  return (
    <span
      className={`impediment-flag-indicator${className ? ` ${className}` : ''}`}
      role="img"
      aria-label="Flagged as impediment"
      title="Flagged as impediment"
    >
      <FlagIcon fontSize="inherit" />
    </span>
  )
}

/**
 * @param {object}  issue
 * @param {boolean} [compact]  icon-only, for dense rows (JL-466). The backlog
 *   row is a single line of small controls; the full "Add flag" / "Remove flag"
 *   button belongs on the issue detail page, where there is room for it.
 *   Compact mode is a PRESENTATION option only — the toggle logic, the
 *   permission gate and the state it writes are identical, so the two cannot
 *   drift. Duplicating this component for the backlog is precisely how JL-466
 *   happened.
 */
export function ImpedimentFlagToggle({ issue, compact = false }) {
  const { handleUpdate } = useIssues()
  const { canEditIssue } = usePermissions(issue?.projectId)
  const [saving, setSaving] = useState(false)
  const flagged = issue?.flagged === true

  // Viewers cannot toggle — show a read-only indicator when flagged.
  // In compact mode, render nothing: the backlog row already displays its own
  // "Flagged" chip, and a second indicator beside it would just be noise.
  if (!canEditIssue) {
    return flagged && !compact ? <ImpedimentFlagIndicator /> : null
  }

  const toggle = async () => {
    if (saving || !issue?.id) return
    setSaving(true)
    try {
      await handleUpdate(issue.id, { flagged: !flagged })
    } catch {
      // handleUpdate surfaces API errors via the shared client (Snackbar)
    } finally {
      setSaving(false)
    }
  }

  // The label the button would carry, reused as the accessible name in compact
  // mode so an icon-only control still says what it does.
  const label = flagged ? 'Remove flag' : 'Add flag'

  if (compact) {
    return (
      <IconButton
        className="impediment-flag-toggle impediment-flag-toggle--compact"
        size="small"
        color="warning"
        onClick={toggle}
        disabled={saving}
        aria-pressed={flagged}
        aria-label={label}
        title={label}
      >
        {flagged ? <FlagIcon fontSize="inherit" /> : <FlagOutlinedIcon fontSize="inherit" />}
      </IconButton>
    )
  }

  return (
    <Button
      className="impediment-flag-toggle"
      size="small"
      color="warning"
      variant={flagged ? 'contained' : 'outlined'}
      startIcon={flagged ? <FlagIcon /> : <FlagOutlinedIcon />}
      onClick={toggle}
      disabled={saving}
      aria-pressed={flagged}
    >
      {label}
    </Button>
  )
}
