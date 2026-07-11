import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchProjects } from '../../api/projectApi'
import {
  fetchAutomationRules, createAutomationRule, updateAutomationRule, deleteAutomationRule, fetchAutomationLogs,
} from '../../api/automationApi'
import { usePermissions } from '../../hooks/usePermissions'
import { ISSUE_STATUSES } from '../../constants'
import './AutomationPage.css'

const TRIGGERS = [
  { value: 'status_changed', label: 'When status changes' },
  { value: 'comment_added', label: 'When a comment is added' },
  { value: 'scheduled', label: 'On a schedule (every N minutes)' },
]
const ACTIONS = [
  { value: 'assign', label: 'Assign to' },
  { value: 'transition', label: 'Transition to status' },
  { value: 'comment', label: 'Add comment' },
  { value: 'notify', label: 'Notify assignee' },
]
const EMPTY = { name: '', triggerType: 'status_changed', conditionValue: '', actionType: 'assign', actionValue: '', scheduleIntervalMinutes: 60 }

export function AutomationPage() {
  const { projectId: routeProjectId } = useParams()
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState(routeProjectId ? Number(routeProjectId) : null)
  const [rules, setRules] = useState([])
  const [logs, setLogs] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const { isAdmin } = usePermissions(projectId)

  useEffect(() => {
    if (routeProjectId) return
    fetchProjects().then((data) => {
      setProjects(data || [])
      if (!projectId && data?.length) setProjectId(data[0].id)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeProjectId])

  function reload() {
    if (!projectId) return
    fetchAutomationRules(projectId).then((d) => setRules(Array.isArray(d) ? d : [])).catch(() => setRules([]))
    fetchAutomationLogs(projectId).then((d) => setLogs(Array.isArray(d) ? d : [])).catch(() => setLogs([]))
  }
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId])

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    try {
      await createAutomationRule(projectId, form)
      setForm(EMPTY)
      reload()
    } catch (err) {
      setError(err?.message || 'Failed to create rule')
    }
  }

  async function toggle(rule) {
    await updateAutomationRule(rule.id, { enabled: !rule.enabled }).catch(() => {})
    reload()
  }
  async function remove(rule) {
    if (!window.confirm(`Delete rule "${rule.name}"?`)) return
    await deleteAutomationRule(rule.id).catch(() => {})
    reload()
  }

  const actionValueField = () => {
    if (form.actionType === 'transition') {
      return (
        <select className="au-input" value={form.actionValue} onChange={(e) => setForm((f) => ({ ...f, actionValue: e.target.value }))}>
          <option value="">Select status…</option>
          {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )
    }
    const placeholder = form.actionType === 'assign' ? 'Assignee name'
      : form.actionType === 'comment' ? 'Comment text'
      : 'Recipient email (blank = assignee)'
    return <input className="au-input" placeholder={placeholder} value={form.actionValue} onChange={(e) => setForm((f) => ({ ...f, actionValue: e.target.value }))} />
  }

  return (
    <section className="page automation-page">
      <div className="au-header">
        <h1>Automation</h1>
        {!routeProjectId && projects.length > 0 && (
          <select className="au-input" value={projectId || ''} onChange={(e) => setProjectId(Number(e.target.value))}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>
      <p className="au-sub">WHEN a trigger fires, IF the condition matches, THEN run an action.</p>

      {isAdmin && (
        <form className="au-builder" onSubmit={handleCreate}>
          <input className="au-input au-name" placeholder="Rule name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          <div className="au-row">
            <span className="au-when">WHEN</span>
            <select className="au-input" value={form.triggerType} onChange={(e) => setForm((f) => ({ ...f, triggerType: e.target.value }))}>
              {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {form.triggerType === 'status_changed' && (
              <select className="au-input" value={form.conditionValue} onChange={(e) => setForm((f) => ({ ...f, conditionValue: e.target.value }))}>
                <option value="">any status</option>
                {ISSUE_STATUSES.map((s) => <option key={s} value={s}>to {s}</option>)}
              </select>
            )}
            {form.triggerType === 'comment_added' && (
              <input className="au-input" placeholder="text contains… (optional)" value={form.conditionValue} onChange={(e) => setForm((f) => ({ ...f, conditionValue: e.target.value }))} />
            )}
            {form.triggerType === 'scheduled' && (
              <>
                <span className="au-when">every</span>
                <input className="au-input au-interval" type="number" min="1" value={form.scheduleIntervalMinutes} onChange={(e) => setForm((f) => ({ ...f, scheduleIntervalMinutes: e.target.value }))} />
                <span className="au-when">min, for issues in</span>
                <select className="au-input" value={form.conditionValue} onChange={(e) => setForm((f) => ({ ...f, conditionValue: e.target.value }))}>
                  <option value="">any status</option>
                  {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </>
            )}
          </div>
          <div className="au-row">
            <span className="au-then">THEN</span>
            <select className="au-input" value={form.actionType} onChange={(e) => setForm((f) => ({ ...f, actionType: e.target.value, actionValue: '' }))}>
              {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            {actionValueField()}
          </div>
          <button className="btn btn-primary" type="submit">Create rule</button>
          {error && <p className="au-error">{error}</p>}
        </form>
      )}

      <h3 className="au-section-title">Rules ({rules.length})</h3>
      <div className="au-rules">
        {rules.length === 0 && <p className="au-empty">No automation rules yet.</p>}
        {rules.map((r) => (
          <div key={r.id} className={`au-rule${r.enabled ? '' : ' au-rule--off'}`}>
            <div className="au-rule-main">
              <strong>{r.name}</strong>
              <span className="au-rule-desc">
                WHEN {TRIGGERS.find((t) => t.value === r.triggerType)?.label.toLowerCase()}
                {r.triggerType === 'scheduled' && r.scheduleIntervalMinutes ? ` (every ${r.scheduleIntervalMinutes} min)` : ''}
                {r.conditionValue ? ` (${r.conditionValue})` : ''} → {ACTIONS.find((a) => a.value === r.actionType)?.label} {r.actionValue}
              </span>
            </div>
            {isAdmin && (
              <div className="au-rule-actions">
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => toggle(r)}>{r.enabled ? 'Disable' : 'Enable'}</button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => remove(r)}>Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <h3 className="au-section-title">Execution log</h3>
      <div className="au-logs">
        {logs.length === 0 && <p className="au-empty">No executions yet.</p>}
        {logs.map((l) => (
          <div key={l.id} className="au-log">
            <span className={`au-log-status au-log-status--${l.status}`}>{l.status}</span>
            <span className="au-log-rule">{l.rule_name}</span>
            <span className="au-log-msg">{l.message}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
