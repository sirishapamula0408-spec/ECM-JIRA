import { useMemo, useRef, useState } from 'react'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import ListItemText from '@mui/material/ListItemText'
import CheckIcon from '@mui/icons-material/Check'
import { ISSUE_STATUSES } from '../../constants'
import { resolveStatusCategory, CATEGORY_GLYPH } from '../../utils/statusCategory'
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
 * COLOUR SOURCE — JL-457. The lozenge decides nothing about colour.
 * It asks `resolveStatusCategory()` in `utils/statusCategory` for one of five
 * categories (todo / inprogress / done / cancelled / blocked) and names a class
 * after it; that class reads the `--status-*` tokens in `styles/variables.css`.
 * Board columns and workflow-editor nodes go through the SAME resolver and the
 * SAME tokens, so a lozenge cannot disagree with the column heading above it.
 *
 * Pass the project's name→category map (BoardPage's `statusCategories`, from
 * `GET /api/projects/:id/statuses`, JL-309) as `categoryMap` to honour
 * per-project configuration; without it the resolver falls back to by-name
 * inference. Cancelled and blocked are detected by name in either case, since
 * no API field carries them.
 *
 * Dark theme is handled by overriding the tokens themselves (theme.css), not by
 * restating brightened hexes here — that duplication is what previously let the
 * lozenge and the board drift apart.
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
 * JL-457: the lozenge no longer decides anything about colour. It asks the one
 * shared resolver for a category and names a class after it; the tokens behind
 * that class are the same ones the board column and the workflow node read.
 *
 * This replaced a local three-bucket function that collapsed cancelled into
 * neutral, so a cancelled status was indistinguishable from a to-do one.
 */
const statusLozengeCategory = resolveStatusCategory

/*
 * JL-457: the category glyph.
 *
 * aria-hidden because the category is already carried by the lozenge's
 * accessible name ("Status for JL-12: In Progress"). A screen reader reading
 * "half-filled circle" before every status would be pure noise; the glyph is
 * there for people who can see the chip but not its colour.
 */
function CategoryGlyph({ category }) {
  return (
    <span className="status-lozenge-glyph" aria-hidden="true">
      {CATEGORY_GLYPH[category] || CATEGORY_GLYPH.todo}
    </span>
  )
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
        <CategoryGlyph category={category} />
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
        <CategoryGlyph category={category} />
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
