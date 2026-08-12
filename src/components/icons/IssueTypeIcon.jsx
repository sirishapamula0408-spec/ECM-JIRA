// JL-385: coloured issue-type glyph, matching the Atlassian Jira convention —
// a small rounded square in the type's conventional colour with a white symbol.
// Sized for inline use beside a title in a dense list (Board card, Backlog row).
//
// Issue type is meaningful information, not decoration, so the type name is
// exposed to assistive technology via role="img" + aria-label (the same
// pattern the SVG chart components use). Do NOT add aria-hidden here.

const TYPE_GLYPHS = {
  // Purple, lightning bolt
  Epic: {
    color: '#904EE2',
    glyph: <path d="M9.4 3.2 5.1 9h2.7l-1.2 3.8L10.9 7H8.2l1.2-3.8Z" fill="#fff" />,
  },
  // Green, bookmark
  Story: {
    color: '#36B37E',
    glyph: (
      <path
        d="M5 4.6c0-.33.27-.6.6-.6h4.8c.33 0 .6.27.6.6V12L8 9.7 5 12V4.6Z"
        fill="#fff"
      />
    ),
  },
  // Red, filled circle
  Bug: {
    color: '#E5493A',
    glyph: <circle cx="8" cy="8" r="3" fill="#fff" />,
  },
  // Blue, checkmark
  Task: {
    color: '#4BADE8',
    glyph: (
      <path
        d="M4.5 8.4 7 10.9l4.5-5.8"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  // Blue-ish, nested squares (parent outline + filled child)
  'Sub-task': {
    color: '#2684FF',
    glyph: (
      <>
        <path d="M4 4h5.5v1.8H5.8v3.7H4V4Z" fill="#fff" />
        <rect x="7" y="7" width="5" height="5" rx="0.8" fill="#fff" />
      </>
    ),
  },
}

// Neutral fallback for an unknown or missing type — never throws.
const FALLBACK = {
  color: '#626F86',
  glyph: <circle cx="8" cy="8" r="2.8" fill="none" stroke="#fff" strokeWidth="1.6" />,
}

export function IssueTypeIcon({ type, size = 14 }) {
  const entry = (type && TYPE_GLYPHS[type]) || FALLBACK
  const label = typeof type === 'string' && type.trim() ? type : 'Unknown issue type'

  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      style={{ display: 'inline-block', verticalAlign: 'text-bottom', flexShrink: 0 }}
    >
      <rect x="0" y="0" width="16" height="16" rx="3" fill={entry.color} />
      {entry.glyph}
    </svg>
  )
}
