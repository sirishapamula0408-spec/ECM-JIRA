import { useEffect, useState, useCallback } from 'react'
import { fetchWebhooks, createWebhook, updateWebhook, deleteWebhook, testWebhook, fetchWebhookLogs } from '../../api/webhookApi'
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

  const load = useCallback(() => {
    fetchWebhooks()
      .then((data) => setWebhooks(Array.isArray(data) ? data : []))
      .catch(() => setWebhooks([]))
  }, [])

  useEffect(load, [load])

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
        {isAdmin && (
          <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + Create Webhook
          </button>
        )}
      </div>

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
    </section>
  )
}
