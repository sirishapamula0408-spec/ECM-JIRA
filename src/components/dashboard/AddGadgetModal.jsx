import './AddGadgetModal.css'

const GADGET_TYPES = [
  {
    type: 'pie',
    title: 'Pie Chart',
    description: 'Visualize issue distribution as a pie chart with clickable segments.',
    preview: 'pie',
    defaultConfig: { groupBy: 'status', showLabels: true, showLegend: true },
  },
  {
    type: 'donut',
    title: 'Donut Chart',
    description: 'Donut chart with center total count and toggle-able legend.',
    preview: 'donut',
    defaultConfig: { groupBy: 'status', showLabels: true, showLegend: true },
  },
  {
    type: 'bar',
    title: 'Bar Chart',
    description: 'Horizontal or vertical bar chart with groupBy options.',
    preview: 'bar',
    defaultConfig: { groupBy: 'priority', orientation: 'horizontal', stacked: false, showLabels: true },
  },
  {
    type: 'filterResults',
    title: 'Filter Results',
    description: 'Sortable, paginated issue table showing key, summary, assignee, and more.',
    preview: 'table',
    defaultConfig: { pageSize: 10 },
  },
  {
    type: 'activityStream',
    title: 'Activity Stream',
    description: 'Live activity feed with auto-refresh showing recent project activity.',
    preview: 'activity',
    defaultConfig: { refreshInterval: 30000 },
  },
  {
    type: 'sprintHealth',
    title: 'Sprint Burndown',
    description: 'SVG burndown chart comparing ideal vs actual sprint progress.',
    preview: 'burndown',
    defaultConfig: {},
  },
]

function MiniPreview({ type }) {
  switch (type) {
    case 'pie':
      return (
        <div className="mini-preview mini-preview--pie">
          <div className="mini-pie" style={{ background: 'conic-gradient(#0052cc 0 40%, #00875a 40% 70%, #ff991f 70% 100%)' }} />
        </div>
      )
    case 'donut':
      return (
        <div className="mini-preview mini-preview--donut">
          <div className="mini-donut" style={{ background: 'conic-gradient(#7fb239 0 35%, #4c9aff 35% 65%, #a95be7 65% 100%)' }}>
            <div className="mini-donut-hole" />
          </div>
        </div>
      )
    case 'bar':
      return (
        <div className="mini-preview mini-preview--bar">
          <div className="mini-bar" style={{ width: '80%', background: '#de350b' }} />
          <div className="mini-bar" style={{ width: '55%', background: '#ff991f' }} />
          <div className="mini-bar" style={{ width: '30%', background: '#00875a' }} />
        </div>
      )
    case 'table':
      return (
        <div className="mini-preview mini-preview--table">
          <div className="mini-table-row mini-table-head" />
          <div className="mini-table-row" />
          <div className="mini-table-row" />
          <div className="mini-table-row" />
        </div>
      )
    case 'activity':
      return (
        <div className="mini-preview mini-preview--activity">
          <div className="mini-activity-item"><div className="mini-dot" /><div className="mini-line" /></div>
          <div className="mini-activity-item"><div className="mini-dot" /><div className="mini-line" /></div>
          <div className="mini-activity-item"><div className="mini-dot" /><div className="mini-line" /></div>
        </div>
      )
    case 'burndown':
      return (
        <div className="mini-preview mini-preview--burndown">
          <svg viewBox="0 0 60 40" className="mini-burndown-svg">
            <line x1="5" y1="5" x2="55" y2="35" stroke="#8993a4" strokeWidth="1" strokeDasharray="2 2" />
            <polyline points="5,5 15,8 25,14 35,18 45,28 55,32" fill="none" stroke="#0052cc" strokeWidth="1.5" />
          </svg>
        </div>
      )
    default:
      return <div className="mini-preview" />
  }
}

export function AddGadgetModal({ onAdd, onClose }) {
  const handleAdd = (gadgetType) => {
    onAdd(gadgetType.type, gadgetType.title, 'small', gadgetType.defaultConfig)
    onClose()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal add-gadget-modal" onClick={(e) => e.stopPropagation()}>
        <div className="add-gadget-header">
          <h2>Add a Gadget</h2>
          <button className="gadget-action-btn" onClick={onClose}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div className="add-gadget-grid">
          {GADGET_TYPES.map((gt) => (
            <button key={gt.type} className="add-gadget-card" onClick={() => handleAdd(gt)}>
              <MiniPreview type={gt.preview} />
              <div className="add-gadget-card-info">
                <strong>{gt.title}</strong>
                <p>{gt.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
