// JL-215: Flag issue as impediment — JIRA-style "Add flag / Remove flag".
// `ImpedimentFlagIndicator` is the small warning-colored flag icon shown on
// board cards and backlog rows; `ImpedimentFlagToggle` is the sidebar control
// on the issue detail page (hidden for Viewers via usePermissions).
import { useState } from 'react'
import Button from '@mui/material/Button'
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

export function ImpedimentFlagToggle({ issue }) {
  const { handleUpdate } = useIssues()
  const { canEditIssue } = usePermissions(issue?.projectId)
  const [saving, setSaving] = useState(false)
  const flagged = issue?.flagged === true

  // Viewers cannot toggle — show a read-only indicator when flagged.
  if (!canEditIssue) {
    return flagged ? <ImpedimentFlagIndicator /> : null
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
      {flagged ? 'Remove flag' : 'Add flag'}
    </Button>
  )
}
