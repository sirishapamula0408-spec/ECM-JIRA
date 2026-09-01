// JL-421/JL-422 — presentation helpers shared by the team directory and the
// team profile.
//
// They live here rather than being exported from a page component because
// `react-refresh/only-export-components` is an ERROR in this repo: a module
// that exports both a component and a constant opts out of Vite fast refresh.
// Same reasoning as the JL-407 context split.

/**
 * The two membership modes, with the difference spelled out in plain words.
 * "OPEN" and "MEMBER_INVITE" mean nothing to someone meeting them for the first
 * time (JL-431), so the label carries the explanation, not just the enum.
 */
export const MEMBERSHIP_OPTIONS = [
  {
    value: 'OPEN',
    label: 'Open — anyone in the workspace can join',
    hint: 'People add themselves from the team page.',
  },
  {
    value: 'MEMBER_INVITE',
    label: 'Invite only — a team lead adds people',
    hint: 'There is no self-join; a lead adds each person.',
  },
]

/** Two-letter initials, the shape the rest of the app's avatars use. */
export function teamInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** "1 member" / "N members" — used on the card and in the profile header. */
export function memberCountLabel(count) {
  const n = Number(count) || 0
  return n === 1 ? '1 member' : `${n} members`
}
