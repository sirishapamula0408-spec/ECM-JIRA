import { useState, useCallback } from 'react'

const STORAGE_KEY = 'jira_dashboard_layout'

const DEFAULT_LAYOUT = {
  title: 'Dashboard',
  gadgets: [
    { id: 'g1', type: 'donut', title: 'Status Overview', size: 'small', config: { groupBy: 'status', showLabels: true, showLegend: true }, order: 0 },
    { id: 'g2', type: 'bar', title: 'Priority Breakdown', size: 'small', config: { groupBy: 'priority', orientation: 'horizontal', stacked: false, showLabels: true }, order: 1 },
    { id: 'g3', type: 'activityStream', title: 'Activity Stream', size: 'small', config: { refreshInterval: 30000 }, order: 2 },
    { id: 'g4', type: 'filterResults', title: 'Filter Results', size: 'large', config: { pageSize: 10 }, order: 3 },
  ],
}

function loadLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return DEFAULT_LAYOUT
}

function saveLayout(layout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch { /* ignore */ }
}

const COLS = 3
const SIZE_SPAN = { small: 1, medium: 1, large: 2, full: 3 }

// Auto-reflow: expand the last gadget in each row to fill any trailing gap
function reflowGadgets(gadgets) {
  const sorted = [...gadgets].sort((a, b) => a.order - b.order)
  let col = 0
  let rowStart = 0

  for (let i = 0; i < sorted.length; i++) {
    const span = SIZE_SPAN[sorted[i].size] || 1

    // If this gadget doesn't fit on the current row, fill the gap first
    if (col + span > COLS) {
      // Expand the last gadget on the previous row to fill remaining columns
      if (col < COLS && i > rowStart) {
        const prev = sorted[i - 1]
        const prevSpan = SIZE_SPAN[prev.size] || 1
        const gap = COLS - col
        const newSpan = prevSpan + gap
        if (newSpan === 3) sorted[i - 1] = { ...prev, size: 'full' }
        else if (newSpan === 2) sorted[i - 1] = { ...prev, size: 'large' }
      }
      col = 0
      rowStart = i
    }

    col += span
    if (col >= COLS) {
      col = 0
      rowStart = i + 1
    }
  }

  // Handle trailing gap on the last row
  if (col > 0 && col < COLS && sorted.length > 0) {
    const last = sorted[sorted.length - 1]
    const lastSpan = SIZE_SPAN[last.size] || 1
    const gap = COLS - col
    const newSpan = lastSpan + gap
    if (newSpan === 3) sorted[sorted.length - 1] = { ...last, size: 'full' }
    else if (newSpan === 2) sorted[sorted.length - 1] = { ...last, size: 'large' }
  }

  return sorted.map((g, i) => ({ ...g, order: i }))
}

let nextId = Date.now()

export function useDashboardLayout() {
  const [layout, setLayout] = useState(loadLayout)

  const persist = useCallback((updater) => {
    setLayout((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      saveLayout(next)
      return next
    })
  }, [])

  const setTitle = useCallback((title) => {
    persist((prev) => ({ ...prev, title }))
  }, [persist])

  const addGadget = useCallback((type, title, size = 'small', config = {}) => {
    const id = `g_${++nextId}`
    persist((prev) => ({
      ...prev,
      gadgets: [...prev.gadgets, { id, type, title, size, config, order: prev.gadgets.length }],
    }))
    return id
  }, [persist])

  const removeGadget = useCallback((id) => {
    persist((prev) => ({
      ...prev,
      gadgets: reflowGadgets(prev.gadgets.filter((g) => g.id !== id)),
    }))
  }, [persist])

  const updateGadgetConfig = useCallback((id, config) => {
    persist((prev) => ({
      ...prev,
      gadgets: prev.gadgets.map((g) => (g.id === id ? { ...g, config: { ...g.config, ...config } } : g)),
    }))
  }, [persist])

  const updateGadgetSize = useCallback((id, size) => {
    persist((prev) => ({
      ...prev,
      gadgets: reflowGadgets(prev.gadgets.map((g) => (g.id === id ? { ...g, size } : g))),
    }))
  }, [persist])

  const updateGadgetTitle = useCallback((id, title) => {
    persist((prev) => ({
      ...prev,
      gadgets: prev.gadgets.map((g) => (g.id === id ? { ...g, title } : g)),
    }))
  }, [persist])

  const reorderGadgets = useCallback((fromIndex, toIndex) => {
    persist((prev) => {
      const list = [...prev.gadgets].sort((a, b) => a.order - b.order)
      const [moved] = list.splice(fromIndex, 1)
      list.splice(toIndex, 0, moved)
      return { ...prev, gadgets: reflowGadgets(list) }
    })
  }, [persist])

  const resetLayout = useCallback(() => {
    persist(DEFAULT_LAYOUT)
  }, [persist])

  const sortedGadgets = [...layout.gadgets].sort((a, b) => a.order - b.order)

  return {
    title: layout.title,
    gadgets: sortedGadgets,
    setTitle,
    addGadget,
    removeGadget,
    updateGadgetConfig,
    updateGadgetSize,
    updateGadgetTitle,
    reorderGadgets,
    resetLayout,
  }
}
