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

export function displayNameFromEmail(email) {
  const local = String(email || '').split('@')[0] || ''
  if (!local) return 'User'
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
