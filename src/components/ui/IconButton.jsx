import MuiIconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'

/**
 * IconButton — a 40×40 icon-only control (JL-439).
 *
 * `label` is REQUIRED and is not optional-by-omission: an icon-only button with
 * no accessible name is invisible to a screen reader, and that is the single
 * most common accessibility defect this component exists to make impossible.
 * It becomes both the `aria-label` and, unless `tooltip={false}`, the tooltip.
 *
 * `bordered` opts into the visible hairline. The default is borderless, which
 * is what a toolbar or header cluster wants; a standalone icon action next to
 * bordered controls should set it so it does not read as decoration.
 */
export function IconButton({
  label,
  tooltip = true,
  bordered = false,
  className = '',
  children,
  ...rest
}) {
  if (!label) {
    throw new Error('IconButton requires a `label` — an icon-only button with no accessible name is unusable with a screen reader.')
  }

  const button = (
    <MuiIconButton
      aria-label={label}
      className={`ds-icon-button ${bordered ? 'ds-icon-button--bordered' : ''} ${className}`.trim()}
      {...rest}
    >
      {children}
    </MuiIconButton>
  )

  // A disabled MUI button swallows pointer events, so a Tooltip wrapped around
  // one never fires. Skip the tooltip rather than shipping a dead wrapper.
  if (!tooltip || rest.disabled) return button
  return <Tooltip title={label}>{button}</Tooltip>
}
