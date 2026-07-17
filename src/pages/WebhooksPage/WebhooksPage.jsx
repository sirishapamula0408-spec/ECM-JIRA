import { useEffect, useState, useCallback } from 'react'
import { fetchWebhooks, createWebhook, updateWebhook, deleteWebhook, testWebhook, fetchWebhookLogs, fetchEventCatalog, fetchDeliveries, fetchDelivery, replayDelivery } from '../../api/webhookApi'
import { usePermissions } from '../../hooks/usePermissions'
import { EmptyState } from '../../components/common/EmptyState'
import './WebhooksPage.css'

const EVENT_OPTIONS = [
  'issue.created', 'issue.updated', 'issue.status_changed',
  'comment.created', 'sprint.started', 'sprint.completed',
  'member.added', '*',
]

export function WebhooksPage() {
  const { isAdmin } = usePermissions()
  const [webhooks, setWebhooks] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', url: '', secret: '', events: [] })
  const [selectedLogs, setSelectedLogs] = useState(null)
  const [logs, setLogs] = useState([])
  const [testResult, setTestResult] = useState(null)
  // JL-150: tabs + delivery console + event catalog
  const [tab, setTab] = useState('webhooks')
  const [deliveries, setDeliveries] = useState([])
  const [deliveryFilters, setDeliveryFilters] = useState({ webhookId: '', status: '', event: '' })
  const [deliveryDetail, setDeliveryDetail] = useState(null)
  const [catalog, setCatalog] = useState([])

  const load = useCallback(() => {
    fetchWebhooks()
      .then((data) => setWebhooks(Array.isArray(data) ? data : []))
      .catch(() => setWebhooks([]))
  }, [])

  useEffect(load, [load])

  const loadDeliveries = useCallback(() => {
    fetchDeliveries(deliveryFilters)
      .then((data) => setDeliveries(Array.isArray(data) ? data : []))
      .catch(() => setDeliveries([]))
  }, [deliveryFilters])

  useEffect(() => {
    if (tab === 'deliveries') loadDeliveries()
    if (tab === 'catalog' && catalog.length === 0) {
      fetchEventCatalog().then((d) => setCatalog(Array.isArray(d) ? d : [])).catch(() => setCatalog([]))
    }
  }, [tab, loadDeliveries, catalog.length])

  async function handleReplay(id) {
    try {
      await replayDelivery(id)
      loadDeliveries()
    } catch {
      // ignore
    }
  }

  async function handleShowDelivery(id) {
    try {
      const data = await fetchDelivery(id)
      setDeliveryDetail(data)
    } catch {
      setDeliveryDetail(null)
    }
  }

  async function handleCreate() {
    if (!form.name.trim() || !form.url.trim()) return
    try {
      await createWebhook(form)
      setShowCreate(false)
      setForm({ name: '', url: '', secret: '', events: [] })
      load()
    } catch {
      // ignore
    }
  }

  async function handleToggle(hook) {
    await updateWebhook(hook.id, { isActive: !hook.is_active })
    load()
  }

  async function handleDelete(id) {
    await deleteWebhook(id)
    load()
  }

  async function handleTest(id) {
    setTestResult(null)
    try {
      const result = await testWebhook(id)
      setTestResult(result)
    } catch (err) {
      setTestResult({ success: false, error: err.message })
    }
  }

  async function handleShowLogs(id) {
    setSelectedLogs(id)
    try {
      const data = await fetchWebhookLogs(id)
      setLogs(Array.isArray(data) ? data : [])
    } catch {
      setLogs([])
    }
  }

  function toggleEvent(event) {
    setForm((f) => ({
      ...f,
      events: f.events.includes(event)
        ? f.events.filter((e) => e !== event)
        : [...f.events, event],
    }))
  }

  return (
    <section className="page webhooks-page">
      <div className="wh-header">
        <h1>Webhook Integrations</h1>
        {isAdmin && tab === 'webhooks' && (
          <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + Create Webhook
          </button>
        )}
      </div>

      <div className="wh-tabs" role="tablist">
        {[['webhooks', 'Webhooks'], ['deliveries', 'Deliveries'], ['catalog', 'Event Catalog']].map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`wh-tab${tab === key ? ' wh-tab--active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'deliveries' && (
        <div className="wh-deliveries">
          <div className="wh-delivery-filters">
            <input
              className="wh-input wh-input--sm"
              placeholder="Filter by event…"
              value={deliveryFilters.event}
              onChange={(e) => setDeliveryFilters((f) => ({ ...f, event: e.target.value }))}
            />
            <select
              className="wh-input wh-input--sm"
              value={deliveryFilters.status}
              onChange={(e) => setDeliveryFilters((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="">All statuses</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>
            <button type="button" className="btn btn-ghost btn-sm" onClick={loadDeliveries}>Refresh</button>
          </div>
          <table className="wh-delivery-table">
            <thead>
              <tr>
                <th>Event</th><th>Webhook</th><th>Status</th><th>Time</th><th></th>
              </tr>
            </thead>
            <tbody>
              {deliveries.length === 0 && (
                <tr><td colSpan={5} className="wh-empty">No deliveries found.</td></tr>
              )}
              {deliveries.map((d) => (
                <tr key={d.id} className={d.success ? '' : 'wh-log-item--fail'}>
                  <td>{d.event}</td>
                  <td>{d.webhook_name || `#${d.webhook_id}`}</td>
                  <td>
                    <span className={`wh-log-status${d.success ? ' wh-log-status--ok' : ''}`}>
                      {d.success ? `${d.response_status} OK` : `${d.response_status || 'ERR'} Failed`}
                    </span>
                  </td>
                  <td>{new Date(d.created_at).toLocaleString()}</td>
                  <td className="wh-delivery-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleShowDelivery(d.id)}>Detail</button>
                    {isAdmin && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleReplay(d.id)}>Replay</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {deliveryDetail && (
            <div className="wh-detail-drawer">
              <div className="wh-logs-header">
                <h3>Delivery #{deliveryDetail.id} — {deliveryDetail.event}</h3>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeliveryDetail(null)}>Close</button>
              </div>
              <h4>Request payload</h4>
              <pre className="wh-detail-json">{JSON.stringify(deliveryDetail.payload, null, 2)}</pre>
              <h4>Response ({deliveryDetail.response_status ?? 'n/a'})</h4>
              <pre className="wh-detail-json">{deliveryDetail.response_body || '(empty)'}</pre>
            </div>
          )}
        </div>
      )}

      {tab === 'catalog' && (
        <div className="wh-catalog">
          {catalog.length === 0 && <p className="wh-empty">No events in catalog.</p>}
          {catalog.map((ev) => (
            <div key={ev.type} className="wh-catalog-item">
              <div className="wh-catalog-head">
                <code className="wh-event-tag">{ev.type}</code>
                <span className="wh-catalog-category">{ev.category}</span>
              </div>
              <p className="wh-catalog-desc">{ev.description}</p>
            </div>
          ))}
        </div>
      )}

      {tab === 'webhooks' && (<>
      {showCreate && (
        <div className="wh-create-form">
          <h3>New Webhook</h3>
          <input className="wh-input" placeholder="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <input className="wh-input" placeholder="Payload URL (https://...)" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} />
          <input className="wh-input" placeholder="Secret (optional)" value={form.secret} onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))} />
          <div className="wh-events">
            <label className="wh-events-label">Events:</label>
            <div className="wh-event-chips">
              {EVENT_OPTIONS.map((ev) => (
                <button
                  key={ev}
                  type="button"
                  className={`wh-event-chip${form.events.includes(ev) ? ' wh-event-chip--active' : ''}`}
                  onClick={() => toggleEvent(ev)}
                >
                  {ev}
                </button>
              ))}
            </div>
          </div>
          <div className="wh-form-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={handleCreate}>Create</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </div>
      )}

      {testResult && (
        <div className={`wh-test-result ${testResult.success ? 'wh-test-success' : 'wh-test-fail'}`}>
          {testResult.success ? `Test successful (status: ${testResult.status})` : `Test failed: ${testResult.error || `status ${testResult.status}`}`}
          <button type="button" className="wh-test-close" onClick={() => setTestResult(null)}>&times;</button>
        </div>
      )}

      <div className="wh-list">
        {webhooks.length === 0 && (
          <EmptyState
            icon="🔗"
            title="No webhooks configured"
            description="Webhooks let external services react to issue, sprint, and comment events in real time."
          />
        )}
        {webhooks.map((hook) => (
          <div key={hook.id} className={`wh-card${hook.is_active ? '' : ' wh-card--inactive'}`}>
            <div className="wh-card-header">
              <div className="wh-card-title">
                <span className={`wh-status-dot${hook.is_active ? ' wh-status-dot--active' : ''}`} />
                <strong>{hook.name}</strong>
              </div>
              <div className="wh-card-actions">
                {isAdmin && (
                  <>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleTest(hook.id)}>Test</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleToggle(hook)}>
                      {hook.is_active ? 'Disable' : 'Enable'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleShowLogs(hook.id)}>Logs</button>
                    <button type="button" className="btn btn-ghost btn-sm wh-delete-btn" onClick={() => handleDelete(hook.id)}>Delete</button>
                  </>
                )}
              </div>
            </div>
            <div className="wh-card-url">{hook.url}</div>
            <div className="wh-card-events">
              {(typeof hook.events === 'string' ? JSON.parse(hook.events) : (hook.events || [])).map((ev) => (
                <span key={ev} className="wh-event-tag">{ev}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {selectedLogs && (
        <div className="wh-logs-panel">
          <div className="wh-logs-header">
            <h3>Delivery Logs</h3>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedLogs(null)}>Close</button>
          </div>
          <div className="wh-logs-list">
            {logs.length === 0 && <p className="wh-empty">No delivery logs.</p>}
            {logs.map((log) => (
              <div key={log.id} className={`wh-log-item${log.success ? '' : ' wh-log-item--fail'}`}>
                <span className="wh-log-event">{log.event}</span>
                <span className={`wh-log-status${log.success ? ' wh-log-status--ok' : ''}`}>
                  {log.success ? `${log.response_status} OK` : `${log.response_status || 'ERR'} Failed`}
                </span>
                <span className="wh-log-time">{new Date(log.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      </>)}
    </section>
  )
}
