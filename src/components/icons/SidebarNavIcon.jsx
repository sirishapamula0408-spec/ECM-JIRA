export function SidebarNavIcon({ name }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }

  if (name === 'for-you') return <svg {...common}><circle cx="8" cy="8" r="5" /><circle cx="8" cy="8" r="1.6" /></svg>
  if (name === 'recent') return <svg {...common}><circle cx="8" cy="8" r="5" /><path d="M8 5.5v2.8l2 1.2" /></svg>
  if (name === 'starred') return <svg {...common}><path d="M8 2.8l1.7 3.4 3.7.5-2.7 2.6.7 3.7L8 11.3 4.6 13l.7-3.7L2.6 6.7l3.7-.5z" /></svg>
  if (name === 'apps') return <svg {...common}><rect x="3" y="3" width="4" height="4" /><rect x="9" y="3" width="4" height="4" /><rect x="3" y="9" width="4" height="4" /><rect x="9" y="9" width="4" height="4" /></svg>
  if (name === 'plans') return <svg {...common}><path d="M2.5 12.5h11" /><path d="M4 10V7" /><path d="M8 10V4.5" /><path d="M12 10V6" /></svg>
  if (name === 'spaces') return (
    <svg {...common} className="gantt-icon">
      <style>{`
        .gantt-icon .gantt-bar { stroke: none; fill: currentColor; rx: 1; }
        .gantt-icon .gantt-bar1 { animation: ganttSlide1 2.5s ease-in-out infinite; }
        .gantt-icon .gantt-bar2 { animation: ganttSlide2 2.5s ease-in-out infinite; }
        .gantt-icon .gantt-bar3 { animation: ganttSlide3 2.5s ease-in-out infinite; }
        @keyframes ganttSlide1 { 0%,100% { width: 6px; x: 5; } 50% { width: 8px; x: 4; } }
        @keyframes ganttSlide2 { 0%,100% { width: 5px; x: 6.5; } 50% { width: 7px; x: 5.5; } }
        @keyframes ganttSlide3 { 0%,100% { width: 7px; x: 4; } 50% { width: 5px; x: 6; } }
      `}</style>
      <line x1="3" y1="2.5" x2="3" y2="13.5" />
      <line x1="2" y1="13.5" x2="14" y2="13.5" />
      <rect className="gantt-bar gantt-bar1" x="5" y="3.5" width="6" height="2" rx="1" />
      <rect className="gantt-bar gantt-bar2" x="6.5" y="6.5" width="5" height="2" rx="1" />
      <rect className="gantt-bar gantt-bar3" x="4" y="9.5" width="7" height="2" rx="1" />
    </svg>
  )
  if (name === 'confluence') return <svg {...common}><path d="M3.5 5.5l3-2 2.2 2.2-3 2z" /><path d="M7.5 8.3l3-2 2 2-3 2z" /><path d="M4.5 10.5l2.8 2-2 2-2.8-2z" /></svg>
  if (name === 'teams') return <svg {...common}><circle cx="6" cy="6" r="2" /><circle cx="11.5" cy="6.5" r="1.5" /><path d="M3.5 12.8c.6-1.5 1.9-2.3 3.5-2.3 1.7 0 3 .8 3.6 2.3" /></svg>
  if (name === 'more') return <svg {...common}><circle cx="4" cy="8" r="1" /><circle cx="8" cy="8" r="1" /><circle cx="12" cy="8" r="1" /></svg>
  if (name === 'filters') return <svg {...common}><path d="M2.5 4h11" /><path d="M5 8h6" /><path d="M6.5 12h3" /></svg>
  if (name === 'dashboards') return <svg {...common}><rect x="3" y="3" width="10" height="10" /><path d="M8 3v10M3 8h10" /></svg>
  if (name === 'workflow') return <svg {...common}><circle cx="3.5" cy="8" r="1.8" /><circle cx="12.5" cy="4" r="1.8" /><circle cx="12.5" cy="12" r="1.8" /><path d="M5.3 7.2l5.4-2.4M5.3 8.8l5.4 2.4" /></svg>
  return <svg {...common}><circle cx="8" cy="8" r="5" /></svg>
}
