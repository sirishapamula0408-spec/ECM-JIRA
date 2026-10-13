import { useEffect, useRef } from 'react'

// JL-190: a section's select-all checkbox. `state` is 'none' | 'some' | 'all';
// 'some' renders indeterminate, which has no HTML attribute and must be set as
// a DOM property.
export function SectionCheckbox({ state, onChange, label, disabled = false }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some'
  }, [state])
  return (
    <input
      ref={ref}
      className="backlog-checkbox"
      type="checkbox"
      checked={state === 'all'}
      aria-checked={state === 'some' ? 'mixed' : state === 'all'}
      onChange={(event) => onChange(event.target.checked)}
      aria-label={label}
      disabled={disabled}
    />
  )
}
