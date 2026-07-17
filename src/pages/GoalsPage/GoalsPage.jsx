import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchProjects } from '../../api/projectApi'
import {
  fetchProjectGoals, createGoal, updateGoal, deleteGoal,
  createKeyResult, updateKeyResult, deleteKeyResult,
} from '../../api/goalApi'
import { usePermissions } from '../../hooks/usePermissions'
import './GoalsPage.css'

const EMPTY_GOAL = { objective: '', description: '', owner: '', status: 'on_track', dueDate: '' }
const EMPTY_KR = { title: '', targetValue: 100, currentValue: 0, unit: '' }
const STATUSES = ['on_track', 'at_risk', 'off_track', 'done']
const STATUS_LABEL = {
  on_track: 'On track', at_risk: 'At risk', off_track: 'Off track', done: 'Done',
}

export function GoalsPage() {
  const { projectId: routeProjectId } = useParams()
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState(routeProjectId ? Number(routeProjectId) : null)
  const [goals, setGoals] = useState([])
  const [form, setForm] = useState(EMPTY_GOAL)
  const [error, setError] = useState('')
  const [krForms, setKrForms] = useState({})
  const { canCreateIssue, isAdmin } = usePermissions(projectId)

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
    fetchProjectGoals(projectId)
      .then((d) => setGoals(Array.isArray(d) ? d : []))
      .catch(() => setGoals([]))
  }
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId])

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    try {
      await createGoal(projectId, form)
      setForm(EMPTY_GOAL)
      reload()
    } catch (err) {
      setError(err?.message || 'Failed to create objective')
    }
  }

  async function changeStatus(goal, status) {
    await updateGoal(goal.id, { status }).catch(() => {})
    reload()
  }

  async function removeGoal(goal) {
    if (!window.confirm(`Delete objective "${goal.objective}"? Key results will be removed.`)) return
    await deleteGoal(goal.id).catch(() => {})
    reload()
  }

  function krForm(goalId) {
    return krForms[goalId] || EMPTY_KR
  }
  function setKrForm(goalId, patch) {
    setKrForms((prev) => ({ ...prev, [goalId]: { ...krForm(goalId), ...patch } }))
  }

  async function addKeyResult(goalId, e) {
    e.preventDefault()
    const f = krForm(goalId)
    if (!f.title.trim()) return
    await createKeyResult(goalId, f).catch(() => {})
    setKrForms((prev) => ({ ...prev, [goalId]: EMPTY_KR }))
    reload()
  }

  async function saveCurrent(kr, value) {
    await updateKeyResult(kr.id, { currentValue: Number(value) }).catch(() => {})
    reload()
  }

  async function removeKr(kr) {
    await deleteKeyResult(kr.id).catch(() => {})
    reload()
  }

  return (
    <section className="page goals-page">
      <div className="goal-header">
        <h1>Goals &amp; OKRs</h1>
        {!routeProjectId && projects.length > 0 && (
          <select className="goal-input" value={projectId || ''} onChange={(e) => setProjectId(Number(e.target.value))}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>
      <p className="goal-sub">Set objectives, define measurable key results, and track progress.</p>

      {canCreateIssue && (
        <form className="goal-builder" onSubmit={handleCreate}>
          <input className="goal-input goal-obj" placeholder="Objective (e.g. Improve onboarding)" value={form.objective}
            onChange={(e) => setForm((f) => ({ ...f, objective: e.target.value }))} required />
          <input className="goal-input" placeholder="Owner" value={form.owner}
            onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))} />
          <input className="goal-input" type="date" value={form.dueDate}
            onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
          <select className="goal-input" value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <input className="goal-input goal-desc" placeholder="Description (optional)" value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          <button className="btn btn-primary" type="submit">Add objective</button>
          {error && <p className="goal-error">{error}</p>}
        </form>
      )}

      <div className="goal-list">
        <h3 className="goal-section-title">Objectives ({goals.length})</h3>
        {goals.length === 0 && <p className="goal-empty">No objectives yet.</p>}
        {goals.map((g) => (
          <div key={g.id} className="goal-card">
            <div className="goal-card-head">
              <div className="goal-card-title">
                <strong>{g.objective}</strong>
                <span className={`goal-badge goal-badge--${g.status}`}>{STATUS_LABEL[g.status]}</span>
              </div>
              <div className="goal-card-meta">
                {g.owner && <span>Owner: {g.owner}</span>}
                {g.dueDate && <span>Due: {new Date(g.dueDate).toLocaleDateString()}</span>}
              </div>
            </div>
            {g.description && <p className="goal-card-desc">{g.description}</p>}

            <div className="goal-progress">
              <div className="goal-bar"><div className="goal-bar-fill" style={{ width: `${g.progress}%` }} /></div>
              <span className="goal-progress-text">{g.progress}% complete</span>
            </div>

            <div className="goal-krs">
              {g.keyResults.length === 0 && <p className="goal-empty">No key results yet.</p>}
              {g.keyResults.map((kr) => (
                <div key={kr.id} className="goal-kr">
                  <span className="goal-kr-title">{kr.title}</span>
                  <span className="goal-kr-values">
                    {canCreateIssue ? (
                      <input
                        className="goal-kr-input"
                        type="number"
                        defaultValue={kr.currentValue}
                        onBlur={(e) => { if (Number(e.target.value) !== kr.currentValue) saveCurrent(kr, e.target.value) }}
                      />
                    ) : <span>{kr.currentValue}</span>}
                    <span> / {kr.targetValue} {kr.unit}</span>
                    <span className="goal-kr-pct">({kr.progress}%)</span>
                  </span>
                  {canCreateIssue && (
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeKr(kr)}>Remove</button>
                  )}
                </div>
              ))}
            </div>

            {canCreateIssue && (
              <form className="goal-kr-builder" onSubmit={(e) => addKeyResult(g.id, e)}>
                <input className="goal-input goal-kr-name" placeholder="Key result" value={krForm(g.id).title}
                  onChange={(e) => setKrForm(g.id, { title: e.target.value })} />
                <input className="goal-input goal-kr-num" type="number" placeholder="Current" value={krForm(g.id).currentValue}
                  onChange={(e) => setKrForm(g.id, { currentValue: e.target.value })} />
                <input className="goal-input goal-kr-num" type="number" placeholder="Target" value={krForm(g.id).targetValue}
                  onChange={(e) => setKrForm(g.id, { targetValue: e.target.value })} />
                <input className="goal-input goal-kr-unit" placeholder="Unit" value={krForm(g.id).unit}
                  onChange={(e) => setKrForm(g.id, { unit: e.target.value })} />
                <button className="btn btn-sm" type="submit">Add KR</button>
              </form>
            )}

            {canCreateIssue && (
              <div className="goal-card-actions">
                <select className="goal-input goal-status-select" value={g.status} onChange={(e) => changeStatus(g, e.target.value)}>
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
                {isAdmin && <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeGoal(g)}>Delete objective</button>}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
