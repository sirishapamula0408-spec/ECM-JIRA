// JL-483: calendar-day helpers for the Create / Edit sprint dialog.
// Days are YYYY-MM-DD strings, the shape the API takes (startDate / endDate).
// Arithmetic is done in UTC so a day never shifts across a DST change.

export const SPRINT_DURATIONS = [
  { value: '1', label: '1 week', days: 7 },
  { value: '2', label: '2 weeks', days: 14 },
  { value: '3', label: '3 weeks', days: 21 },
  { value: '4', label: '4 weeks', days: 28 },
  { value: 'custom', label: 'Custom' },
]

/** Today as YYYY-MM-DD in the user's local calendar. */
export function todayDay(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** `day` plus `n` days, or '' when `day` is not a YYYY-MM-DD date. */
export function addDays(day, n) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return ''
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  date.setUTCDate(date.getUTCDate() + n)
  return date.toISOString().slice(0, 10)
}

/** A stored timestamp (or YYYY-MM-DD) → its YYYY-MM-DD day, or ''. */
export function toDay(value) {
  if (!value) return ''
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

/** The duration option a start/end pair matches (1–4 weeks), else 'custom'. */
export function inferDuration(startDay, endDay) {
  if (!startDay || !endDay) return 'custom'
  const match = SPRINT_DURATIONS.find((d) => d.days && addDays(startDay, d.days) === endDay)
  return match ? match.value : 'custom'
}

/** The end day a duration gives from `startDay` ('' for custom / no start). */
export function endForDuration(startDay, duration) {
  const option = SPRINT_DURATIONS.find((d) => d.value === duration)
  return option?.days && startDay ? addDays(startDay, option.days) : ''
}
