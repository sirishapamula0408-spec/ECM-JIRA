/**
 * Tabs — the underline tab strip (JL-439).
 *
 * Renders the shared `.tabs` / `.tab` classes from styles/shared.css, so this
 * component and the strips already written by hand on Issue Detail and
 * Webhooks are the same strip.
 *
 * It implements the WAI-ARIA tabs pattern, which none of the hand-rolled
 * versions did: `role="tablist"` with arrow-key and Home/End navigation, and
 * roving tabindex so the strip is one tab stop rather than one per tab.
 *
 * `tabs` is a list of `{ id, label, count? }`. This is a CONTROLLED component —
 * it renders no panels, because every existing call site already switches its
 * own content on a piece of state it owns.
 */
export function Tabs({ tabs = [], value, onChange, ariaLabel = 'Tabs', className = '' }) {
  const index = tabs.findIndex((t) => t.id === value)

  const onKeyDown = (event) => {
    const last = tabs.length - 1
    if (last < 0) return
    let next = null
    if (event.key === 'ArrowRight') next = index >= last ? 0 : index + 1
    else if (event.key === 'ArrowLeft') next = index <= 0 ? last : index - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    if (next == null) return
    event.preventDefault()
    onChange?.(tabs[next].id)
  }

  return (
    <div
      className={`tabs ${className}`.trim()}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            className={`tab ${selected ? 'tab-active' : ''}`.trim()}
            onClick={() => onChange?.(tab.id)}
          >
            {tab.label}
            {tab.count != null && <span className="tab-count">{tab.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
