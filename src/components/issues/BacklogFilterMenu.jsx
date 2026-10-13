import { useState } from 'react'
import Badge from '@mui/material/Badge'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Popover from '@mui/material/Popover'
import { TopNavIcon } from '../icons/TopNavIcon'
import { FILTER_FIELDS, UNASSIGNED, countActiveFilters, toggleFilterValue, EMPTY_FILTERS } from '../../utils/backlogFilters'

// Backlog toolbar "Filter" button + popover. Fully controlled: the page owns
// `filters`, this only renders the options it is given and reports changes.
export function BacklogFilterMenu({ filters, options, onChange }) {
  const [anchorEl, setAnchorEl] = useState(null)
  const activeCount = countActiveFilters(filters)
  const open = Boolean(anchorEl)

  return (
    <>
      <Badge badgeContent={activeCount} color="primary" invisible={activeCount === 0}>
        <button
          className={`btn btn-ghost backlog-filter-btn${activeCount ? ' is-active' : ''}`}
          type="button"
          onClick={(event) => setAnchorEl(event.currentTarget)}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <span className="filter-glyph" aria-hidden="true"><TopNavIcon name="filter" /></span>
          Filter
        </button>
      </Badge>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { className: 'backlog-filter-popover', role: 'dialog', 'aria-label': 'Filter backlog' } }}
      >
        {FILTER_FIELDS.map(({ key, label }) => (
          <fieldset key={key} className="backlog-filter-group">
            <legend>{label}</legend>
            {options[key]?.length ? options[key].map((value) => (
              <FormControlLabel
                key={value}
                control={(
                  <Checkbox
                    size="small"
                    checked={filters[key].includes(value)}
                    onChange={() => onChange(toggleFilterValue(filters, key, value))}
                  />
                )}
                label={value === UNASSIGNED ? 'Unassigned' : value}
              />
            )) : <span className="backlog-filter-empty">No values</span>}
          </fieldset>
        ))}
        <div className="backlog-filter-footer">
          <Button size="small" onClick={() => onChange(EMPTY_FILTERS)} disabled={activeCount === 0}>
            Clear filters
          </Button>
        </div>
      </Popover>
    </>
  )
}
