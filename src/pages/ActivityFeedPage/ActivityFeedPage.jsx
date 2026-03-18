import { useEffect, useState, useCallback } from 'react'
import { fetchActivity } from '../../api/dashboardApi'
import { fetchProjects } from '../../api/projectApi'
import { fetchMembers } from '../../api/memberApi'
import './ActivityFeedPage.css'

const ACTIVITY_TYPES = [
  { value: '', label: 'All types' },
  { value: 'issue', label: 'Issues' },
  { value: 'comment', label: 'Comments' },
  { value: 'sprint', label: 'Sprints' },
  { value: 'general', label: 'General' },
]

function timeAgo(dateStr) {
  if (!dateStr || dateStr === 'Just now') return 'Just now'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

export function ActivityFeedPage() {
  const [activities, setActivities] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [projects, setProjects] = useState([])
  const [members, setMembers] = useState([])
  const [filters, setFilters] = useState({ type: '', projectId: '', actor: '' })
  const [page, setPage] = useState(0)
  const limit = 20

  useEffect(() => {
    fetchProjects().then((d) => setProjects(Array.isArray(d) ? d : [])).catch(() => {})
    fetchMembers().then((d) => setMembers(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchActivity({
        type: filters.type || undefined,
        projectId: filters.projectId || undefined,
        actor: filters.actor || undefined,
        limit,
        offset: page * limit,
      })
      setActivities(data.activities || [])
      setTotal(data.total || 0)
    } catch {
      setActivities([])
    } finally {
      setLoading(false)
    }
  }, [filters, page])

  useEffect(() => { loadData() }, [loadData])

  function handleFilterChange(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(0)
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <section className="page activity-feed-page">
      <div className="af-header">
        <h1>Activity Feed</h1>
        <span className="af-total">{total} activities</span>
      </div>

      <div className="af-filters">
        <select value={filters.type} onChange={(e) => handleFilterChange('type', e.target.value)} className="af-filter-select">
          {ACTIVITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={filters.projectId} onChange={(e) => handleFilterChange('projectId', e.target.value)} className="af-filter-select">
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={filters.actor} onChange={(e) => handleFilterChange('actor', e.target.value)} className="af-filter-select">
          <option value="">All members</option>
          {members.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
        </select>
      </div>

      <div className="af-timeline">
        {loading && <p className="af-loading">Loading...</p>}
        {!loading && activities.length === 0 && <p className="af-empty">No activity found.</p>}
        {activities.map((a) => (
          <div key={a.id} className="af-item">
            <div className="af-item-dot" />
            <div className="af-item-content">
              <div className="af-item-header">
                <span className="af-actor">{a.actor}</span>
                <span className="af-time">{timeAgo(a.created_at || a.happened_at)}</span>
              </div>
              <p className="af-action">{a.action}</p>
              {a.activity_type && a.activity_type !== 'general' && (
                <span className="af-type-badge">{a.activity_type}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="af-pagination">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="btn btn-ghost btn-sm">Previous</button>
          <span className="af-page-info">Page {page + 1} of {totalPages}</span>
          <button type="button" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="btn btn-ghost btn-sm">Next</button>
        </div>
      )}
    </section>
  )
}
