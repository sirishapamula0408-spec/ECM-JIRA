// Atlassian-style cog: 8-tooth gear ring with a hollow centre. Deliberately
// distinct from the `sun` glyph (plain circle + radiating rays) so that a
// "configure" affordance is never mistaken for the theme toggle.
export const COG_TEETH_PATH =
  'M6.82 3.61L7.07 1.77L8.93 1.77L9.18 3.61A4.55 4.55 0 0 1 10.28 4.06L11.75 2.94L13.06 4.25L11.94 5.73' +
  'A4.55 4.55 0 0 1 12.39 6.82L14.23 7.07L14.23 8.93L12.39 9.18A4.55 4.55 0 0 1 11.94 10.27L13.06 11.75' +
  'L11.75 13.06L10.28 11.94A4.55 4.55 0 0 1 9.18 12.39L8.93 14.23L7.07 14.23L6.82 12.39' +
  'A4.55 4.55 0 0 1 5.73 11.94L4.25 13.06L2.94 11.75L4.06 10.27A4.55 4.55 0 0 1 3.61 9.18L1.77 8.93' +
  'L1.77 7.07L3.61 6.82A4.55 4.55 0 0 1 4.06 5.72L2.94 4.25L4.25 2.94L5.72 4.06A4.55 4.55 0 0 1 6.82 3.61Z'

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
  if (name === 'settings' || name === 'cog') return <svg {...common}><path d={COG_TEETH_PATH} /><circle cx="8" cy="8" r="2.05" /></svg>
  if (name === 'profile') return <svg {...common}><circle cx="8" cy="5.6" r="2.2" /><path d="M3.5 12.6c.8-2 2.4-3 4.5-3s3.8 1 4.5 3" /></svg>
  if (name === 'account') return <svg {...common}><circle cx="8" cy="8" r="2.1" /><path d="M8 3.4v1.1M8 11.5v1.1M12.6 8h-1.1M4.5 8H3.4M11.1 4.9l-.8.8M5.7 10.3l-.8.8M11.1 11.1l-.8-.8M5.7 5.7l-.8-.8" /></svg>
  if (name === 'theme') return <svg {...common}><path d="M10.8 2.8A5.5 5.5 0 1 0 13.2 11 5 5 0 0 1 10.8 2.8Z" /></svg>
  if (name === 'sun') return <svg {...common}><circle cx="8" cy="8" r="2.6" /><path d="M8 1.8v1.4M8 12.8v1.4M14.2 8h-1.4M3.2 8H1.8M12.4 3.6l-1 1M4.6 11.4l-1 1M12.4 12.4l-1-1M4.6 4.6l-1-1" /></svg>
  if (name === 'quickstart') return <svg {...common}><path d="M7 2.8 3.8 8h2.4L5.5 13.2 10.8 7.2H8.3L9.7 2.8Z" /></svg>
  if (name === 'switch') return <svg {...common}><path d="M4 5.2h7.5M9.8 3l2.2 2.2-2.2 2.2M12 10.8H4.5M6.2 8.6 4 10.8 6.2 13" /></svg>
  if (name === 'logout') return <svg {...common}><path d="M6 3H3.8A1.3 1.3 0 0 0 2.5 4.3v7.4A1.3 1.3 0 0 0 3.8 13H6" /><path d="M8.8 10.8 12 8 8.8 5.2M12 8H5.5" /></svg>
  return <svg {...common}><circle cx="8" cy="8" r="5" /></svg>
}
