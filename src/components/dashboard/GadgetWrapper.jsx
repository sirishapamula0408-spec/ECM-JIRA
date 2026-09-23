import { useState } from 'react'
import { COG_TEETH_PATH } from '../icons/HeaderPanelIcon'
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

/*
 * JL-472 — one glyph per gadget type.
 *
 * Four cards with identical chrome, distinguished only by a title in the same
 * weight and colour as every other title, are slow to scan. Atlassian's gadgets
 * carry a type glyph for exactly this reason: you find "the chart one" by shape
 * before you read a word.
 *
 * Every path here is drawn on the SAME footing — viewBox 0 0 16 16, no fill,
 * currentColor stroke at 1.4, round caps — because the header previously mixed
 * three optical weights: a filled drag handle, a 1.6-stroke close icon and
 * 1.4-stroke everything else, all within a few pixels of each other. The drag
 * handle stays filled: a dotted grip is a universal convention and reading it
 * as an outline would make it look like a control rather than a texture.
 *
 * aria-hidden throughout — the gadget's title is right next to it and already
 * names the thing. A screen reader announcing "chart" before "Status Overview"
 * is noise.
 */
const GADGET_TYPE_ICONS = {
  pie: <><circle cx="8" cy="8" r="5.75" /><path d="M8 2.25V8l4.05 4.05" /></>,
  donut: <><circle cx="8" cy="8" r="5.75" /><circle cx="8" cy="8" r="2.25" /></>,
  bar: <path d="M3.25 13.25V8.5M8 13.25V3.75M12.75 13.25v-3.5" />,
  filterResults: <path d="M2.75 4.25h10.5M2.75 8h10.5M2.75 11.75h6.5" />,
  activityStream: <path d="M2.25 8.5h2.6l1.8-4.2 2.5 8 1.9-5.1 1 1.3h1.8" />,
  sprintHealth: <><path d="M2.5 13.25h11" /><path d="M3 11l3.4-4 2.8 2.3 4.1-5.1" /></>,
}

// A gadget type with no glyph of its own still gets a placeholder of the same
// weight, rather than a header that silently loses its leading icon and shifts
// the title 20px left.
const FALLBACK_TYPE_ICON = <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="1.5" />

function GadgetTypeIcon({ type }) {
  return (
    <span className="gadget-type-icon" aria-hidden="true">
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {GADGET_TYPE_ICONS[type] || FALLBACK_TYPE_ICON}
      </svg>
    </span>
  )
}

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
            <GadgetTypeIcon type={gadget.type} />
            <span className="gadget-title">{gadget.title}</span>
            <div className="gadget-actions">
              <button
                className="gadget-action-btn"
                title="Close"
                aria-label={`Close ${gadget.title}`}
                onClick={onMaximize}
              >
                {/* JL-472: 1.4, matching every other icon in the header. */}
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
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
        <span className="gadget-drag-handle" title="Drag to reorder" aria-hidden="true">
          <svg viewBox="0 0 10 16" width="10" height="14" fill="currentColor">
            <circle cx="3" cy="2" r="1.2" /><circle cx="7" cy="2" r="1.2" />
            <circle cx="3" cy="6" r="1.2" /><circle cx="7" cy="6" r="1.2" />
            <circle cx="3" cy="10" r="1.2" /><circle cx="7" cy="10" r="1.2" />
            <circle cx="3" cy="14" r="1.2" /><circle cx="7" cy="14" r="1.2" />
          </svg>
        </span>
        <GadgetTypeIcon type={gadget.type} />
        <span className="gadget-title">{gadget.title}</span>
        <div className="gadget-actions">
          <div className="gadget-size-wrap">
            <button
              className="gadget-action-btn"
              title="Resize"
              aria-label={`Resize ${gadget.title}`}
              aria-expanded={showSizeMenu}
              aria-haspopup="menu"
              onClick={() => setShowSizeMenu((p) => !p)}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="12" height="12" rx="1.5" />
                <path d="M8 2v12M2 8h12" />
              </svg>
            </button>
            {showSizeMenu && (
              <div className="gadget-size-menu" role="menu">
                {SIZE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    role="menuitemradio"
                    aria-checked={gadget.size === opt.value}
                    className={`gadget-size-option${gadget.size === opt.value ? ' active' : ''}`}
                    onClick={() => { onResize(opt.value); setShowSizeMenu(false) }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="gadget-action-btn"
            title="Configure"
            aria-label={`Configure ${gadget.title}`}
            onClick={onConfig}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d={COG_TEETH_PATH} />
              <circle cx="8" cy="8" r="2.05" />
            </svg>
          </button>
          <button
            className="gadget-action-btn"
            title="Maximize"
            aria-label={`Maximize ${gadget.title}`}
            onClick={onMaximize}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
            </svg>
          </button>
          <button
            className="gadget-action-btn gadget-action-btn--danger"
            title="Remove"
            aria-label={`Remove ${gadget.title}`}
            onClick={onRemove}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </div>
      <div className="gadget-body">{children}</div>
    </div>
  )
}
