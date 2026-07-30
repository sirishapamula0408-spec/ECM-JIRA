import { useEffect, useState, useCallback } from 'react'
import {
  fetchInboundEmailSettings,
  createInboundEmailSetting,
  deleteInboundEmailSetting,
} from '../../api/inboundEmailApi'
import { sendTestEmail } from '../../api/notificationApi'
import { fetchProjects } from '../../api/projectApi'
import { usePermissions } from '../../hooks/usePermissions'
import { EmptyState } from '../../components/common/EmptyState'
import { RelativeTime } from '../../components/common/RelativeTime'
import { ISSUE_TYPES } from '../../constants'
import './InboundEmailPage.css'
import { usePageTitle } from '../../hooks/usePageTitle'

// JL-148: Admin section to map an inbound mailbox → project and view the
// email-processing audit log.
export function InboundEmailPage() {
  usePageTitle('Inbound Email')
  const { isAdmin } = usePermissions()
  const [settings, setSettings] = useState([])
  const [log, setLog] = useState([])
  const [projects, setProjects] = useState([])
  const [form, setForm] = useState({ mailboxAddress: '', projectId: '', defaultIssueType: 'Task' })
  const [error, setError] = useState('')
  // JL-304: outbound SMTP test state
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const load = useCallback(() => {
    fetchInboundEmailSettings()
      .then((data) => {
        setSettings(Array.isArray(data?.settings) ? data.settings : [])
        setLog(Array.isArray(data?.log) ? data.log : [])
      })
      .catch(() => {
        setSettings([])
        setLog([])
      })
  }, [])

  useEffect(() => {
    load()
    fetchProjects()
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch(() => setProjects([]))
  }, [load])

  async function handleCreate() {
    setError('')
    if (!form.mailboxAddress.trim()) {
      setError('Mailbox address is required')
      return
    }
    try {
      await createInboundEmailSetting({
        mailboxAddress: form.mailboxAddress.trim(),
        projectId: form.projectId || null,
        defaultIssueType: form.defaultIssueType,
      })
      setForm({ mailboxAddress: '', projectId: '', defaultIssueType: 'Task' })
      load()
    } catch (err) {
      setError(err?.message || 'Failed to create mapping')
    }
  }

  async function handleDelete(id) {
    await deleteInboundEmailSetting(id)
    load()
  }

  // JL-304: verify SMTP connectivity and send a test email to the current admin.
  async function handleSendTestEmail() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await sendTestEmail()
      let message
      let kind
      if (!res.configured) {
        kind = 'warn'
        message = `SMTP is not configured — emails are logged to the server console (console fallback). Check the server logs for the test message.`
      } else if (res.ok && res.sent) {
        kind = 'ok'
        message = `SMTP connection verified and a test email was sent to ${res.to}.`
      } else {
        kind = 'error'
        message = `SMTP test failed${res.error ? `: ${res.error}` : '.'}`
      }
      setTestResult({ kind, message })
    } catch (err) {
      setTestResult({ kind: 'error', message: err?.message || 'Failed to send test email' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="page inbound-email-page">
      <div className="ie-header">
        <h1>Inbound Email</h1>
        <p className="ie-subtitle">
          Map an inbox to a project. Emails create issues; replies whose subject contains an issue
          key (e.g. PROJ-12) append a comment.
        </p>
      </div>

      {isAdmin && (
        <div className="ie-create-form">
          <h3>Map a mailbox</h3>
          {error && <div className="ie-error">{error}</div>}
          <input
            className="ie-input"
            placeholder="Mailbox address (e.g. support@yourco.io)"
            value={form.mailboxAddress}
            onChange={(e) => setForm((f) => ({ ...f, mailboxAddress: e.target.value }))}
          />
          <select
            className="ie-input"
            value={form.projectId}
            onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
          >
            <option value="">Select project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.key})
              </option>
            ))}
          </select>
          <select
            className="ie-input"
            value={form.defaultIssueType}
            onChange={(e) => setForm((f) => ({ ...f, defaultIssueType: e.target.value }))}
          >
            {ISSUE_TYPES.filter((t) => t !== 'Sub-task' && t !== 'Epic').map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleCreate}>
            Add mapping
          </button>
        </div>
      )}

      {isAdmin && (
        <div className="ie-create-form">
          <h3>Outbound email (SMTP)</h3>
          <p className="ie-subtitle">
            Verify your SMTP configuration and send a test email to your own address ({/* current admin */}).
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSendTestEmail}
            disabled={testing}
          >
            {testing ? 'Sending…' : 'Send test email'}
          </button>
          {testResult && (
            <div
              className={
                testResult.kind === 'ok'
                  ? 'ie-test-result ie-test-result--ok'
                  : testResult.kind === 'warn'
                    ? 'ie-test-result ie-test-result--warn'
                    : 'ie-error'
              }
              role="status"
            >
              {testResult.message}
            </div>
          )}
        </div>
      )}

      <div className="ie-list">
        {settings.length === 0 && (
          <EmptyState
            icon="📧"
            title="No inbound mailboxes configured"
            description="Map a mailbox to a project so emails sent to it open issues automatically."
          />
        )}
        {settings.map((s) => (
          <div key={s.id} className={`ie-card${s.enabled ? '' : ' ie-card--inactive'}`}>
            <div className="ie-card-main">
              <strong>{s.mailbox_address}</strong>
              <span className="ie-arrow">→</span>
              <span className="ie-project">
                {s.project_name ? `${s.project_name} (${s.project_key})` : 'No project'}
              </span>
              <span className="ie-type-tag">{s.default_issue_type}</span>
            </div>
            {isAdmin && (
              <button
                type="button"
                className="btn btn-ghost btn-sm ie-delete-btn"
                onClick={() => handleDelete(s.id)}
              >
                Delete
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="ie-log-panel">
        <h3>Processing log</h3>
        {log.length === 0 && <p className="ie-empty">No emails processed yet.</p>}
        {log.map((entry) => (
          <div key={entry.id} className="ie-log-item">
            <span className={`ie-log-action ie-log-action--${entry.action}`}>{entry.action}</span>
            <span className="ie-log-from">{entry.from_address || '—'}</span>
            <span className="ie-log-subject">{entry.subject || '(no subject)'}</span>
            {entry.matched_issue_key && (
              <span className="ie-log-key">{entry.matched_issue_key}</span>
            )}
            <span className="ie-log-time"><RelativeTime value={entry.created_at} /></span>
          </div>
        ))}
      </div>
    </section>
  )
}
