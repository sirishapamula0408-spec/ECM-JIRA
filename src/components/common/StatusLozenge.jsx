import { useMemo, useRef, useState } from 'react'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import ListItemText from '@mui/material/ListItemText'
import CheckIcon from '@mui/icons-material/Check'
import { ISSUE_STATUSES } from '../../constants'
import { defaultCategoryForStatus, isCancelStatus } from '../../utils/statusCategory'
import './StatusLozenge.css'

/**
 * JL-384: StatusLozenge — a compact, Atlassian-style status "lozenge".
 *
 * Board cards and backlog rows render a raw native `<select>` for status.
 * Atlassian Jira never does this: it shows a small coloured lozenge that opens
 * a transition menu on click. The native select inflates card height (a column
 * fits 3 cards where Jira fits 5-6), restates what the board column already
 * says, and its native chrome clashes with the MUI components used everywhere
 * else. This component is the replacement.
 *
 * COLOUR SOURCE — deliberately NOT a new status→hex map.
 * The board already colours its columns by *status category* (JL-311/JL-312 in
 * `src/pages/BoardPage/BoardPage.jsx`): a column is `done` when all its
 * statuses are done-category, `inprogress` when all are in-progress, otherwise
 * neutral; any cancellation status stays neutral. The category itself comes
 * per-project from `GET /api/projects/:id/statuses` (`fetchProjectStatuses`,
 * JL-309), which returns `{ name, category }` rows. The resulting
 * `.kanban-col-cat-done` / `.kanban-col-cat-inprogress` classes paint from the
 * shared `--jira-success` / `--jira-blue` tokens in `styles/variables.css`.
 *
 * This component takes the SAME inputs and paints from the SAME tokens:
 *   - pass the project's name→category map (BoardPage's `statusCategories`)
 *     as `categoryMap` and the lozenge agrees with the column heading exactly;
 *   - with no map it falls back to the same by-name inference the board uses
 *     when a status carries no explicit category — literally the same
 *     functions, imported from `utils/statusCategory` (JL-387 lifted them out
 *     of BoardPage so this component no longer keeps a hand-copied duplicate).
 * See StatusLozenge.css — the category classes reuse the very tokens the
 * `.kanban-col-cat-*` rules use, including the dark-theme brightenings.
 *
 * Props:
 *   status       (string)   current status name. Unknown/missing degrades to a
 *                           neutral "No status" lozenge rather than throwing.
 *   transitions  (string[]) permitted transitions to offer in the menu.
 *                           Defaults to the canonical `ISSUE_STATUSES`.
 *   onChange     (fn)       called with the chosen status name. Not called when
 *                           the current status is re-selected (no-op transition).
 *   categoryMap  (object)   optional name→'todo'|'inprogress'|'done' map, i.e.
 *                           BoardPage's per-project `statusCategories`.
 *   readOnly     (bool)     render the lozenge with NO menu, not focusable and
 *                           not a control — for users without edit permission.
 *   context      (string)   extra context for the accessible name, e.g. an
 *                           issue key: "Status for JL-12: In Progress".
 *   className    (string)   extra class on the lozenge.
 *   id           (string)   id passed to the trigger element.
 *
 * Accessibility:
 *   - the trigger is a real `<button>` with `aria-haspopup="menu"`,
 *     `aria-expanded` and an accessible name that always INCLUDES the current
 *     status, so a screen-reader user hears the state, not just "button";
 *   - Enter / Space / ArrowDown / ArrowUp open the menu (explicit handlers, not
 *     relying on mouse-only events), MUI's MenuList then owns arrow-key roving
 *     focus and Escape-to-close, and focus returns to the trigger on close;
 *   - a visible focus ring is defined in the stylesheet (`:focus-visible`);
 *   - the read-only variant is a plain `<span>` — no tab stop, no menu — that
 *     still carries the status in its label.
 */

/**
 * Resolve the lozenge's visual category, exactly the way a board column does.
 * Returns 'done' | 'inprogress' | 'neutral'. Only `done` and `inprogress` are
 * accented; everything else (todo, cancelled, unknown) is neutral.
 */
function statusLozengeCategory(status, categoryMap) {
  const name = typeof status === 'string' ? status.trim() : ''
  if (!name) return 'neutral'
  if (isCancelStatus(name)) return 'neutral'
  const category = (categoryMap && categoryMap[name]) || defaultCategoryForStatus(name)
  if (category === 'done') return 'done'
  if (category === 'inprogress') return 'inprogress'
  return 'neutral'
}

const NO_STATUS_LABEL = 'No status'

export function StatusLozenge({
  status,
  transitions = ISSUE_STATUSES,
  onChange,
  categoryMap,
  readOnly = false,
  context,
  className,
  id,
}) {
  const [anchorEl, setAnchorEl] = useState(null)
  const triggerRef = useRef(null)

  const current = typeof status === 'string' && status.trim() ? status.trim() : ''
  const display = current || NO_STATUS_LABEL
  const category = statusLozengeCategory(current, categoryMap)

  // Always includes the current status so the state is announced, not just the
  // fact that a control exists.
  const accessibleName = context
    ? `Status for ${context}: ${display}`
    : `Status: ${display}`

  const options = useMemo(
    () => (Array.isArray(transitions) ? transitions.filter((item) => typeof item === 'string' && item) : []),
    [transitions],
  )

  const classes = [
    'status-lozenge',
    `status-lozenge-cat-${category}`,
    readOnly ? 'status-lozenge-readonly' : 'status-lozenge-button',
    className,
  ].filter(Boolean).join(' ')

  if (readOnly) {
    return (
      <span
        id={id}
        className={classes}
        data-status={current}
        data-category={category}
        aria-label={accessibleName}
        title={accessibleName}
      >
        {display}
      </span>
    )
  }

  function open() {
    setAnchorEl(triggerRef.current)
  }

  function close() {
    setAnchorEl(null)
  }

  function handleClick(event) {
    // Safe inside clickable rows/cards: never navigate the parent.
    event.stopPropagation()
    open()
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // preventDefault stops the browser's own button activation (which would
      // otherwise re-open on keyup) and stops ArrowDown scrolling the list.
      event.preventDefault()
      event.stopPropagation()
      open()
    }
  }

  function handleSelect(event, next) {
    event.stopPropagation()
    close()
    // Re-selecting the current status is a no-op transition — close silently
    // instead of firing a pointless update.
    if (next !== current && typeof onChange === 'function') onChange(next)
  }

  return (
    <>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className={classes}
        data-status={current}
        data-category={category}
        aria-label={accessibleName}
        aria-haspopup="menu"
        aria-expanded={anchorEl ? 'true' : 'false'}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <span className="status-lozenge-text">{display}</span>
        <span className="status-lozenge-caret" aria-hidden="true" />
      </button>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={close}
        // MenuList owns arrow-key roving focus; Escape closes via the Modal.
        autoFocus
        transitionDuration={0}
        MenuListProps={{ 'aria-label': `Change status from ${display}`, dense: true }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        onClick={(event) => event.stopPropagation()}
      >
        {options.map((option) => (
          <MenuItem
            key={option}
            selected={option === current}
            className={`status-lozenge-option status-lozenge-cat-${statusLozengeCategory(option, categoryMap)}`}
            onClick={(event) => handleSelect(event, option)}
          >
            <ListItemText primary={option} />
            {option === current && <CheckIcon className="status-lozenge-check" fontSize="small" aria-hidden="true" />}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

export default StatusLozenge
