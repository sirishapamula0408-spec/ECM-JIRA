/*
 * JL-152 — Confluence Lite icon set.
 *
 * ORIGINAL ARTWORK. None of these reproduce an Atlassian mark, logo or
 * promotional panel. They follow the house style already used across the app's
 * inline SVGs: a 20x20 or 16x16 viewBox, 1.5–2px `currentColor` strokes,
 * rounded caps and joins, no fills except where a shape reads better solid.
 *
 * `currentColor` throughout, so a row's icon inherits its text colour in every
 * state — hover, active, muted — and works in both themes without a second
 * definition. This module exports ONLY components
 * (react-refresh/only-export-components is an error in this repo).
 */

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

function Svg({ size = 20, children, className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      {...STROKE}
    >
      {children}
    </svg>
  )
}

/** "For you" — a bookmark-ribbon, the personal-shelf idea without a face. */
export function ForYouIcon(props) {
  return (
    <Svg {...props}>
      <path d="M5.5 3.5h9v13l-4.5-3.2-4.5 3.2v-13Z" />
    </Svg>
  )
}

/** "Recent" — a clock. */
export function RecentIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="10" r="6.75" />
      <path d="M10 6.2V10l2.6 1.7" />
    </Svg>
  )
}

/** "Starred" — an outline star. */
export function StarIcon(props) {
  return (
    <Svg {...props}>
      <path d="m10 3.4 2.02 4.09 4.52.66-3.27 3.18.77 4.49L10 13.7l-4.04 2.12.77-4.49L3.46 8.15l4.52-.66L10 3.4Z" />
    </Svg>
  )
}

/** "Starred", filled — the same star, for the active state. */
export function StarFilledIcon(props) {
  return (
    <Svg {...props}>
      <path
        d="m10 3.4 2.02 4.09 4.52.66-3.27 3.18.77 4.49L10 13.7l-4.04 2.12.77-4.49L3.46 8.15l4.52-.66L10 3.4Z"
        fill="currentColor"
      />
    </Svg>
  )
}

/** "Spaces" — four panes, the same idea as the Spaces directory's empty state. */
export function SpacesIcon(props) {
  return (
    <Svg {...props}>
      <rect x="3.25" y="3.25" width="6" height="6" rx="1.5" />
      <rect x="10.75" y="3.25" width="6" height="6" rx="1.5" />
      <rect x="3.25" y="10.75" width="6" height="6" rx="1.5" />
      <rect x="10.75" y="10.75" width="6" height="6" rx="1.5" />
    </Svg>
  )
}

/** "Apps" — a plug/extension block. */
export function AppsIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4 7.5h4.25V4a1.5 1.5 0 0 1 3 0v3.5H16v4.25h-1.5a1.75 1.75 0 1 0 0 3.5H16V16H4V7.5Z" />
    </Svg>
  )
}

/** A page/document, used on every card and feed row. */
export function DocumentIcon(props) {
  return (
    <Svg {...props}>
      <path d="M5.5 3.5h6L15 7v9.5H5.5v-13Z" />
      <path d="M11.25 3.6V7h3.4" />
      <path d="M7.75 10.5h4.5M7.75 13h3" />
    </Svg>
  )
}

/** A right chevron; rotated by CSS when its section is expanded. */
export function ChevronIcon(props) {
  return (
    <Svg {...props}>
      <path d="m8 5.5 4.5 4.5L8 14.5" />
    </Svg>
  )
}

/** A down caret for the sort dropdown trigger. */
export function CaretDownIcon(props) {
  return (
    <Svg {...props}>
      <path d="m5.75 8 4.25 4.25L14.25 8" />
    </Svg>
  )
}

/** Two figures — the "invite teammates" empty-state action. */
export function TeammatesIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="7.75" cy="7" r="2.75" />
      <path d="M3 16.25c0-2.35 2.13-4.25 4.75-4.25s4.75 1.9 4.75 4.25" />
      <path d="M13.5 5.1a2.75 2.75 0 0 1 0 5.3M14.4 12.3c1.6.62 2.6 1.95 2.6 3.95" />
    </Svg>
  )
}

/** A folder — the Document Store's folder rows (JL-169). */
export function FolderIcon(props) {
  return (
    <Svg {...props}>
      <path d="M3.25 6.25c0-.83.67-1.5 1.5-1.5h2.9c.4 0 .78.16 1.06.44l1.12 1.12h5.42c.83 0 1.5.67 1.5 1.5v6.44c0 .83-.67 1.5-1.5 1.5H4.75c-.83 0-1.5-.67-1.5-1.5V6.25Z" />
    </Svg>
  )
}

/** A plus — "create", on the Spaces section header (JL-156). */
export function PlusIcon(props) {
  return (
    <Svg {...props}>
      <path d="M10 4.75v10.5M4.75 10h10.5" />
    </Svg>
  )
}

/** A waste bin — the per-Space delete control (JL-156). */
export function TrashIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4.5 6.25h11" />
      <path d="M8.25 6.25V4.9c0-.5.4-.9.9-.9h1.7c.5 0 .9.4.9.9v1.35" />
      <path d="M6.1 6.25l.6 8.7c.04.58.52 1.05 1.1 1.05h4.4c.58 0 1.06-.47 1.1-1.05l.6-8.7" />
      <path d="M8.9 9v4.2M11.1 9v4.2" />
    </Svg>
  )
}

/** A collapse handle for the wiki sidebar — the sidebar's own chevrons. */
export function CollapsePanelIcon(props) {
  return (
    <Svg {...props}>
      <path d="m11 5.5-4.5 4.5 4.5 4.5" />
      <path d="M15 4.25v11.5" />
    </Svg>
  )
}
