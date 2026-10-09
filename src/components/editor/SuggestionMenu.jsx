import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

/*
 * JL-187 (fosasoft) — the popup for a TipTap suggestion: the "/" element menu
 * and the @mention picker. Filtering happens in the suggestion's `items`; this
 * draws the result next to the caret and handles the keyboard.
 *
 * Arrow keys move, Enter (or Tab) picks, Escape closes (in suggestionBridge).
 */
export function SuggestionMenu({ bridge, label, emptyText, renderItem, getKey }) {
  const state = useSyncExternalStore(bridge.subscribe, bridge.getState)
  const items = useMemo(() => state?.items ?? [], [state])
  const [active, setActive] = useState(0)
  const listRef = useRef(null)

  // Start at the top whenever the filtered list changes.
  const [lastItems, setLastItems] = useState(items)
  if (lastItems !== items) {
    setLastItems(items)
    setActive(0)
  }

  useEffect(() => {
    bridge.setKeyHandler((event) => {
      if (!items.length) return false
      if (event.key === 'ArrowDown') {
        setActive((i) => (i + 1) % items.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        setActive((i) => (i - 1 + items.length) % items.length)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        state?.command(items[Math.min(active, items.length - 1)])
        return true
      }
      return false
    })
    return () => bridge.setKeyHandler(null)
  }, [bridge, items, active, state])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  if (!state) return null
  const rect = state.clientRect?.()
  const style = rect
    ? { top: Math.min(rect.bottom + 6, window.innerHeight - 280), left: Math.min(rect.left, window.innerWidth - 300) }
    : undefined

  return (
    <div className="pe-suggest" style={style} role="listbox" aria-label={label} ref={listRef}>
      {items.length === 0 && <p className="pe-suggest__empty">{emptyText}</p>}
      {items.map((item, index) => (
        <button
          key={getKey(item)}
          type="button"
          role="option"
          aria-selected={index === active}
          className={`pe-suggest__item${index === active ? ' pe-suggest__item--active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setActive(index)}
          onClick={() => state.command(item)}
        >
          {renderItem(item)}
        </button>
      ))}
    </div>
  )
}

export default SuggestionMenu
