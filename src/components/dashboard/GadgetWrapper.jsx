import { useState } from 'react'
import './GadgetWrapper.css'

const SIZE_CLASSES = {
  small: 'gadget--1col',
  medium: 'gadget--1col gadget--tall',
  large: 'gadget--2col',
  full: 'gadget--full',
}

const SIZE_OPTIONS = [
  { value: 'small', label: '1 col' },
  { value: 'medium', label: '1 col tall' },
  { value: 'large', label: '2 col' },
  { value: 'full', label: 'Full row' },
]

export function GadgetWrapper({
  gadget,
  children,
  onRemove,
  onConfig,
  onResize,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragOver,
  isMaximized,
  onMaximize,
}) {
  const [showSizeMenu, setShowSizeMenu] = useState(false)
  const sizeClass = SIZE_CLASSES[gadget.size] || 'gadget--1col'

  if (isMaximized) {
    return (
      <div className="gadget-maximize-overlay" onClick={onMaximize}>
        <div className="gadget-maximize-panel" onClick={(e) => e.stopPropagation()}>
          <div className="gadget-header">
            <span className="gadget-title">{gadget.title}</span>
            <div className="gadget-actions">
              <button className="gadget-action-btn" title="Close" onClick={onMaximize}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
          </div>
          <div className="gadget-body gadget-body--maximized">{children}</div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`gadget ${sizeClass}${isDragOver ? ' gadget--drag-over' : ''}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        className="gadget-header"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <span className="gadget-drag-handle" title="Drag to reorder">
          <svg viewBox="0 0 10 16" width="10" height="14" fill="currentColor">
            <circle cx="3" cy="2" r="1.2" /><circle cx="7" cy="2" r="1.2" />
            <circle cx="3" cy="6" r="1.2" /><circle cx="7" cy="6" r="1.2" />
            <circle cx="3" cy="10" r="1.2" /><circle cx="7" cy="10" r="1.2" />
            <circle cx="3" cy="14" r="1.2" /><circle cx="7" cy="14" r="1.2" />
          </svg>
        </span>
        <span className="gadget-title">{gadget.title}</span>
        <div className="gadget-actions">
          <div className="gadget-size-wrap">
            <button className="gadget-action-btn" title="Resize" onClick={() => setShowSizeMenu((p) => !p)}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="2" y="2" width="12" height="12" rx="1.5" />
                <path d="M8 2v12M2 8h12" />
              </svg>
            </button>
            {showSizeMenu && (
              <div className="gadget-size-menu">
                {SIZE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`gadget-size-option${gadget.size === opt.value ? ' active' : ''}`}
                    onClick={() => { onResize(opt.value); setShowSizeMenu(false) }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="gadget-action-btn" title="Configure" onClick={onConfig}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
              <circle cx="8" cy="8" r="2.5" />
              <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
            </svg>
          </button>
          <button className="gadget-action-btn" title="Maximize" onClick={onMaximize}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
            </svg>
          </button>
          <button className="gadget-action-btn gadget-action-btn--danger" title="Remove" onClick={onRemove}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </div>
      <div className="gadget-body">{children}</div>
    </div>
  )
}
