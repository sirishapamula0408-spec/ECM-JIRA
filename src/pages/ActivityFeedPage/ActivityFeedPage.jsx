import { useEffect, useState, useCallback, useRef } from 'react'
import { fetchActivity } from '../../api/dashboardApi'
import { fetchProjects } from '../../api/projectApi'
import { fetchMembers } from '../../api/memberApi'
import { timeAgo } from '../../utils/timeAgo'
import './ActivityFeedPage.css'
import { usePageTitle } from '../../hooks/usePageTitle'

const ACTIVITY_TYPES = [
  { value: '', label: 'All types' },
  { value: 'issue', label: 'Issues' },
  { value: 'comment', label: 'Comments' },
  { value: 'sprint', label: 'Sprints' },
  { value: 'general', label: 'General' },
]

export function ActivityFeedPage() {
  usePageTitle('Activity')
  const [activities, setActivities] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [projects, setProjects] = useState([])
  const [members, setMembers] = useState([])
  const [filters, setFilters] = useState({ type: '', projectId: '', actor: '', dateFrom: '', dateTo: '' })
  const [hasMore, setHasMore] = useState(false)
  const [cursor, setCursor] = useState(null)
  const sentinelRef = useRef(null)
  const limit = 20

  useEffect(() => {
    fetchProjects().then((d) => setProjects(Array.isArray(d) ? d : [])).catch(() => {})
    fetchMembers().then((d) => setMembers(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  // Initial load
  const loadData = useCallback(async () => {
    setLoading(true)
    setCursor(null)
    try {
      const data = await fetchActivity({
        type: filters.type || undefined,
        projectId: filters.projectId || undefined,
        actor: filters.actor || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        limit,
      })
      setActivities(data.activities || [])
      setTotal(data.total || 0)
      setHasMore(data.hasMore || false)
      setCursor(data.nextCursor || null)
    } catch {
      setActivities([])
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { loadData() }, [loadData])

  // Infinite scroll: load more when sentinel is visible
  const loadMore = useCallback(async () => {
    if (!hasMore || !cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const data = await fetchActivity({
        type: filters.type || undefined,
        projectId: filters.projectId || undefined,
        actor: filters.actor || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        limit,
        cursor,
      })
      setActivities((prev) => [...prev, ...(data.activities || [])])
      setHasMore(data.hasMore || false)
      setCursor(data.nextCursor || null)
    } catch {
      // ignore
    } finally {
      setLoadingMore(false)
    }
  }, [hasMore, cursor, loadingMore, filters])

  useEffect(() => {
    if (!sentinelRef.current) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore() },
      { threshold: 0.1 },
    )
    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [loadMore])

  function handleFilterChange(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

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
        <input type="date" className="af-filter-select" value={filters.dateFrom} onChange={(e) => handleFilterChange('dateFrom', e.target.value)} title="From date" />
        <input type="date" className="af-filter-select" value={filters.dateTo} onChange={(e) => handleFilterChange('dateTo', e.target.value)} title="To date" />
      </div>

      <div className="af-timeline">
        {loading && <p className="af-loading">Loading...</p>}
        {!loading && activities.length === 0 && <p className="af-empty">No activity found.</p>}
        {activities.map((a) => (
          <div key={a.id} className="af-item">
            <div className="af-item-avatar">
              {(a.actor || 'U').slice(0, 2).toUpperCase()}
            </div>
            <div className="af-item-content">
              <div className="af-item-header">
                <span className="af-actor">{a.actor}</span>
                <span className="af-time">{timeAgo(a.created_at || a.happened_at) || 'Just now'}</span>
              </div>
              <p className="af-action">{a.action}</p>
              {a.activity_type && a.activity_type !== 'general' && (
                <span className="af-type-badge">{a.activity_type}</span>
              )}
            </div>
          </div>
        ))}
        {/* Infinite scroll sentinel */}
        {hasMore && <div ref={sentinelRef} className="af-sentinel">{loadingMore ? 'Loading more...' : ''}</div>}
      </div>
    </section>
  )
}
