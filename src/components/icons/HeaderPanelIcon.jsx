export function HeaderPanelIcon({ name }) {
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

  if (name === 'notifications') return <svg {...common}><path d="M8 2.8a3.3 3.3 0 0 0-3.3 3.3v1.7L3.6 10v1h8.8v-1l-1.1-2.2V6.1A3.3 3.3 0 0 0 8 2.8Z" /><path d="M6.6 12.2a1.6 1.6 0 0 0 2.8 0" /></svg>
  if (name === 'help') return <svg {...common}><circle cx="8" cy="8" r="5.5" /><path d="M6.8 6.6a1.4 1.4 0 1 1 2.1 1.2c-.6.3-.9.6-.9 1.2" /><circle cx="8" cy="11.1" r=".6" fill="currentColor" stroke="none" /></svg>
  if (name === 'settings') return <svg {...common}><circle cx="8" cy="8" r="1.9" /><path d="M8 2.5v1.4M8 12.1v1.4M12.1 8h1.4M2.5 8h1.4M11.2 4.8l1 1M3.8 11.2l1 1M11.2 11.2l1-1M3.8 4.8l1 1" /></svg>
  if (name === 'profile') return <svg {...common}><circle cx="8" cy="5.6" r="2.2" /><path d="M3.5 12.6c.8-2 2.4-3 4.5-3s3.8 1 4.5 3" /></svg>
  if (name === 'account') return <svg {...common}><circle cx="8" cy="8" r="2.1" /><path d="M8 3.4v1.1M8 11.5v1.1M12.6 8h-1.1M4.5 8H3.4M11.1 4.9l-.8.8M5.7 10.3l-.8.8M11.1 11.1l-.8-.8M5.7 5.7l-.8-.8" /></svg>
  if (name === 'theme') return <svg {...common}><path d="M10.8 2.8A5.5 5.5 0 1 0 13.2 11 5 5 0 0 1 10.8 2.8Z" /></svg>
  if (name === 'quickstart') return <svg {...common}><path d="M7 2.8 3.8 8h2.4L5.5 13.2 10.8 7.2H8.3L9.7 2.8Z" /></svg>
  if (name === 'switch') return <svg {...common}><path d="M4 5.2h7.5M9.8 3l2.2 2.2-2.2 2.2M12 10.8H4.5M6.2 8.6 4 10.8 6.2 13" /></svg>
  if (name === 'logout') return <svg {...common}><path d="M6 3H3.8A1.3 1.3 0 0 0 2.5 4.3v7.4A1.3 1.3 0 0 0 3.8 13H6" /><path d="M8.8 10.8 12 8 8.8 5.2M12 8H5.5" /></svg>
  return <svg {...common}><circle cx="8" cy="8" r="5" /></svg>
}
