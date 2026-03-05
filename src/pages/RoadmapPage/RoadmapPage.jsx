import { useMemo, useState, useRef, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAppData } from '../../context/AppDataContext'
import { useIssues } from '../../context/IssueContext'
import { useSprints } from '../../context/SprintContext'
import { ISSUE_STATUSES } from '../../constants'
import './RoadmapPage.css'

/* ── helpers ── */

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const WEEK_PX = 48 // pixels per week column

function parseShortDate(str) {
  // Handles "Oct 5", "Nov 22", etc. — assumes current/next year context
  if (!str) return null
  const parts = String(str).trim().split(/\s+/)
  if (parts.length < 2) return null
  const monthIdx = MONTH_NAMES.findIndex((m) => m.toLowerCase() === parts[0].slice(0, 3).toLowerCase())
  if (monthIdx === -1) return null
  const day = parseInt(parts[1], 10)
  if (isNaN(day)) return null
  const now = new Date()
  let year = now.getFullYear()
  const d = new Date(year, monthIdx, day)
  // If the date is more than 6 months in the past, assume next year
  if (d < new Date(now.getFullYear(), now.getMonth() - 6, 1)) year += 1
  return new Date(year, monthIdx, day)
}

function startOfWeek(d) {
  const date = new Date(d)
  const day = date.getDay()
  date.setDate(date.getDate() - day)
  date.setHours(0, 0, 0, 0)
  return date
}

function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function diffDays(a, b) {
  return Math.round((b - a) / (1000 * 60 * 60 * 24))
}

function statusClass(status) {
  if (!status) return 'tl-status-todo'
  const s = String(status).toLowerCase().replace(/\s+/g, '')
  if (s === 'done') return 'tl-status-done'
  if (s === 'inprogress') return 'tl-status-inprogress'
  if (s === 'codereview') return 'tl-status-review'
  if (s === 'backlog') return 'tl-status-backlog'
  if (s === 'atrisk' || s === 'at risk') return 'tl-status-atrisk'
  if (s === 'planned') return 'tl-status-planned'
  return 'tl-status-todo'
}

function barClass(status) {
  if (!status) return 'tl-bar--todo'
  const s = String(status).toLowerCase().replace(/\s+/g, '')
  if (s === 'done') return 'tl-bar--done'
  if (s === 'inprogress') return 'tl-bar--inprogress'
  if (s === 'codereview') return 'tl-bar--review'
  if (s === 'backlog') return 'tl-bar--backlog'
  if (s === 'atrisk' || s === 'at risk') return 'tl-bar--atrisk'
  if (s === 'planned') return 'tl-bar--planned'
  return 'tl-bar--todo'
}

function statusLabel(status) {
  if (!status) return 'TO DO'
  const s = String(status).toLowerCase().replace(/\s+/g, '')
  if (s === 'done') return 'DONE'
  if (s === 'inprogress') return 'IN PROGRESS'
  if (s === 'codereview') return 'IN REVIEW'
  if (s === 'backlog') return 'BACKLOG'
  if (s === 'atrisk' || s === 'at risk') return 'AT RISK'
  if (s === 'planned') return 'PLANNED'
  return status.toUpperCase()
}

/* ── component ── */

export function RoadmapPage() {
  const { roadmap } = useAppData()
  const { issues } = useIssues()
  const { sprints } = useSprints()
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState({})
  const [viewMode, setViewMode] = useState('months')
  const rightRef = useRef(null)
  const leftBodyRef = useRef(null)

  // Parse epics with real dates, filtered by project when in project context
  const epics = useMemo(() => {
    const all = Array.isArray(roadmap) ? roadmap : []
    const scoped = projectId ? all.filter((epic) => epic.project_id === Number(projectId)) : all
    return scoped.map((epic) => ({
      ...epic,
      startDate: parseShortDate(epic.start_date),
      endDate: parseShortDate(epic.end_date),
    }))
  }, [roadmap, projectId])

  // Map issues to epics heuristically (distribute across epics by index)
  const issueList = useMemo(() => {
    const all = Array.isArray(issues) ? issues : []
    return projectId ? all.filter((issue) => issue.projectId === Number(projectId)) : all
  }, [issues, projectId])

  const epicChildren = useMemo(() => {
    const map = {}
    epics.forEach((ep) => { map[ep.id] = [] })
    if (epics.length > 0) {
      issueList.forEach((issue, i) => {
        const epicIdx = i % epics.length
        const epic = epics[epicIdx]
        if (epic && map[epic.id]) {
          map[epic.id].push(issue)
        }
      })
    }
    return map
  }, [epics, issueList])

  // Compute timeline range
  const { timelineStart, timelineEnd, weeks, months } = useMemo(() => {
    let minDate = null
    let maxDate = null
    epics.forEach((ep) => {
      if (ep.startDate && (!minDate || ep.startDate < minDate)) minDate = ep.startDate
      if (ep.endDate && (!maxDate || ep.endDate > maxDate)) maxDate = ep.endDate
    })
    if (!minDate) minDate = new Date()
    if (!maxDate) maxDate = addDays(minDate, 90)

    // Add 2 weeks padding on each side
    const tlStart = startOfWeek(addDays(minDate, -14))
    const tlEnd = addDays(startOfWeek(maxDate), 21)

    // Build weeks array
    const wks = []
    let cursor = new Date(tlStart)
    while (cursor < tlEnd) {
      wks.push(new Date(cursor))
      cursor = addDays(cursor, 7)
    }

    // Build months array
    const mos = []
    wks.forEach((wk) => {
      const mKey = `${wk.getFullYear()}-${wk.getMonth()}`
      const last = mos[mos.length - 1]
      if (last && last.key === mKey) {
        last.weekCount++
      } else {
        mos.push({ key: mKey, label: MONTH_NAMES[wk.getMonth()] + ' ' + wk.getFullYear(), weekCount: 1 })
      }
    })

    return { timelineStart: tlStart, timelineEnd: tlEnd, weeks: wks, months: mos }
  }, [epics])

  const totalWidth = weeks.length * WEEK_PX

  // Position helpers
  function dateToX(date) {
    if (!date) return 0
    const days = diffDays(timelineStart, date)
    return (days / 7) * WEEK_PX
  }

  function barStyle(startDate, endDate) {
    if (!startDate || !endDate) return { display: 'none' }
    const left = Math.max(0, dateToX(startDate))
    const right = dateToX(endDate)
    const width = Math.max(right - left, 24)
    return { left: `${left}px`, width: `${width}px` }
  }

  // Assign child issues approximate dates within their epic's range
  function childBarStyle(epic, childIndex, childCount) {
    if (!epic.startDate || !epic.endDate) return { display: 'none' }
    const epicDays = diffDays(epic.startDate, epic.endDate)
    const slotDays = Math.max(Math.floor(epicDays / Math.max(childCount, 1)), 3)
    const childStart = addDays(epic.startDate, childIndex * slotDays)
    const childEnd = addDays(childStart, slotDays)
    return barStyle(childStart, childEnd > epic.endDate ? epic.endDate : childEnd)
  }

  // Today marker
  const todayX = dateToX(new Date())
  const showToday = todayX > 0 && todayX < totalWidth

  // Sync scroll between left and right panels vertically
  function handleRightScroll() {
    if (leftBodyRef.current && rightRef.current) {
      leftBodyRef.current.scrollTop = rightRef.current.scrollTop
    }
  }

  function handleLeftScroll() {
    if (rightRef.current && leftBodyRef.current) {
      rightRef.current.scrollTop = leftBodyRef.current.scrollTop
    }
  }

  // Scroll to today on mount
  useEffect(() => {
    if (rightRef.current && showToday) {
      rightRef.current.scrollLeft = Math.max(0, todayX - 200)
    }
  }, [todayX, showToday])

  function toggleExpanded(epicId) {
    setExpanded((prev) => ({ ...prev, [epicId]: !prev[epicId] }))
  }

  // Build flat list of visible rows
  const rows = useMemo(() => {
    const result = []
    epics.forEach((epic) => {
      const children = epicChildren[epic.id] || []
      result.push({ type: 'epic', epic, childCount: children.length })
      if (expanded[epic.id]) {
        children.forEach((issue, idx) => {
          result.push({ type: 'child', issue, epic, childIndex: idx, childCount: children.length })
        })
        result.push({ type: 'create', epic })
      }
    })
    return result
  }, [epics, epicChildren, expanded])

  return (
    <section className="timeline-page">
      {/* Page header */}
      <div className="tl-page-header">
        <h1>Timeline</h1>
        <div className="tl-header-actions">
          <div className="tl-view-toggle">
            <button
              type="button"
              className={`tl-view-btn${viewMode === 'weeks' ? ' active' : ''}`}
              onClick={() => setViewMode('weeks')}
            >Weeks</button>
            <button
              type="button"
              className={`tl-view-btn${viewMode === 'months' ? ' active' : ''}`}
              onClick={() => setViewMode('months')}
            >Months</button>
          </div>
        </div>
      </div>

      <div className="tl-container">
        {/* ---- Left panel ---- */}
        <div className="tl-left">
          <div className="tl-left-header">Epic / Issue</div>
          <div className="tl-left-body" ref={leftBodyRef} onScroll={handleLeftScroll}>
            {rows.length === 0 && (
              <div className="tl-empty">No epics on the roadmap yet.</div>
            )}
            {rows.map((row, i) => {
              if (row.type === 'epic') {
                const ep = row.epic
                return (
                  <div key={`epic-${ep.id}`} className="tl-row-left tl-row-left--epic" onClick={() => toggleExpanded(ep.id)}>
                    <button
                      type="button"
                      className={`tl-expand-btn${expanded[ep.id] ? ' tl-expand-btn--open' : ''}`}
                      onClick={(e) => { e.stopPropagation(); toggleExpanded(ep.id) }}
                    >▶</button>
                    <span className="tl-type-mark tl-type-epic" />
                    <span className="tl-row-name">{ep.name}</span>
                    <span className={`tl-row-status ${statusClass(ep.phase)}`}>{statusLabel(ep.phase)}</span>
                  </div>
                )
              }
              if (row.type === 'child') {
                const iss = row.issue
                const typeClass = iss.issueType === 'Bug' ? 'tl-type-bug' : iss.issueType === 'Story' ? 'tl-type-story' : 'tl-type-task'
                return (
                  <div key={`child-${iss.id}`} className="tl-row-left tl-row-left--child" onClick={() => navigate(`/issues/${iss.id}`)}>
                    <span className={`tl-type-mark ${typeClass}`} />
                    <span className="tl-row-key">{iss.key}</span>
                    <span className="tl-row-name">{iss.title}</span>
                    <span className={`tl-row-status ${statusClass(iss.status)}`}>{statusLabel(iss.status)}</span>
                  </div>
                )
              }
              if (row.type === 'create') {
                return (
                  <button key={`create-${row.epic.id}`} type="button" className="tl-create-child">
                    + Create child issue
                  </button>
                )
              }
              return null
            })}
          </div>
        </div>

        {/* ---- Right panel (Gantt) ---- */}
        <div className="tl-right" ref={rightRef} onScroll={handleRightScroll}>
          <div className="tl-chart" style={{ width: totalWidth }}>
            {/* Time header */}
            <div className="tl-time-header" style={{ width: totalWidth }}>
              {months.map((mo) => (
                <div key={mo.key} className="tl-month-group" style={{ width: mo.weekCount * WEEK_PX }}>
                  <div className="tl-month-label" style={{ width: mo.weekCount * WEEK_PX }}>{mo.label}</div>
                  <div className="tl-weeks-row">
                    {Array.from({ length: mo.weekCount }).map((_, wi) => (
                      <div key={wi} className="tl-week-cell" style={{ width: WEEK_PX }}>
                        {viewMode === 'weeks' ? `W${wi + 1}` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Gantt body */}
            <div className="tl-gantt-body">
              {/* Background grid columns */}
              <div className="tl-grid-cols" style={{ height: rows.length * 44 }}>
                {weeks.map((wk, wi) => {
                  const isMonthBoundary = wi === 0 || wk.getMonth() !== weeks[wi - 1]?.getMonth()
                  return (
                    <div
                      key={wi}
                      className={`tl-grid-col${isMonthBoundary ? ' tl-grid-col--month' : ''}`}
                      style={{ width: WEEK_PX }}
                    />
                  )
                })}
              </div>

              {/* Today marker */}
              {showToday && (
                <div className="tl-today-line" style={{ left: todayX, height: rows.length * 44 }}>
                  <span className="tl-today-label">Today</span>
                </div>
              )}

              {/* Gantt rows */}
              {rows.map((row, i) => {
                if (row.type === 'epic') {
                  const ep = row.epic
                  const style = barStyle(ep.startDate, ep.endDate)
                  return (
                    <div key={`g-epic-${ep.id}`} className="tl-gantt-row">
                      {style.display !== 'none' && (
                        <div className={`tl-bar tl-bar--epic`} style={style}>
                          {ep.name}
                        </div>
                      )}
                    </div>
                  )
                }
                if (row.type === 'child') {
                  const iss = row.issue
                  const style = childBarStyle(row.epic, row.childIndex, row.childCount)
                  return (
                    <div key={`g-child-${iss.id}`} className="tl-gantt-row">
                      {style.display !== 'none' && (
                        <div className={`tl-bar ${barClass(iss.status)}`} style={style}>
                          {iss.key} {iss.title}
                        </div>
                      )}
                    </div>
                  )
                }
                // create row — empty gantt row
                return <div key={`g-create-${row.epic.id}`} className="tl-gantt-row" style={{ height: 36 }} />
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
