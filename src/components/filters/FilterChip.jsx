import { useState, useRef, useEffect } from 'react'
import './FilterChip.css'

/**
 * JIRA-style filter chip component.
 *
 * @param {object} props
 * @param {string} props.label       - Display label for the filter (e.g. "Status")
 * @param {string} props.value       - Currently selected value
 * @param {Array}  props.options     - Array of option strings or { value, label } objects. First should be 'All'.
 * @param {(value: string) => void} props.onChange - Callback when a new value is selected
 * @param {() => void}              props.onClear  - Callback to reset to 'All'
 */
export function FilterChip({ label, value, options, onChange, onClear, hideClear }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const wrapRef = useRef(null)

  useEffect(() => {
    function handleOutsideClick(event) {
      if (open && wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [open])

  const normalizedOptions = options.map((opt) =>
    typeof opt === 'string' ? { value: opt, label: opt } : opt,
  )

  const filtered = normalizedOptions.filter((opt) =>
    opt.label.toLowerCase().includes(search.toLowerCase()),
  )

  const isActive = value !== 'All'
  const displayValue = normalizedOptions.find((o) => o.value === value)?.label ?? value

  function handleSelect(optValue) {
    onChange(optValue)
    setOpen(false)
    setSearch('')
  }

  function handleClear(event) {
    event.stopPropagation()
    onClear()
    setOpen(false)
    setSearch('')
  }

  return (
    <div ref={wrapRef} className="filter-chip-wrap">
      <button
        type="button"
        className={`filter-chip${isActive ? ' filter-chip--active' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="filter-chip__label">
          {label}: {displayValue}
        </span>
        {isActive && !hideClear && (
          <span
            className="filter-chip__clear"
            role="button"
            aria-label={`Clear ${label} filter`}
            onClick={handleClear}
          >
            <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </span>
        )}
        <span className="filter-chip__chevron" aria-hidden="true">
          <svg viewBox="0 0 10 6" width="10" height="6" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M1 1l4 4 4-4" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="filter-chip-dropdown" role="listbox">
          <div className="filter-chip-dropdown__search">
            <svg className="filter-chip-dropdown__search-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" />
            </svg>
            <input
              type="text"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <ul className="filter-chip-dropdown__list">
            {filtered.length === 0 && (
              <li className="filter-chip-dropdown__empty">No matches</li>
            )}
            {filtered.map((opt) => (
              <li
                key={opt.value}
                className={`filter-chip-dropdown__item${opt.value === value ? ' filter-chip-dropdown__item--selected' : ''}`}
                role="option"
                aria-selected={opt.value === value}
                onClick={() => handleSelect(opt.value)}
              >
                <span className="filter-chip-dropdown__check">
                  {opt.value === value && (
                    <svg viewBox="0 0 12 10" width="12" height="10" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M1 5.5l3 3L11 1" />
                    </svg>
                  )}
                </span>
                <span>{opt.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
