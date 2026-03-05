import { useState } from 'react'

const GROUP_BY_OPTIONS = [
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'issueType', label: 'Issue Type' },
  { value: 'assignee', label: 'Assignee' },
]

const ORIENTATION_OPTIONS = [
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'vertical', label: 'Vertical' },
]

const PAGE_SIZE_OPTIONS = [10, 25, 50]

const REFRESH_OPTIONS = [
  { value: 15000, label: '15 seconds' },
  { value: 30000, label: '30 seconds' },
  { value: 60000, label: '1 minute' },
  { value: 300000, label: '5 minutes' },
]

export function GadgetConfigModal({ gadget, onSave, onClose }) {
  const [config, setConfig] = useState({ ...gadget.config })
  const [title, setTitle] = useState(gadget.title)

  const handleSave = () => {
    onSave(gadget.id, title, config)
    onClose()
  }

  const isChart = ['pie', 'donut', 'bar'].includes(gadget.type)
  const isBar = gadget.type === 'bar'
  const isTable = gadget.type === 'filterResults'
  const isActivity = gadget.type === 'activityStream'

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal gadget-config-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gadget-config-header">
          <h2>Configure Gadget</h2>
          <button className="gadget-action-btn" onClick={onClose}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <label className="gadget-config-label">
          Title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        {isChart && (
          <label className="gadget-config-label">
            Group by
            <select value={config.groupBy || 'status'} onChange={(e) => setConfig((c) => ({ ...c, groupBy: e.target.value }))}>
              {GROUP_BY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
        )}

        {isChart && (
          <div className="gadget-config-row">
            <label className="gadget-config-check">
              <input type="checkbox" checked={config.showLabels !== false} onChange={(e) => setConfig((c) => ({ ...c, showLabels: e.target.checked }))} />
              Show labels
            </label>
            <label className="gadget-config-check">
              <input type="checkbox" checked={config.showLegend !== false} onChange={(e) => setConfig((c) => ({ ...c, showLegend: e.target.checked }))} />
              Show legend
            </label>
          </div>
        )}

        {isBar && (
          <label className="gadget-config-label">
            Orientation
            <select value={config.orientation || 'horizontal'} onChange={(e) => setConfig((c) => ({ ...c, orientation: e.target.value }))}>
              {ORIENTATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
        )}

        {isTable && (
          <label className="gadget-config-label">
            Page size
            <select value={config.pageSize || 10} onChange={(e) => setConfig((c) => ({ ...c, pageSize: Number(e.target.value) }))}>
              {PAGE_SIZE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt} per page</option>
              ))}
            </select>
          </label>
        )}

        {isActivity && (
          <label className="gadget-config-label">
            Refresh interval
            <select value={config.refreshInterval || 30000} onChange={(e) => setConfig((c) => ({ ...c, refreshInterval: Number(e.target.value) }))}>
              {REFRESH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}
