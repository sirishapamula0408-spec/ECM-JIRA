// JL-386: derive a deterministic avatar colour per user.
//
// Every avatar in the app rendered on the same fixed blue (`--jira-blue`), so
// the two-letter initials were the only thing distinguishing one person from
// another — a column of avatars in the backlog was uniformly blue. Atlassian
// Jira derives a stable colour per user, which is what makes avatars scannable
// in a list or on a board.
//
// Two deliberate choices:
//
//  1. A *helper*, not a shared <Avatar> component. The ~20 avatar call sites use
//     at least six different markup shapes (MUI <Avatar>, `.member-avatar`
//     spans, `.avatar-preview` divs, the stacked `.id-presence-avatar` pills
//     that carry their own zIndex, the `.jira-list-presence` wrapper, …), each
//     with its own size, radius, font and title/aria wiring. Replacing all of
//     that with one component would rewrite markup this ticket is not scoped to
//     touch and would risk the sizing/typography the ticket says to leave
//     alone. A helper adds exactly one `style` prop per site — colour only.
//
//  2. The returned colours are `var(--avatar-bg-N, <hex>)` references rather
//     than raw hex, so light/dark theming is handled by the stylesheet
//     (`variables.css` for light, `.app-theme-dark` in `theme.css` for dark)
//     without every call site having to consume ThemeContext. The hex literal
//     is the light-theme value, used as the var() fallback so the colour still
//     resolves if the token is ever missing.
//
// Determinism: the colour comes from an FNV-1a hash of a stable identifier —
// never Math.random() and never the array index. Index-based colouring is
// exactly the class of bug JL-345 fixed for chart slices: the index shifts the
// moment a list is filtered or sorted, so a user's colour would change under
// them. Hashing the identity makes the colour a property of the person.

/**
 * The palette. Eight hues, each with a light-theme and a dark-theme pairing of
 * background + foreground.
 *
 * Light entries are deep Atlassian-style fills carrying white text; dark
 * entries are the soft tints carrying dark text, which is what keeps them
 * legible against the `#1D2125` dark canvas. Every pairing is >= 4.5:1 (WCAG AA
 * for normal text); the measured floor is 5.93:1 (light) and 6.92:1 (dark).
 * `AvatarColour.JL386.test.jsx` recomputes the ratios from these values rather
 * than asserting a hardcoded list, so adding a ninth hue cannot silently ship a
 * failing contrast.
 */
export const AVATAR_PALETTE = [
  { name: 'blue', light: { bg: '#0747A6', fg: '#FFFFFF' }, dark: { bg: '#9CC3FF', fg: '#172B4D' } },
  { name: 'purple', light: { bg: '#403294', fg: '#FFFFFF' }, dark: { bg: '#C0B6F2', fg: '#172B4D' } },
  { name: 'teal', light: { bg: '#206B74', fg: '#FFFFFF' }, dark: { bg: '#8FDDE7', fg: '#172B4D' } },
  { name: 'green', light: { bg: '#216E4E', fg: '#FFFFFF' }, dark: { bg: '#7EE2B8', fg: '#172B4D' } },
  { name: 'yellow', light: { bg: '#7F5F01', fg: '#FFFFFF' }, dark: { bg: '#F5CD47', fg: '#172B4D' } },
  { name: 'orange', light: { bg: '#A54800', fg: '#FFFFFF' }, dark: { bg: '#FEC195', fg: '#172B4D' } },
  { name: 'red', light: { bg: '#AE2E24', fg: '#FFFFFF' }, dark: { bg: '#FF9C8F', fg: '#172B4D' } },
  { name: 'magenta', light: { bg: '#943D73', fg: '#FFFFFF' }, dark: { bg: '#F797D2', fg: '#172B4D' } },
]

/** Canvas colours the palette is expected to sit on, asserted by the tests. */
export const AVATAR_SURFACE = { light: '#FFFFFF', dark: '#1D2125' }

/**
 * Reduce whatever a call site has into one stable identity string.
 *
 * Preference order is id -> email -> display name, per the ticket: an id is the
 * most stable thing a user has, an email is the next most stable, and a display
 * name is the last resort for the handful of sites that only ever receive one
 * (issue.assignee, for instance, is a member *name*).
 *
 * The prefix keeps the id/email/name spaces from colliding, so user #7 and a
 * user literally named "7" are not forced onto the same colour.
 *
 * Returns '' when there is nothing to key on — callers must not throw on that.
 */
export function avatarIdentity(user) {
  if (user === null || user === undefined) return ''

  // A bare string/number is the common "we only have the assignee name" case.
  if (typeof user === 'string' || typeof user === 'number') {
    const value = String(user).trim().toLowerCase()
    return value ? `name:${value}` : ''
  }

  if (typeof user !== 'object') return ''

  const id = user.id ?? user.user_id ?? user.userId
  if (id !== null && id !== undefined && String(id).trim() !== '') {
    return `id:${String(id).trim()}`
  }

  const email = String(user.email ?? '').trim().toLowerCase()
  if (email) return `email:${email}`

  const name = String(user.name ?? user.full_name ?? user.actor ?? '').trim().toLowerCase()
  if (name) return `name:${name}`

  return ''
}

/**
 * FNV-1a (32-bit). Chosen because it is tiny, dependency-free and spreads short
 * ASCII strings well — a plain charCode sum would map "AB" and "BA" together
 * and cluster similar emails onto one colour.
 */
export function hashIdentity(value) {
  let hash = 0x811c9dc5
  const text = String(value ?? '')
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * Palette slot for a user. Always a valid index: an unidentifiable user gets
 * slot 0 rather than an exception, so a half-loaded row still paints.
 */
export function avatarColourIndex(user) {
  const identity = avatarIdentity(user)
  if (!identity) return 0
  return hashIdentity(identity) % AVATAR_PALETTE.length
}

/**
 * The style object to spread onto an avatar element:
 *   `style={avatarStyle(member)}`
 *
 * Only `background` and `color` — size, radius and typography stay with the
 * element's existing class, which is what keeps this a colour-only change.
 */
export function avatarStyle(user) {
  const index = avatarColourIndex(user)
  const entry = AVATAR_PALETTE[index]
  return {
    background: `var(--avatar-bg-${index}, ${entry.light.bg})`,
    color: `var(--avatar-fg-${index}, ${entry.light.fg})`,
  }
}
