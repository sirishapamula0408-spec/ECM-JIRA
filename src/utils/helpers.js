export function getActivityVisual(actionText) {
  const text = String(actionText || '').toLowerCase()
  if (text.includes('moved')) return { glyph: '->', kind: 'moved' }
  if (text.includes('comment')) return { glyph: 'C', kind: 'comment' }
  if (text.includes('created')) return { glyph: '+', kind: 'created' }
  if (text.includes('closed')) return { glyph: 'x', kind: 'closed' }
  if (text.includes('attach')) return { glyph: '@', kind: 'attached' }
  return { glyph: 'i', kind: 'default' }
}

export function parseStoredAuthUser() {
  try {
    const raw = window.localStorage.getItem('jira_auth_user') || window.sessionStorage.getItem('jira_auth_user')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// JL-353: shared avatar-initials helper. Derives up to two initials from a
// display name ("Priya Kumar" -> "PK"); single-word names use their first two
// letters ("Sara" -> "SA"); empty input falls back to "U". Extracted from the
// inline logic in IssueListPage so the backlog toolbar avatars (and any future
// avatar) reuse one implementation instead of growing another copy.
export function initialsFromName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  const raw = (parts[0]?.[0] || '') + (parts[1]?.[0] || parts[0]?.[1] || '')
  return (raw || 'U').toUpperCase()
}

export function displayNameFromEmail(email) {
  const local = String(email || '').split('@')[0] || ''
  if (!local) return 'User'
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
