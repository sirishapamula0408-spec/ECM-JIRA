import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useIssues } from '../../context/IssueContext'
import { useSprints } from '../../context/SprintContext'
import { usePermissions } from '../../hooks/usePermissions'
import { fetchParallelSprintSetting, setParallelSprintSetting, addRetro, deleteRetro, fetchRetros } from '../../api/sprintApi'
import { STATUS_COLUMNS } from '../../constants'
import './ActiveSprintPage.css'

const RETRO_COLUMNS = [
  { key: 'well', label: 'What went well' },
  { key: 'improve', label: 'What to improve' },
  { key: 'action', label: 'Action items' },
]

export function ActiveSprintPage() {
  const { issues, handleMove, reloadIssues } = useIssues()
  const { sprints, handleCompleteSprint, handleUpdateSprint } = useSprints()
  const navigate = useNavigate()
  const { projectId } = useParams()
  const { canManageSprints } = usePermissions(projectId ? Number(projectId) : undefined)
  const scopedIssues = projectId ? issues.filter((i) => i.projectId === Number(projectId)) : issues
  const [dragIssueId, setDragIssueId] = useState(null)
  const [dropStatus, setDropStatus] = useState('')
  const [selectedSprintId, setSelectedSprintId] = useState(null)
  const [allowParallel, setAllowParallel] = useState(false)
  const [settingBusy, setSettingBusy] = useState(false)

  const activeSprints = useMemo(() => sprints.filter((s) => s.isStarted), [sprints])

  // JL-124: load the project's parallel-sprints opt-in state
  useEffect(() => {
    let cancelled = false
    if (!projectId) return undefined
    fetchParallelSprintSetting(projectId)
      .then((res) => { if (!cancelled) setAllowParallel(Boolean(res?.allowParallelSprints)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [projectId])

  // Keep the selected sprint valid as the active set changes
  useEffect(() => {
    if (activeSprints.length === 0) { setSelectedSprintId(null); return }
    if (!activeSprints.some((s) => s.id === selectedSprintId)) {
      setSelectedSprintId(activeSprints[0].id)
    }
  }, [activeSprints, selectedSprintId])

  async function onToggleParallel(next) {
    if (!projectId) return
    setSettingBusy(true)
    try {
      const res = await setParallelSprintSetting(projectId, next)
      setAllowParallel(Boolean(res?.allowParallelSprints))
    } catch {
      // permission / network error — leave prior state
    } finally {
      setSettingBusy(false)
    }
  }

  const parallelToggle = projectId && canManageSprints ? (
    <div className="active-sprint-parallel-toggle">
      <label>
        <input
          type="checkbox"
          checked={allowParallel}
          disabled={settingBusy}
          onChange={(e) => onToggleParallel(e.target.checked)}
        />
        Allow parallel (concurrent) active sprints
      </label>
    </div>
  ) : null

  if (activeSprints.length === 0) {
    return (
      <section className="page">
        {parallelToggle}
        <div className="active-sprint-empty">
          <h2>No active sprints</h2>
          <p>Start a sprint from the <Link to={projectId ? `/projects/${projectId}/backlog` : '/backlog'}>Backlog</Link> to see it here.</p>
        </div>
      </section>
    )
  }

  const displayedSprint = activeSprints.find((s) => s.id === selectedSprintId) || activeSprints[0]

  return (
    <section className="page">
      {parallelToggle}

      {activeSprints.length > 1 && (
        <div className="active-sprint-selector" role="tablist" aria-label="Active sprints">
          {activeSprints.map((sprint) => (
            <button
              key={sprint.id}
              type="button"
              role="tab"
              aria-selected={sprint.id === displayedSprint.id}
              className={`active-sprint-tab${sprint.id === displayedSprint.id ? ' active-sprint-tab--selected' : ''}`}
              onClick={() => setSelectedSprintId(sprint.id)}
            >
              {sprint.name}
            </button>
          ))}
        </div>
      )}

      <SprintBoard
        key={displayedSprint.id}
        sprint={displayedSprint}
        issues={scopedIssues}
        handleMove={handleMove}
        handleCompleteSprint={handleCompleteSprint}
        handleUpdateSprint={handleUpdateSprint}
        canManageSprints={canManageSprints}
        reloadIssues={reloadIssues}
        navigate={navigate}
        dragIssueId={dragIssueId}
        setDragIssueId={setDragIssueId}
        dropStatus={dropStatus}
        setDropStatus={setDropStatus}
        showDivider={false}
      />
    </section>
  )
}

function SprintBoard({ sprint, issues, handleMove, handleCompleteSprint, handleUpdateSprint, canManageSprints, reloadIssues, navigate, dragIssueId, setDragIssueId, dropStatus, setDropStatus, showDivider }) {
  const sprintIssues = useMemo(
    () => issues.filter((i) => i.sprintId === sprint.id && i.status !== 'Backlog'),
    [issues, sprint.id],
  )

  const grouped = useMemo(() => {
    const acc = Object.fromEntries(STATUS_COLUMNS.map((s) => [s, []]))
    for (const issue of sprintIssues) {
      if (acc[issue.status]) acc[issue.status].push(issue)
    }
    return acc
  }, [sprintIssues])

  const totalCount = sprintIssues.length
  const doneCount = grouped['Done']?.length || 0
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

  async function onDrop(nextStatus) {
    if (!dragIssueId) return
    const issue = issues.find((i) => i.id === dragIssueId)
    if (!issue || issue.status === nextStatus) { setDragIssueId(null); setDropStatus(''); return }
    try {
      await handleMove(issue.id, nextStatus, issue.sprintId ?? null)
    } catch {
      // Move failed — state is reset in finally
    } finally {
      setDragIssueId(null)
      setDropStatus('')
    }
  }

  async function onComplete() {
    const ok = window.confirm(`Complete sprint "${sprint.name}"? Incomplete issues will move to the backlog.`)
    if (!ok) return
    await handleCompleteSprint(sprint.id)
    await reloadIssues()
  }

  return (
    <div className="active-sprint-section">
      {showDivider && <hr className="active-sprint-divider" />}

      <div className="active-sprint-header">
        <div className="active-sprint-header__info">
          <h2 className="active-sprint-header__name">{sprint.name}</h2>
          <span className="active-sprint-header__dates">{sprint.dateRange}</span>
        </div>
        <div className="active-sprint-header__right">
          <span className="active-sprint-header__progress-text">{doneCount} of {totalCount} done</span>
          <div className="active-sprint-header__progress-bar">
            <div className="active-sprint-header__progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <button className="btn btn-primary" type="button" onClick={onComplete}>Complete sprint</button>
        </div>
      </div>

      <SprintGoal sprint={sprint} canEdit={canManageSprints} handleUpdateSprint={handleUpdateSprint} />

      <div className="active-sprint-grid">
        {STATUS_COLUMNS.map((status) => (
          <article
            key={status}
            className={`active-sprint-col${dropStatus === status ? ' active-sprint-col-drop' : ''}`}
            onDragOver={(e) => { e.preventDefault(); if (dropStatus !== status) setDropStatus(status) }}
            onDrop={() => onDrop(status)}
          >
            <header>
              <h3>{status}</h3>
              <span>{grouped[status]?.length || 0}</span>
            </header>
            {grouped[status]?.map((issue) => (
              <div
                className={`active-sprint-card${dragIssueId === issue.id ? ' dragging' : ''}`}
                key={issue.id}
                draggable
                onDragStart={() => setDragIssueId(issue.id)}
                onDragEnd={() => { setDragIssueId(null); setDropStatus('') }}
              >
                <div className="active-sprint-card__top">
                  <span className="active-sprint-card__type">{issue.issueType === 'Bug' ? '\u{1F41B}' : issue.issueType === 'Story' ? '\u{1F4D7}' : '\u{2705}'}</span>
                  <button className="issue-link" type="button" onClick={() => navigate(`/issues/${issue.id}`)}>{issue.key}</button>
                </div>
                <h4 className="active-sprint-card__title">{issue.title}</h4>
                <div className="active-sprint-card__bottom">
                  <span className={`priority-mark priority-${(issue.priority || 'medium').toLowerCase()}`} title={issue.priority} />
                  {issue.assignee && (
                    <span className="member-avatar" title={issue.assignee}>
                      {issue.assignee.charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </article>
        ))}
      </div>

      <RetroPanel sprintId={sprint.id} canEdit={canManageSprints} />
    </div>
  )
}

function SprintGoal({ sprint, canEdit, handleUpdateSprint }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(sprint.goal || '')
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setSaving(true)
    try {
      await handleUpdateSprint(sprint.id, { name: sprint.name, dateRange: sprint.dateRange, goal: draft })
      setEditing(false)
    } catch {
      // keep editing open on failure
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="active-sprint-goal active-sprint-goal--edit">
        <span className="active-sprint-goal__label">Sprint goal</span>
        <textarea
          className="active-sprint-goal__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What should this sprint achieve?"
          rows={2}
        />
        <div className="active-sprint-goal__actions">
          <button className="btn btn-primary" type="button" onClick={onSave} disabled={saving}>Save</button>
          <button className="btn" type="button" onClick={() => { setDraft(sprint.goal || ''); setEditing(false) }}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="active-sprint-goal">
      <span className="active-sprint-goal__label">Sprint goal</span>
      <span className="active-sprint-goal__text">{sprint.goal || 'No goal set for this sprint.'}</span>
      {canEdit && (
        <button className="btn active-sprint-goal__edit" type="button" onClick={() => { setDraft(sprint.goal || ''); setEditing(true) }}>
          {sprint.goal ? 'Edit' : 'Add goal'}
        </button>
      )}
    </div>
  )
}

function RetroPanel({ sprintId, canEdit }) {
  const [retros, setRetros] = useState([])
  const [drafts, setDrafts] = useState({ well: '', improve: '', action: '' })

  const load = useCallback(async () => {
    try {
      const data = await fetchRetros(sprintId)
      setRetros(data)
    } catch {
      setRetros([])
    }
  }, [sprintId])

  useEffect(() => { load() }, [load])

  async function onAdd(category) {
    const text = (drafts[category] || '').trim()
    if (!text) return
    try {
      const created = await addRetro(sprintId, { category, text })
      setRetros((current) => [...current, created])
      setDrafts((d) => ({ ...d, [category]: '' }))
    } catch {
      // ignore add failure
    }
  }

  async function onDelete(retroId) {
    try {
      await deleteRetro(sprintId, retroId)
      setRetros((current) => current.filter((r) => r.id !== retroId))
    } catch {
      // ignore delete failure
    }
  }

  return (
    <div className="active-sprint-retro">
      <h3 className="active-sprint-retro__title">Retrospective</h3>
      <div className="active-sprint-retro__grid">
        {RETRO_COLUMNS.map(({ key, label }) => (
          <article key={key} className="active-sprint-retro__col">
            <header>{label}</header>
            {retros.filter((r) => r.category === key).map((r) => (
              <div key={r.id} className="active-sprint-retro__note">
                <span className="active-sprint-retro__note-text">{r.text}</span>
                {canEdit && (
                  <button className="active-sprint-retro__note-del" type="button" title="Delete" onClick={() => onDelete(r.id)}>&times;</button>
                )}
              </div>
            ))}
            {canEdit && (
              <div className="active-sprint-retro__add">
                <textarea
                  className="active-sprint-retro__input"
                  value={drafts[key]}
                  onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                  placeholder="Add a note..."
                  rows={2}
                />
                <button className="btn" type="button" onClick={() => onAdd(key)}>Add</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}
