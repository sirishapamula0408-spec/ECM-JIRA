const DAY_MS = 24 * 60 * 60 * 1000
const SOON_WINDOW_DAYS = 3

// Parses a due-date value (Date, 'YYYY-MM-DD', or ISO timestamp) to a local
// midnight Date, avoiding UTC off-by-one shifts for date-only strings.
export function parseDueDate(value) {
  if (!value) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate())
  }
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
}

// Returns 'overdue' | 'soon' | 'later' | null for a due date.
// 'soon' means due today or within the next 3 days.
export function dueStatus(dueDate, now = new Date()) {
  const due = parseDueDate(dueDate)
  if (!due) return null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((due.getTime() - today.getTime()) / DAY_MS)
  if (diffDays < 0) return 'overdue'
  if (diffDays <= SOON_WINDOW_DAYS) return 'soon'
  return 'later'
}
