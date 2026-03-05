export function TopNavIcon({ name }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }

  if (name === 'summary') return <svg {...common}><circle cx="8" cy="8" r="5" /><circle cx="8" cy="8" r="1.5" /></svg>
  if (name === 'backlog') return <svg {...common}><path d="M3 5h10M3 8h10M3 11h10" /></svg>
  if (name === 'board') return <svg {...common}><rect x="3" y="4" width="10" height="8" /><path d="M7.5 4v8M10.5 4v8" /></svg>
  if (name === 'active-sprints') return <svg {...common}><rect x="3" y="4" width="10" height="8" /><path d="M7.5 4v8M10.5 4v8" /></svg>
  if (name === 'calendar') return <svg {...common}><rect x="3" y="4" width="10" height="9" rx="1.5" /><path d="M3 6.5h10M6 3v2.5M10 3v2.5" /></svg>
  if (name === 'timeline') return <svg {...common}><path d="M3 8h10" /><circle cx="5" cy="8" r="1" /><circle cx="8" cy="8" r="1" /><circle cx="11" cy="8" r="1" /></svg>
  if (name === 'pages') return <svg {...common}><rect x="4" y="3" width="8" height="10" rx="1" /><path d="M6 6h4M6 8h4M6 10h3" /></svg>
  if (name === 'forms') return <svg {...common}><path d="M4 4h8M4 8h8M4 12h8" /><circle cx="3" cy="4" r=".6" fill="currentColor" /><circle cx="3" cy="8" r=".6" fill="currentColor" /><circle cx="3" cy="12" r=".6" fill="currentColor" /></svg>
  if (name === 'reports') return <svg {...common}><path d="M3 12.5h10" /><path d="M4.5 10V7.5" /><path d="M8 10V5.5" /><path d="M11.5 10V6.5" /></svg>
  if (name === 'list') return <svg {...common}><path d="M5.5 4h7M5.5 8h7M5.5 12h7" /><circle cx="3.5" cy="4" r=".6" fill="currentColor" stroke="none" /><circle cx="3.5" cy="8" r=".6" fill="currentColor" stroke="none" /><circle cx="3.5" cy="12" r=".6" fill="currentColor" stroke="none" /></svg>
  if (name === 'filter') return <svg {...common}><path d="M3 4h10M5 8h6M7 12h2" /></svg>
  return <svg {...common}><circle cx="8" cy="8" r="5" /></svg>
}
