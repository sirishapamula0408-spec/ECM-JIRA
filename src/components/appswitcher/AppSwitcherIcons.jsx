/*
 * JL-151 — app-switcher artwork.
 *
 * ORIGINAL ARTWORK, DELIBERATELY. None of these reproduce Atlassian's Jira,
 * Confluence or Rovo marks (or any other third-party product mark). They only
 * follow the same *pattern* a product tile follows anywhere: a rounded square
 * filled with one saturated colour and a simple geometric white glyph, no text.
 *
 * COLOUR SOURCE. Each tile's BACKGROUND is a token from
 * `src/styles/variables.css`; the glyphs on top of it are plain #ffffff,
 * which is not a themed value — a tile keeps its own colours in dark mode.
 *   - JIRA Lite takes --jira-blue, the product's own primary.
 *   - Confluence Lite takes --avatar-bg-2 (#206B74, teal). The palette has no
 *     "second product accent" tier, and the avatar palette is the only vetted
 *     set of saturated hues in the file that is documented with its contrast
 *     ratio against white (6.15:1) — which is exactly the guarantee a tile with
 *     a white glyph on it needs. Inventing a new one-off teal was the
 *     alternative and is what the brief rules out.
 *
 * This module exports ONLY components (react-refresh/only-export-components is
 * an error in this repo); the app list that references them lives next door in
 * `appSwitcherApps.js`.
 */

/**
 * The "waffle" glyph on the trigger button: a 3x3 grid of dots.
 * `currentColor` so it inherits the button's text colour, including the
 * selected state.
 */
export function AppSwitcherGridIcon() {
  const dots = [4, 10, 16]
  return (
    <svg
      className="app-switcher-grid-icon"
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {dots.map((cy) => dots.map((cx) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" />
      )))}
    </svg>
  )
}

/**
 * JIRA Lite — three white board columns of unequal height (a kanban board seen
 * end-on). Geometric, no lettering, and not a derivative of any existing mark.
 */
export function JiraLiteAppIcon() {
  return (
    <svg
      className="app-switcher-tile-icon"
      viewBox="0 0 32 32"
      width="32"
      height="32"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="6" fill="var(--jira-blue)" />
      <rect x="7" y="9" width="4.5" height="14" rx="1.5" fill="#ffffff" />
      <rect x="13.75" y="9" width="4.5" height="9" rx="1.5" fill="#ffffff" opacity="0.75" />
      <rect x="20.5" y="9" width="4.5" height="5" rx="1.5" fill="#ffffff" opacity="0.55" />
    </svg>
  )
}

/**
 * Confluence Lite — a white page with three text lines and a folded corner.
 * A document, which is what the wiki is; again original geometry.
 */
export function ConfluenceLiteAppIcon() {
  return (
    <svg
      className="app-switcher-tile-icon"
      viewBox="0 0 32 32"
      width="32"
      height="32"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="6" fill="var(--avatar-bg-2)" />
      <path
        d="M10 7.5h8.5L23 12v12.5a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z"
        fill="#ffffff"
      />
      <path d="M18.5 7.5 23 12h-4.5V7.5Z" fill="#ffffff" opacity="0.6" />
      <rect x="11.75" y="15" width="8.5" height="1.6" rx="0.8" fill="var(--avatar-bg-2)" />
      <rect x="11.75" y="18.2" width="8.5" height="1.6" rx="0.8" fill="var(--avatar-bg-2)" />
      <rect x="11.75" y="21.4" width="5.5" height="1.6" rx="0.8" fill="var(--avatar-bg-2)" />
    </svg>
  )
}

/** The tick shown against the app the user is currently in. */
export function AppSwitcherCheckIcon() {
  return (
    <svg
      className="app-switcher-check"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.5 8.4l3 3 6-6.8" />
    </svg>
  )
}
