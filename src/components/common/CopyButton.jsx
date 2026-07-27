import { useEffect, useRef, useState } from 'react'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'

/**
 * JL-238: reusable copy-to-clipboard icon button.
 *
 * Copies `value` to the clipboard on click and flips the tooltip to "Copied!"
 * for a short moment. Click events never bubble to the parent, so it is safe
 * to embed inside clickable rows/cards (backlog rows, board cards) without
 * triggering navigation.
 *
 * Props:
 * - value:     the text to copy (required)
 * - title:     idle tooltip text (default "Copy")
 * - label / ariaLabel: accessible name for the button (falls back to `title`)
 * - className, sx, iconSize: presentation passthroughs
 */
export function CopyButton({
  value,
  title = 'Copy',
  label,
  ariaLabel,
  className,
  sx,
  iconSize = 14,
}) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(null)
  useEffect(() => () => clearTimeout(timerRef.current), [])

  async function handleCopy(event) {
    // Never let the click reach the surrounding row/card (would navigate).
    event.stopPropagation()
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — silently ignore */
    }
  }

  return (
    <Tooltip title={copied ? 'Copied!' : title}>
      <IconButton
        size="small"
        className={className}
        aria-label={ariaLabel || label || title}
        onClick={handleCopy}
        sx={sx}
      >
        <ContentCopyIcon sx={{ fontSize: iconSize }} />
      </IconButton>
    </Tooltip>
  )
}

export default CopyButton
