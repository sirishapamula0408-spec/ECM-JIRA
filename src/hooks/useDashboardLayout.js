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
      gadgets: prev.gadgets.filter((g) => g.id !== id).map((g, i) => ({ ...g, order: i })),
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
      gadgets: prev.gadgets.map((g) => (g.id === id ? { ...g, size } : g)),
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
      return { ...prev, gadgets: list.map((g, i) => ({ ...g, order: i })) }
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
