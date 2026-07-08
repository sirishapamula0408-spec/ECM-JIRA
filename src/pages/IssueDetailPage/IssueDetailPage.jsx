import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useIssues } from '../../context/IssueContext'
import { useMembers } from '../../context/MemberContext'
import { useSprints } from '../../context/SprintContext'
import { useAuth } from '../../context/AuthContext'
import { fetchIssueById, fetchComments, createComment, fetchSubtasks, createSubtask, getIssueHistory, fetchEpicChildren, fetchIssues } from '../../api/issueApi'
import { fetchProjectById } from '../../api/projectApi'
import { fetchWatchers, watchIssue, unwatchIssue } from '../../api/watcherApi'
import { fetchIssueApprovals, submitApproval } from '../../api/approvalApi'
import { fetchProjectLabels, createLabel, fetchIssueLabels, setIssueLabels } from '../../api/labelApi'
import { fetchAttachments, uploadAttachment, deleteAttachment, downloadAttachment } from '../../api/attachmentApi'
import { fetchIssueLinks, createIssueLink, deleteIssueLink, LINK_TYPES } from '../../api/issueLinkApi'
import { fetchGitLinks, createGitLink, deleteGitLink, GIT_LINK_TYPES, GIT_LINK_TYPE_LABELS } from '../../api/gitIntegrationApi'
import { fetchWorklogs, logWork, setEstimate } from '../../api/worklogApi'
import { fetchIssueCustomFields, setIssueCustomField, createCustomField, deleteCustomField } from '../../api/customFieldApi'
import { fetchCiBuilds } from '../../api/cicdApi'
import { usePermissions } from '../../hooks/usePermissions'
import { MentionInput, MentionText } from '../../components/mentions/MentionInput'
import './IssueDetailPage.css'
import { ISSUE_STATUSES, PRIORITIES, ISSUE_TYPES } from '../../constants'

const TYPE_ICON = {
  Epic:       { icon: '\u{1F3F0}', color: '#6554c0' },
  Story:      { icon: '\u{1F4D7}', color: '#36b37e' },
  Bug:        { icon: '\u{1F41B}', color: '#ff5630' },
  Task:       { icon: '\u2705',     color: '#0065ff' },
  'Sub-task': { icon: '\u{1F517}', color: '#5243aa' },
}

const PRIORITY_ICON = {
  High:   { icon: '\u2191', color: '#ff5630', bg: '#ffebe6' },
  Medium: { icon: '\u2194', color: '#ff991f', bg: '#fff7e6' },
  Low:    { icon: '\u2193', color: '#36b37e', bg: '#e3fcef' },
}

/* ---- Inline editable field (JIRA click-to-edit pattern) ---- */
function InlineField({ editing, onOpen, onClose, display, children }) {
  if (editing) {
    return (
      <div className="id-inline-editor">
        {children}
        <div className="id-inline-actions">
          <button className="id-inline-save" type="button" onClick={onClose} title="Confirm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <button className="id-inline-cancel" type="button" onClick={onClose} title="Cancel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="id-inline-display" onClick={onOpen} title="Click to edit">
      {display}
    </div>
  )
}

export function IssueDetailPage() {
  const { issues, handleMove, handleUpdate } = useIssues()
  const { members, profile } = useMembers()
  const { sprints } = useSprints()
  const { authUser } = useAuth()
  const { issueId } = useParams()
  const navigate = useNavigate()
  const id = Number(issueId)
  const existing = issues.find((item) => item.id === id)
  const [fetchedIssue, setFetchedIssue] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [commentText, setCommentText] = useState('')
  const [comments, setComments] = useState([])
  const [, setCommentsLoading] = useState(false)
  const [activityTab, setActivityTab] = useState('All')
  const [isEditing, setIsEditing] = useState(false)
  const [editDesc, setEditDesc] = useState('')
  const [workLogs, setWorkLogs] = useState([])
  const [workLogTime, setWorkLogTime] = useState('')
  const [workLogDesc, setWorkLogDesc] = useState('')
  const [showWorkLogForm, setShowWorkLogForm] = useState(false)
  const [timeSummary, setTimeSummary] = useState({ estimateText: null, spentText: null, remainingText: null, percent: null })
  const [estimateInput, setEstimateInput] = useState('')
  const [customFields, setCustomFields] = useState([])
  const [showAddField, setShowAddField] = useState(false)
  const [newField, setNewField] = useState({ name: '', fieldType: 'text', options: '' })
  const [activityOpen, setActivityOpen] = useState(true)
  const [isWatching, setIsWatching] = useState(false)
  const [watcherCount, setWatcherCount] = useState(0)
  const [approvals, setApprovals] = useState([])
  const [subtasks, setSubtasks] = useState([])
  const [subtaskProgress, setSubtaskProgress] = useState({ total: 0, done: 0, percent: 0 })
  const [showSubtaskForm, setShowSubtaskForm] = useState(false)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  // JL-76: Epic hierarchy — children of this Epic, its rollup, and a picker catalog
  const [epicChildren, setEpicChildren] = useState([])
  const [epicRollup, setEpicRollup] = useState({ total: 0, done: 0, percent: 0 })
  const [epicOptions, setEpicOptions] = useState([]) // available Epics in this project
  const [attachments, setAttachments] = useState([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)
  const [links, setLinks] = useState([])
  const [ciBuilds, setCiBuilds] = useState([])
  const [showLinkDialog, setShowLinkDialog] = useState(false)
  // JL-55: Git integration (branches / commits / PRs)
  const [gitLinks, setGitLinks] = useState([])
  const [showGitForm, setShowGitForm] = useState(false)
  const [gitLinkType, setGitLinkType] = useState(GIT_LINK_TYPES[0])
  const [gitRef, setGitRef] = useState('')
  const [gitUrl, setGitUrl] = useState('')
  const [gitTitle, setGitTitle] = useState('')
  const [linkType, setLinkType] = useState(LINK_TYPES[0])
  const [linkSearch, setLinkSearch] = useState('')
  const [linkTargetId, setLinkTargetId] = useState('')

  // Inline edit state — which field is open
  const [editingField, setEditingField] = useState(null)
  // Labels — persisted per-issue assignments + project label catalog
  const [labels, setLabels] = useState([]) // [{id,name,color}] assigned to this issue
  const [projectLabels, setProjectLabels] = useState([]) // catalog for the issue's project
  const [labelInput, setLabelInput] = useState('')
  // JL-77: expanded field local state (synced from issue, persisted on edit)
  const [dueDate, setDueDate] = useState('')
  const [startDate, setStartDate] = useState('')
  const [environment, setEnvironment] = useState('')
  const [resolution, setResolution] = useState('')
  const [components, setComponents] = useState('')
  // Change history log (tracked from sidebar edits)
  const [changeHistory, setChangeHistory] = useState([])

  // Logged-in user display name
  const currentUserName = profile?.full_name || authUser?.email || 'You'
  const currentUserInitials = currentUserName.slice(0, 2).toUpperCase()

  useEffect(() => {
    if (existing || !id) return
    fetchIssueById(id).then(setFetchedIssue).catch(() => setFetchedIssue(null))
  }, [id, existing])

  const issue = existing || fetchedIssue
  const { isAdmin } = usePermissions(issue?.projectId)

  useEffect(() => {
    if (!issue?.projectId) { setProjectName(''); return }
    fetchProjectById(issue.projectId)
      .then((data) => setProjectName(data?.name || ''))
      .catch(() => setProjectName(''))
  }, [issue?.projectId])

  // Fetch comments for this issue
  useEffect(() => {
    if (!issue?.id) return
    setCommentsLoading(true)
    fetchComments(issue.id)
      .then((data) => setComments(Array.isArray(data) ? data : []))
      .catch(() => setComments([]))
      .finally(() => setCommentsLoading(false))
  }, [issue?.id])

  // Load watchers
  useEffect(() => {
    if (!issue?.id) return
    fetchWatchers(issue.id)
      .then((data) => { setIsWatching(data.isWatching); setWatcherCount(data.count) })
      .catch(() => {})
  }, [issue?.id])

  // Load approvals
  useEffect(() => {
    if (!issue?.id) return
    fetchIssueApprovals(issue.id)
      .then((data) => setApprovals(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [issue?.id])

  // JL-82: load the persisted per-issue change history (server-backed audit log)
  function reloadHistory() {
    if (!issue?.id) return
    getIssueHistory(issue.id)
      .then((rows) => {
        const mapped = (Array.isArray(rows) ? rows : []).map((h) => {
          const from = h.oldValue == null || h.oldValue === '' ? 'None' : h.oldValue
          const to = h.newValue == null || h.newValue === '' ? 'None' : h.newValue
          const ts = h.changedAt ? new Date(h.changedAt).getTime() : 0
          return {
            id: `ch-${h.id}`,
            type: 'history',
            author: h.actor || 'system',
            text: `changed ${h.field} from "${from}" to "${to}"`,
            time: h.changedAt
              ? new Date(h.changedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
              : 'Just now',
            sortKey: ts,
          }
        })
        setChangeHistory(mapped)
      })
      .catch(() => {})
  }
  useEffect(() => {
    reloadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.id])

  // Load labels assigned to this issue
  useEffect(() => {
    if (!issue?.id) return
    fetchIssueLabels(issue.id)
      .then((data) => setLabels(Array.isArray(data) ? data : []))
      .catch(() => setLabels([]))
  }, [issue?.id])

  // Load the project's label catalog (for the picker)
  useEffect(() => {
    if (!issue?.projectId) { setProjectLabels([]); return }
    fetchProjectLabels(issue.projectId)
      .then((data) => setProjectLabels(Array.isArray(data) ? data : []))
      .catch(() => setProjectLabels([]))
  }, [issue?.projectId])

  // JL-77: sync expanded fields from the loaded issue
  useEffect(() => {
    if (!issue) return
    const toDateInput = (v) => (v ? String(v).slice(0, 10) : '')
    setDueDate(toDateInput(issue.dueDate))
    setStartDate(toDateInput(issue.startDate))
    setEnvironment(issue.environment || '')
    setResolution(issue.resolution || '')
    setComponents(issue.components || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.id])

  // Load sub-tasks (only for non-subtask issues)
  function reloadSubtasks() {
    if (!issue?.id) return
    fetchSubtasks(issue.id)
      .then((data) => { setSubtasks(data.subtasks || []); setSubtaskProgress(data.progress || { total: 0, done: 0, percent: 0 }) })
      .catch(() => { setSubtasks([]); setSubtaskProgress({ total: 0, done: 0, percent: 0 }) })
  }
  useEffect(() => {
    if (!issue?.id || issue?.parentId) return
    reloadSubtasks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.id, issue?.parentId])

  async function handleAddSubtask() {
    const title = subtaskTitle.trim()
    if (!title) return
    try {
      await createSubtask(issue.id, { title })
      setSubtaskTitle('')
      setShowSubtaskForm(false)
      reloadSubtasks()
    } catch {
      // keep form open on failure
    }
  }

  // JL-76: load this Epic's child issues + rollup (only when the issue is an Epic)
  function reloadEpicChildren() {
    if (!issue?.id) return
    fetchEpicChildren(issue.id)
      .then((data) => { setEpicChildren(data.children || []); setEpicRollup(data.rollup || { total: 0, done: 0, percent: 0 }) })
      .catch(() => { setEpicChildren([]); setEpicRollup({ total: 0, done: 0, percent: 0 }) })
  }
  useEffect(() => {
    if (!issue?.id || issue?.issueType !== 'Epic') return
    reloadEpicChildren()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.id, issue?.issueType])

  // JL-76: load the catalog of Epics (for the Epic picker on non-Epic issues)
  useEffect(() => {
    if (!issue?.id || issue?.issueType === 'Epic' || issue?.issueType === 'Sub-task') { setEpicOptions([]); return }
    fetchIssues()
      .then((rows) => {
        const epics = (Array.isArray(rows) ? rows : []).filter(
          (it) => it.issueType === 'Epic' && (!issue.projectId || it.projectId === issue.projectId),
        )
        setEpicOptions(epics)
      })
      .catch(() => setEpicOptions([]))
  }, [issue?.id, issue?.issueType, issue?.projectId])

  async function onChangeEpic(e) {
    const val = e.target.value
    const prev = issue.epicId ?? null
    const next = val === '' ? null : Number(val)
    if (prev !== next) {
      await handleUpdate(issue.id, { epicId: next })
      reloadHistory()
    }
    closeField()
  }

  // Attachments
  useEffect(() => {
    if (!issue?.id) return
    fetchAttachments(issue.id)
      .then((data) => setAttachments(Array.isArray(data) ? data : []))
      .catch(() => setAttachments([]))
  }, [issue?.id])

  async function handleFilesSelected(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    try {
      for (const file of files) {
        const saved = await uploadAttachment(issue.id, file)
        setAttachments((prev) => [saved, ...prev])
      }
    } catch {
      // ignore individual failures
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDeleteAttachment(id) {
    try {
      await deleteAttachment(id)
      setAttachments((prev) => prev.filter((a) => a.id !== id))
    } catch {
      // ignore
    }
  }

  // Time tracking — load worklogs + summary
  function reloadWorklogs() {
    if (!issue?.id) return
    fetchWorklogs(issue.id)
      .then((data) => {
        const mapped = (data.worklogs || []).map((w) => ({
          id: w.id,
          author: w.author,
          time: w.created_at ? new Date(w.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Just now',
          logged: w.timeSpentText || `${w.time_spent_minutes}m`,
          description: w.description || '',
          sortKey: w.created_at ? new Date(w.created_at).getTime() : 0,
        }))
        setWorkLogs(mapped)
        setTimeSummary(data.summary || { estimateText: null, spentText: null, remainingText: null, percent: null })
      })
      .catch(() => {})
  }
  useEffect(() => {
    if (!issue?.id) return
    reloadWorklogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.id])

  async function handleSaveEstimate() {
    try {
      const summary = await setEstimate(issue.id, estimateInput.trim())
      setTimeSummary(summary)
      closeField()
    } catch {
      // ignore
    }
  }

  // Custom fields
  function reloadCustomFields() {
    if (!issue?.id) return
    fetchIssueCustomFields(issue.id)
      .then((data) => setCustomFields(Array.isArray(data) ? data : []))
      .catch(() => setCustomFields([]))
  }
  useEffect(() => {
    if (!issue?.id) return
    reloadCustomFields()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.id])

  async function handleSaveCustomField(fieldId, value) {
    setCustomFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, value } : f)))
    try {
      await setIssueCustomField(issue.id, fieldId, value)
    } catch {
      reloadCustomFields() // rollback to server truth
    }
  }

  async function handleAddCustomField() {
    const name = newField.name.trim()
    if (!name) return
    const options = newField.fieldType === 'dropdown'
      ? newField.options.split(',').map((o) => o.trim()).filter(Boolean)
      : []
    try {
      await createCustomField(issue.projectId, { name, fieldType: newField.fieldType, options })
      setNewField({ name: '', fieldType: 'text', options: '' })
      setShowAddField(false)
      reloadCustomFields()
    } catch {
      // ignore
    }
  }

  async function handleDeleteCustomField(fieldId) {
    try {
      await deleteCustomField(fieldId)
      setCustomFields((prev) => prev.filter((f) => f.id !== fieldId))
    } catch {
      // ignore
    }
  }

  // Issue links
  function reloadLinks() {
    if (!issue?.id) return
    fetchIssueLinks(issue.id)
      .then((data) => setLinks(Array.isArray(data) ? data : []))
      .catch(() => setLinks([]))
  }
  useEffect(() => {
    if (!issue?.id) return
    reloadLinks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.id])

  // CI/CD builds
  useEffect(() => {
    if (!issue?.id) return
    fetchCiBuilds(issue.id)
      .then((data) => setCiBuilds(Array.isArray(data) ? data : []))
      .catch(() => setCiBuilds([]))
  }, [issue?.id])

  async function handleAddLink() {
    if (!linkTargetId) return
    try {
      await createIssueLink(issue.id, { type: linkType, targetIssueId: Number(linkTargetId) })
      setShowLinkDialog(false)
      setLinkSearch('')
      setLinkTargetId('')
      reloadLinks()
    } catch {
      // keep dialog open on failure
    }
  }

  async function handleRemoveLink(linkId) {
    try {
      await deleteIssueLink(linkId)
      setLinks((prev) => prev.filter((l) => l.id !== linkId))
    } catch {
      // ignore
    }
  }

  // JL-55: Git links (branches / commits / PRs)
  function reloadGitLinks() {
    if (!issue?.id) return
    fetchGitLinks(issue.id)
      .then((data) => setGitLinks(Array.isArray(data) ? data : []))
      .catch(() => setGitLinks([]))
  }
  useEffect(() => {
    if (!issue?.id) return
    reloadGitLinks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.id])

  async function handleAddGitLink() {
    if (!gitRef.trim()) return
    try {
      await createGitLink(issue.id, {
        linkType: gitLinkType,
        ref: gitRef.trim(),
        url: gitUrl.trim(),
        title: gitTitle.trim(),
      })
      setShowGitForm(false)
      setGitRef('')
      setGitUrl('')
      setGitTitle('')
      setGitLinkType(GIT_LINK_TYPES[0])
      reloadGitLinks()
    } catch {
      // keep form open on failure
    }
  }

  async function handleRemoveGitLink(id) {
    try {
      await deleteGitLink(id)
      setGitLinks((prev) => prev.filter((g) => g.id !== id))
    } catch {
      // ignore
    }
  }

  async function handleToggleWatch() {
    if (!issue?.id) return
    try {
      if (isWatching) {
        await unwatchIssue(issue.id)
        setIsWatching(false)
        setWatcherCount((c) => Math.max(0, c - 1))
      } else {
        await watchIssue(issue.id)
        setIsWatching(true)
        setWatcherCount((c) => c + 1)
      }
    } catch {
      // ignore
    }
  }

  async function handleApprovalAction(decision) {
    if (!issue?.id) return
    try {
      const result = await submitApproval(issue.id, {
        fromStatus: issue.status,
        toStatus: 'Done',
        decision,
        comment: '',
      })
      setApprovals((prev) => [result, ...prev])
    } catch {
      // ignore
    }
  }

  if (!issue) return <section className="page">Issue not found.</section>

  const typeMeta = TYPE_ICON[issue.issueType] || TYPE_ICON.Task
  const priorityMeta = PRIORITY_ICON[issue.priority] || PRIORITY_ICON.Medium
  const sprint = sprints.find((s) => s.id === issue.sprintId)

  // Build activity entries by type
  const commentEntries = comments.map((c) => ({
    id: c.id,
    type: 'comment',
    author: c.author,
    text: c.text,
    time: c.created_at ? new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Just now',
    sortKey: c.created_at ? new Date(c.created_at).getTime() : 0,
  }))

  const historyEntries = [...changeHistory]

  const workLogEntries = workLogs.map((w) => ({ ...w, type: 'worklog' }))

  // Filter by active tab
  const allEntries = [...commentEntries, ...historyEntries, ...workLogEntries]
    .sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0))
  const visibleEntries =
    activityTab === 'All' ? allEntries
    : activityTab === 'Comments' ? commentEntries
    : activityTab === 'History' ? historyEntries
    : activityTab === 'Work log' ? workLogEntries
    : allEntries

  async function handleAddComment() {
    if (!commentText.trim()) return
    try {
      const saved = await createComment(issue.id, { author: currentUserName, text: commentText.trim() })
      setComments((current) => [saved, ...current])
      setCommentText('')
    } catch {
      // keep text so user can retry
    }
  }

  async function handleAddWorkLog() {
    if (!workLogTime.trim()) return
    try {
      await logWork(issue.id, { timeSpent: workLogTime.trim(), description: workLogDesc.trim() })
      setWorkLogTime('')
      setWorkLogDesc('')
      setShowWorkLogForm(false)
      reloadWorklogs()
    } catch {
      // keep form open on failure (e.g. unparseable time)
    }
  }

  function startEditDesc() {
    setEditDesc(issue.description || '')
    setIsEditing(true)
  }

  function openField(field) {
    setEditingField(field)
  }

  function closeField() {
    setEditingField(null)
  }

  // JL-77: persist expanded fields on inline-edit close
  async function saveDueDate() {
    const prev = issue.dueDate ? String(issue.dueDate).slice(0, 10) : ''
    const next = dueDate || ''
    if (prev !== next) {
      await handleUpdate(issue.id, { dueDate: next || null })
      addHistoryEntry('Due date', prev || 'None', next || 'None')
    }
    closeField()
  }
  async function saveStartDate() {
    const prev = issue.startDate ? String(issue.startDate).slice(0, 10) : ''
    const next = startDate || ''
    if (prev !== next) {
      await handleUpdate(issue.id, { startDate: next || null })
      addHistoryEntry('Start date', prev || 'None', next || 'None')
    }
    closeField()
  }
  async function saveEnvironment() {
    const prev = issue.environment || ''
    const next = environment.trim()
    if (prev !== next) {
      await handleUpdate(issue.id, { environment: next || null })
      addHistoryEntry('Environment', prev || 'None', next || 'None')
    }
    closeField()
  }
  async function saveResolution() {
    const prev = issue.resolution || ''
    const next = resolution.trim()
    if (prev !== next) {
      await handleUpdate(issue.id, { resolution: next || null })
      addHistoryEntry('Resolution', prev || 'None', next || 'None')
    }
    closeField()
  }
  async function saveComponents() {
    const prev = issue.components || ''
    const next = components.trim()
    if (prev !== next) {
      await handleUpdate(issue.id, { components: next || null })
      addHistoryEntry('Components', prev || 'None', next || 'None')
    }
    closeField()
  }

  async function onChangeAssignee(e) {
    const prev = issue.assignee || 'Unassigned'
    const next = e.target.value || 'Unassigned'
    await handleUpdate(issue.id, { assignee: e.target.value })
    if (prev !== next) reloadHistory()
    closeField()
  }

  async function onChangePriority(e) {
    const prev = issue.priority
    const next = e.target.value
    await handleUpdate(issue.id, { priority: next })
    if (prev !== next) reloadHistory()
    closeField()
  }

  async function onChangeType(e) {
    const prev = issue.issueType
    const next = e.target.value
    await handleUpdate(issue.id, { issueType: next })
    if (prev !== next) reloadHistory()
    closeField()
  }

  async function onChangeSprint(e) {
    const val = e.target.value
    const prevName = sprint ? sprint.name : 'None'
    await handleUpdate(issue.id, { sprintId: val === '' ? null : Number(val) })
    const nextSprint = sprints.find((s) => s.id === Number(val))
    const nextName = nextSprint ? nextSprint.name : 'None'
    if (prevName !== nextName) reloadHistory()
    closeField()
  }

  async function persistLabels(nextLabels) {
    const prev = labels
    setLabels(nextLabels) // optimistic
    try {
      const saved = await setIssueLabels(issue.id, nextLabels.map((l) => l.id))
      setLabels(Array.isArray(saved) ? saved : nextLabels)
    } catch {
      setLabels(prev) // rollback
    }
  }

  async function addLabel() {
    const trimmed = labelInput.trim()
    if (!trimmed) return
    setLabelInput('')
    // Find an existing catalog label (case-insensitive) or create one inline
    let label = projectLabels.find((l) => l.name.toLowerCase() === trimmed.toLowerCase())
    if (!label) {
      try {
        label = await createLabel(issue.projectId, { name: trimmed, color: '#42526E' })
        setProjectLabels((prev) => [...prev, label].sort((a, b) => a.name.localeCompare(b.name)))
      } catch {
        return
      }
    }
    if (!labels.some((l) => l.id === label.id)) {
      persistLabels([...labels, label])
    }
  }

  function toggleLabel(label) {
    if (labels.some((l) => l.id === label.id)) {
      persistLabels(labels.filter((l) => l.id !== label.id))
    } else {
      persistLabels([...labels, label])
    }
  }

  function removeLabel(label) {
    persistLabels(labels.filter((l) => l.id !== label.id))
  }

  return (
    <section className="page issue-detail-page">
      {/* ---- Breadcrumb bar ---- */}
      <div className="id-breadcrumb-bar">
        <nav className="id-breadcrumbs">
          <button type="button" className="id-breadcrumb-link" onClick={() => navigate('/projects')}>Projects</button>
          <span className="id-breadcrumb-sep">/</span>
          <button type="button" className="id-breadcrumb-link" onClick={() => navigate(issue.projectId ? `/projects/${issue.projectId}` : '/projects')}>{projectName || 'Project'}</button>
          <span className="id-breadcrumb-sep">/</span>
          <span className="id-breadcrumb-current">{issue.key || `IT-${issue.id}`}</span>
        </nav>
        <div className="id-top-actions" />
      </div>

      {/* ---- Main grid ---- */}
      <div className="id-layout">
        {/* ======== LEFT ======== */}
        <div className="id-main">
          <div className="id-type-row">
            <span className="id-type-icon" style={{ color: typeMeta.color }}>{typeMeta.icon}</span>
            <span className="id-issue-key">{issue.key || `IT-${issue.id}`}</span>
          </div>

          <h1 className="id-title">{issue.title}</h1>

          <div className="id-quick-actions">
            <button className="id-quick-btn" type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              {uploading ? 'Uploading…' : 'Attach'}
            </button>
            <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFilesSelected} />
            <button className="id-quick-btn" type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
              Create subtask
            </button>
            <button className="id-quick-btn" type="button" onClick={() => setShowLinkDialog((v) => !v)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              Link issue
            </button>
            <button className={`id-quick-btn${isWatching ? ' id-quick-btn--active' : ''}`} type="button" onClick={handleToggleWatch}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              {isWatching ? 'Watching' : 'Watch'} ({watcherCount})
            </button>
          </div>

          {/* Description */}
          <div className="id-section">
            <h3 className="id-section-title">Description</h3>
            {isEditing ? (
              <div className="id-desc-edit">
                <textarea className="id-desc-textarea" rows={5} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                <div className="id-desc-edit-actions">
                  <button className="btn btn-primary btn-sm" type="button" onClick={() => setIsEditing(false)}>Save</button>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => setIsEditing(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="id-description" onClick={startEditDesc} title="Click to edit">
                {issue.description ? <p>{issue.description}</p> : <p className="id-placeholder">Add a description...</p>}
              </div>
            )}
          </div>

          {attachments.length > 0 && (
            <div className="id-section">
              <h3 className="id-section-title">Attachments ({attachments.length})</h3>
              <div className="id-attach-grid">
                {attachments.map((a) => (
                  <div key={a.id} className="id-attach-card">
                    <button type="button" className="id-attach-open" onClick={() => downloadAttachment(a)} title={`Download ${a.filename}`}>
                      <span className="id-attach-icon">{a.isImage ? '🖼️' : '📄'}</span>
                      <span className="id-attach-name">{a.filename}</span>
                      <span className="id-attach-size">{a.size != null ? `${Math.max(1, Math.round(a.size / 1024))} KB` : ''}</span>
                    </button>
                    <button type="button" className="id-attach-delete" onClick={() => handleDeleteAttachment(a.id)} aria-label="Delete attachment">&times;</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!issue.parentId && (
          <div className="id-section">
            <div className="id-subtask-header">
              <h3 className="id-section-title">Child issues</h3>
              {subtaskProgress.total > 0 && (
                <div className="id-subtask-progress">
                  <div className="id-subtask-bar"><div className="id-subtask-bar-fill" style={{ width: `${subtaskProgress.percent}%` }} /></div>
                  <span className="id-subtask-progress-label">{subtaskProgress.done} / {subtaskProgress.total} done</span>
                </div>
              )}
            </div>
            {subtasks.length === 0 ? (
              <p className="id-empty-text">No child issues.</p>
            ) : (
              <ul className="id-subtask-list">
                {subtasks.map((st) => (
                  <li key={st.id} className="id-subtask-row" onClick={() => navigate(`/issues/${st.id}`)}>
                    <span className="id-subtask-key">{st.key}</span>
                    <span className="id-subtask-title">{st.title}</span>
                    <span className={`id-subtask-status id-subtask-status--${String(st.status).toLowerCase().replace(/\s+/g, '-')}`}>{st.status}</span>
                  </li>
                ))}
              </ul>
            )}
            {showSubtaskForm ? (
              <div className="id-subtask-form">
                <input className="id-inline-input" value={subtaskTitle} autoFocus placeholder="Sub-task summary"
                  onChange={(e) => setSubtaskTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddSubtask() } else if (e.key === 'Escape') { setShowSubtaskForm(false); setSubtaskTitle('') } }} />
                <button className="btn btn-primary btn-sm" type="button" onClick={handleAddSubtask}>Add</button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setShowSubtaskForm(false); setSubtaskTitle('') }}>Cancel</button>
              </div>
            ) : (
              <button className="id-subtask-add-btn" type="button" onClick={() => setShowSubtaskForm(true)}>+ Add sub-task</button>
            )}
          </div>
          )}

          {/* JL-76: Epic-progress panel — only when this issue is an Epic */}
          {issue.issueType === 'Epic' && (
          <div className="id-section">
            <div className="id-subtask-header">
              <h3 className="id-section-title">Epic progress</h3>
              {epicRollup.total > 0 && (
                <div className="id-subtask-progress">
                  <div className="id-subtask-bar"><div className="id-subtask-bar-fill" style={{ width: `${epicRollup.percent}%` }} /></div>
                  <span className="id-subtask-progress-label">{epicRollup.done} / {epicRollup.total} done ({epicRollup.percent}%)</span>
                </div>
              )}
            </div>
            {epicChildren.length === 0 ? (
              <p className="id-empty-text">No issues in this epic yet. Assign issues to this epic from their Epic field.</p>
            ) : (
              <ul className="id-subtask-list">
                {epicChildren.map((ch) => (
                  <li key={ch.id} className="id-subtask-row" onClick={() => navigate(`/issues/${ch.id}`)}>
                    <span className="id-subtask-key">{ch.key}</span>
                    <span className="id-subtask-title">{ch.title}</span>
                    <span className={`id-subtask-status id-subtask-status--${String(ch.status).toLowerCase().replace(/\s+/g, '-')}`}>{ch.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          )}

          <div className="id-section">
            <div className="id-subtask-header">
              <h3 className="id-section-title">Linked issues</h3>
              <button className="id-subtask-add-btn" type="button" onClick={() => setShowLinkDialog(true)}>+ Add link</button>
            </div>
            {showLinkDialog && (
              <div className="id-link-dialog">
                <select className="id-inline-select" value={linkType} onChange={(e) => setLinkType(e.target.value)}>
                  {LINK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input className="id-inline-input" placeholder="Search issue by key or title..." value={linkSearch} onChange={(e) => setLinkSearch(e.target.value)} />
                <select className="id-inline-select" value={linkTargetId} onChange={(e) => setLinkTargetId(e.target.value)}>
                  <option value="">Select issue…</option>
                  {issues
                    .filter((it) => it.id !== issue.id)
                    .filter((it) => {
                      const q = linkSearch.trim().toLowerCase()
                      if (!q) return true
                      return String(it.key || '').toLowerCase().includes(q) || String(it.title || '').toLowerCase().includes(q)
                    })
                    .slice(0, 50)
                    .map((it) => <option key={it.id} value={it.id}>{it.key} — {it.title}</option>)}
                </select>
                <div className="id-link-dialog-actions">
                  <button className="btn btn-primary btn-sm" type="button" onClick={handleAddLink} disabled={!linkTargetId}>Link</button>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setShowLinkDialog(false); setLinkSearch(''); setLinkTargetId('') }}>Cancel</button>
                </div>
              </div>
            )}
            {links.length === 0 ? (
              <p className="id-empty-text">No linked issues.</p>
            ) : (
              <ul className="id-subtask-list">
                {links.map((l) => (
                  <li key={l.id} className="id-subtask-row">
                    <span className="id-link-type">{l.type}</span>
                    <span className="id-subtask-key" onClick={() => navigate(`/issues/${l.issue.id}`)} style={{ cursor: 'pointer' }}>{l.issue.key}</span>
                    <span className="id-subtask-title" onClick={() => navigate(`/issues/${l.issue.id}`)} style={{ cursor: 'pointer' }}>{l.issue.title}</span>
                    <span className={`id-subtask-status id-subtask-status--${String(l.issue.status).toLowerCase().replace(/\s+/g, '-')}`}>{l.issue.status}</span>
                    <button type="button" className="id-attach-delete" onClick={() => handleRemoveLink(l.id)} aria-label="Remove link">&times;</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* JL-55: Development (git branches / commits / pull requests) */}
          <div className="id-section">
            <div className="id-subtask-header">
              <h3 className="id-section-title">Development</h3>
              <button className="id-subtask-add-btn" type="button" onClick={() => setShowGitForm((v) => !v)}>+ Link branch/commit/PR</button>
            </div>
            {showGitForm && (
              <div className="id-link-dialog">
                <select className="id-inline-select" value={gitLinkType} onChange={(e) => setGitLinkType(e.target.value)}>
                  {GIT_LINK_TYPES.map((t) => <option key={t} value={t}>{GIT_LINK_TYPE_LABELS[t]}</option>)}
                </select>
                <input className="id-inline-input" placeholder="Ref (branch name, commit SHA, PR #)…" value={gitRef} onChange={(e) => setGitRef(e.target.value)} />
                <input className="id-inline-input" placeholder="Title (optional)…" value={gitTitle} onChange={(e) => setGitTitle(e.target.value)} />
                <input className="id-inline-input" placeholder="URL (optional)…" value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} />
                <div className="id-link-dialog-actions">
                  <button className="btn btn-primary btn-sm" type="button" onClick={handleAddGitLink} disabled={!gitRef.trim()}>Link</button>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setShowGitForm(false); setGitRef(''); setGitUrl(''); setGitTitle('') }}>Cancel</button>
                </div>
              </div>
            )}
            {gitLinks.length === 0 ? (
              <p className="id-empty-text">No linked branches, commits, or pull requests.</p>
            ) : (
              GIT_LINK_TYPES.filter((t) => gitLinks.some((g) => g.link_type === t)).map((t) => (
                <div key={t} className="id-git-group">
                  <div className="id-git-group-label">{GIT_LINK_TYPE_LABELS[t]}</div>
                  <ul className="id-subtask-list">
                    {gitLinks.filter((g) => g.link_type === t).map((g) => (
                      <li key={g.id} className="id-subtask-row">
                        <span className="id-git-icon" aria-hidden="true">
                          {t === 'branch' ? '⎇' : t === 'commit' ? '●' : '⎇'}
                        </span>
                        {g.url ? (
                          <a className="id-subtask-key" href={g.url} target="_blank" rel="noreferrer">{g.ref}</a>
                        ) : (
                          <span className="id-subtask-key">{g.ref}</span>
                        )}
                        <span className="id-subtask-title">{g.title || ''}</span>
                        {g.author && <span className="id-git-author">{g.author}</span>}
                        <button type="button" className="id-attach-delete" onClick={() => handleRemoveGitLink(g.id)} aria-label="Remove git link">&times;</button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>

          {/* CI/CD Pipeline Status */}
          <div className="id-section">
            <h3 className="id-section-title">CI/CD ({ciBuilds.length})</h3>
            {ciBuilds.length === 0 ? (
              <p className="id-empty-text">No builds recorded.</p>
            ) : (
              <ul className="id-ci-list">
                {ciBuilds.map((b) => (
                  <li key={b.id} className="id-ci-row">
                    <span className={`id-ci-status id-ci-status--${b.status}`}>{b.status}</span>
                    <span className="id-ci-pipeline">{b.pipeline || 'pipeline'}</span>
                    {b.branch && <span className="id-ci-branch">{b.branch}</span>}
                    {typeof b.duration_seconds === 'number' && (
                      <span className="id-ci-duration">{b.duration_seconds}s</span>
                    )}
                    {b.url && (
                      <a className="id-ci-link" href={b.url} target="_blank" rel="noopener noreferrer">View</a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Activity */}
          <div className="id-section">
            <button type="button" className="id-section-title id-section-title--collapsible" onClick={() => setActivityOpen((v) => !v)}>
              Activity
              <svg className={`id-collapse-chevron${activityOpen ? '' : ' id-collapse-chevron--closed'}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {activityOpen && <>
            <div className="id-activity-tabs">
              {['All', 'Comments', 'History', 'Work log'].map((tab) => (
                <button key={tab} type="button" className={`id-activity-tab${activityTab === tab ? ' active' : ''}`} onClick={() => setActivityTab(tab)}>
                  {tab}
                  {tab === 'Comments' && commentEntries.length > 0 && <span className="id-tab-count">{commentEntries.length}</span>}
                  {tab === 'History' && historyEntries.length > 0 && <span className="id-tab-count">{historyEntries.length}</span>}
                  {tab === 'Work log' && workLogEntries.length > 0 && <span className="id-tab-count">{workLogEntries.length}</span>}
                </button>
              ))}
            </div>

            {/* Comment input — show on All or Comments tab */}
            {(activityTab === 'All' || activityTab === 'Comments') && (
              <div className="id-comment-input">
                <span className="id-comment-avatar id-comment-avatar--me">{currentUserInitials}</span>
                <div className="id-comment-box">
                  <span className="id-comment-user-name">{currentUserName}</span>
                  <MentionInput rows={2} value={commentText} onChange={setCommentText} placeholder="Add a comment... Use @email to mention someone" className="id-comment-textarea" />
                  {commentText.trim() && (
                    <div className="id-comment-actions">
                      <button className="btn btn-primary btn-sm" type="button" onClick={handleAddComment}>Save</button>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => setCommentText('')}>Cancel</button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Work log input — show on Work log tab */}
            {activityTab === 'Work log' && (
              <div className="id-worklog-area">
                <div className="id-time-summary">
                  <div className="id-time-bar"><div className="id-time-bar-fill" style={{ width: `${timeSummary.percent ?? 0}%` }} /></div>
                  <div className="id-time-stats">
                    <span><strong>{timeSummary.spentText || '0m'}</strong> logged</span>
                    <span>{timeSummary.remainingText != null ? `${timeSummary.remainingText} remaining` : 'No estimate'}</span>
                    <span>{timeSummary.estimateText ? `${timeSummary.estimateText} estimated` : ''}</span>
                  </div>
                </div>
                {!showWorkLogForm ? (
                  <button className="id-worklog-add-btn" type="button" onClick={() => setShowWorkLogForm(true)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Log work
                  </button>
                ) : (
                  <div className="id-worklog-form">
                    <div className="id-worklog-form-row">
                      <label>Time spent</label>
                      <input className="id-inline-input" value={workLogTime} onChange={(e) => setWorkLogTime(e.target.value)} placeholder="e.g. 2h 30m" autoFocus />
                    </div>
                    <div className="id-worklog-form-row">
                      <label>Description</label>
                      <input className="id-inline-input" value={workLogDesc} onChange={(e) => setWorkLogDesc(e.target.value)} placeholder="What did you work on?" />
                    </div>
                    <div className="id-worklog-form-actions">
                      <button className="btn btn-primary btn-sm" type="button" onClick={handleAddWorkLog}>Log</button>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setShowWorkLogForm(false); setWorkLogTime(''); setWorkLogDesc('') }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Activity feed */}
            <div className="id-activity-feed">
              {visibleEntries.length === 0 && (
                <p className="id-empty-text">
                  {activityTab === 'Comments' ? 'No comments yet.' : activityTab === 'History' ? 'No changes recorded.' : activityTab === 'Work log' ? 'No work logged.' : 'No activity yet.'}
                </p>
              )}
              {visibleEntries.map((entry) => (
                <div key={entry.id} className={`id-activity-item id-activity-item--${entry.type}`}>
                  <span className={`id-comment-avatar${entry.author === currentUserName ? ' id-comment-avatar--me' : ''}`}>
                    {entry.author.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="id-activity-item-body">
                    <div className="id-comment-meta">
                      <strong>{entry.author}</strong>
                      {entry.type === 'history' && <span className="id-history-badge">History</span>}
                      {entry.type === 'worklog' && <span className="id-worklog-badge">Work log</span>}
                      <span className="id-comment-time">{entry.time}</span>
                    </div>
                    {entry.type === 'comment' && (
                      <p className="id-comment-text"><MentionText text={entry.text} /></p>
                    )}
                    {entry.type === 'history' && (
                      <p className="id-history-text">{entry.text}</p>
                    )}
                    {entry.type === 'worklog' && (
                      <div className="id-worklog-detail">
                        <span className="id-worklog-time-badge">{entry.logged}</span>
                        {entry.description && <span className="id-worklog-desc">{entry.description}</span>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            </>}
          </div>
        </div>

        {/* ======== RIGHT SIDEBAR (editable fields) ======== */}
        <aside className="id-sidebar">
          {/* Status */}
          <div className="id-sidebar-status">
            <select
              className="id-status-select"
              value={issue.status}
              onChange={(e) => handleMove(issue.id, e.target.value)}
              style={{
                background: issue.status === 'Done' ? '#e3fcef' : issue.status === 'In Progress' ? '#deebff' : issue.status === 'Code Review' ? '#eae6ff' : '#dfe1e6',
                color: issue.status === 'Done' ? '#006644' : issue.status === 'In Progress' ? '#0052cc' : issue.status === 'Code Review' ? '#5243aa' : '#42526e',
              }}
            >
              {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Details */}
          <div className="id-sidebar-section">
            <div className="id-sidebar-section-header"><h4>Details</h4></div>
            <dl className="id-detail-list">
              {/* Assignee — editable */}
              <div className="id-detail-row">
                <dt>Assignee</dt>
                <dd>
                  <InlineField
                    editing={editingField === 'assignee'}
                    onOpen={() => openField('assignee')}
                    onClose={closeField}
                    display={
                      <div className="id-detail-user">
                        <span className="id-detail-avatar">{(issue.assignee || 'U').slice(0, 2).toUpperCase()}</span>
                        <span>{issue.assignee || 'Unassigned'}</span>
                        <span className="id-edit-pencil">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </span>
                      </div>
                    }
                  >
                    <select className="id-inline-select" value={issue.assignee || ''} onChange={onChangeAssignee} autoFocus>
                      <option value="">Unassigned</option>
                      {members.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                    </select>
                  </InlineField>
                </dd>
              </div>

              {/* Reporter — read-only (JL-77: from persisted issue.reporter) */}
              <div className="id-detail-row">
                <dt>Reporter</dt>
                <dd>
                  <div className="id-detail-user">
                    <span className="id-detail-avatar" style={{ background: '#0052cc', color: '#fff' }}>
                      {(issue.reporter || profile?.full_name || 'U').slice(0, 2).toUpperCase()}
                    </span>
                    <span>{issue.reporter || profile?.full_name || 'Unknown'}</span>
                  </div>
                </dd>
              </div>

              {/* Priority — editable */}
              <div className="id-detail-row">
                <dt>Priority</dt>
                <dd>
                  <InlineField
                    editing={editingField === 'priority'}
                    onOpen={() => openField('priority')}
                    onClose={closeField}
                    display={
                      <span className="id-priority-badge" style={{ background: priorityMeta.bg, color: priorityMeta.color }}>
                        <span className="id-priority-arrow">{priorityMeta.icon}</span>
                        {issue.priority}
                        <span className="id-edit-pencil">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </span>
                      </span>
                    }
                  >
                    <select className="id-inline-select" value={issue.priority} onChange={onChangePriority} autoFocus>
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </InlineField>
                </dd>
              </div>

              {/* Type — editable */}
              <div className="id-detail-row">
                <dt>Type</dt>
                <dd>
                  <InlineField
                    editing={editingField === 'type'}
                    onOpen={() => openField('type')}
                    onClose={closeField}
                    display={
                      <span className="id-type-badge">
                        <span style={{ color: typeMeta.color }}>{typeMeta.icon}</span>
                        {issue.issueType}
                        <span className="id-edit-pencil">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </span>
                      </span>
                    }
                  >
                    <select className="id-inline-select" value={issue.issueType} onChange={onChangeType} autoFocus>
                      {ISSUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </InlineField>
                </dd>
              </div>

              {/* Epic — editable (JL-76; hidden for Epics and Sub-tasks) */}
              {issue.issueType !== 'Epic' && issue.issueType !== 'Sub-task' && (
              <div className="id-detail-row">
                <dt>Epic</dt>
                <dd>
                  <InlineField
                    editing={editingField === 'epic'}
                    onOpen={() => openField('epic')}
                    onClose={closeField}
                    display={
                      <span className="id-sprint-display">
                        {(() => {
                          const ep = epicOptions.find((e) => e.id === issue.epicId)
                          return issue.epicId
                            ? (ep ? `${ep.key} — ${ep.title}` : `#${issue.epicId}`)
                            : <span className="id-empty-value">None</span>
                        })()}
                        <span className="id-edit-pencil">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </span>
                      </span>
                    }
                  >
                    <select className="id-inline-select" value={issue.epicId || ''} onChange={onChangeEpic} autoFocus>
                      <option value="">None</option>
                      {epicOptions.map((e) => <option key={e.id} value={e.id}>{e.key} — {e.title}</option>)}
                    </select>
                  </InlineField>
                </dd>
              </div>
              )}

              {/* Labels — editable (local only) */}
              <div className="id-detail-row">
                <dt>Labels</dt>
                <dd>
                  <InlineField
                    editing={editingField === 'labels'}
                    onOpen={() => openField('labels')}
                    onClose={closeField}
                    display={
                      <div className="id-labels-wrap">
                        {labels.length > 0 ? labels.map((l) => (
                          <span key={l.id} className="pill" style={{ background: `${l.color}22`, color: l.color, borderColor: `${l.color}55` }}>{l.name}</span>
                        )) : <span className="id-empty-value">None</span>}
                        <span className="id-edit-pencil">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </span>
                      </div>
                    }
                  >
                    <div className="id-labels-editor">
                      <div className="id-labels-list">
                        {labels.map((l) => (
                          <span key={l.id} className="id-label-chip" style={{ background: `${l.color}22`, color: l.color }}>
                            {l.name}
                            <button type="button" className="id-label-remove" onClick={() => removeLabel(l)}>&times;</button>
                          </span>
                        ))}
                      </div>
                      {projectLabels.filter((pl) => !labels.some((l) => l.id === pl.id)).length > 0 && (
                        <div className="id-label-suggestions">
                          {projectLabels.filter((pl) => !labels.some((l) => l.id === pl.id)).map((pl) => (
                            <button key={pl.id} type="button" className="id-label-suggestion" style={{ color: pl.color }} onClick={() => toggleLabel(pl)}>
                              + {pl.name}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="id-label-add-row">
                        <input
                          className="id-inline-input"
                          value={labelInput}
                          onChange={(e) => setLabelInput(e.target.value)}
                          placeholder="Add or create label..."
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLabel() } }}
                        />
                        <button className="id-label-add-btn" type="button" onClick={addLabel}>Add</button>
                      </div>
                    </div>
                  </InlineField>
                </dd>
              </div>

              {/* Sprint — editable */}
              <div className="id-detail-row">
                <dt>Sprint</dt>
                <dd>
                  <InlineField
                    editing={editingField === 'sprint'}
                    onOpen={() => openField('sprint')}
                    onClose={closeField}
                    display={
                      <span className="id-sprint-display">
                        {sprint ? sprint.name : <span className="id-empty-value">None</span>}
                        <span className="id-edit-pencil">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </span>
                      </span>
                    }
                  >
                    <select className="id-inline-select" value={issue.sprintId || ''} onChange={onChangeSprint} autoFocus>
                      <option value="">None</option>
                      {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </InlineField>
                </dd>
              </div>
            </dl>
          </div>

          {/* Dates */}
          <div className="id-sidebar-section">
            <div className="id-sidebar-section-header"><h4>Dates</h4></div>
            <dl className="id-detail-list">
              <div className="id-detail-row">
                <dt>Created</dt>
                <dd>{issue.createdAt ? new Date(issue.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown'}</dd>
              </div>
              {/* JL-77: Start date */}
              <div className="id-detail-row">
                <dt>Start date</dt>
                <dd>
                  <InlineField
                    editing={editingField === 'startDate'}
                    onOpen={() => openField('startDate')}
                    onClose={saveStartDate}
                    display={
                      <span className="id-sprint-display">
                        {startDate ? new Date(startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : <span className="id-empty-value">None</span>}
                        <span className="id-edit-pencil">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </span>
                      </span>
                    }
                  >
                    <input
                      className="id-inline-input"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      autoFocus
                    />
                  </InlineField>
                </dd>
              </div>
              <div className="id-detail-row">
                <dt>Due date</dt>
                <dd>
                  <InlineField
                    editing={editingField === 'dueDate'}
                    onOpen={() => openField('dueDate')}
                    onClose={saveDueDate}
                    display={
                      <span className="id-sprint-display">
                        {dueDate ? new Date(dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : <span className="id-empty-value">None</span>}
                        <span className="id-edit-pencil">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </span>
                      </span>
                    }
                  >
                    <input
                      className="id-inline-input"
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      autoFocus
                    />
                  </InlineField>
                </dd>
              </div>
              <div className="id-detail-row">
                <dt>Estimate</dt>
                <dd>
                  <InlineField
                    editing={editingField === 'estimate'}
                    onOpen={() => { setEstimateInput(timeSummary.estimateText || ''); openField('estimate') }}
                    onClose={handleSaveEstimate}
                    display={
                      <span className="id-sprint-display">
                        {timeSummary.estimateText ? timeSummary.estimateText : <span className="id-empty-value">None</span>}
                        <span className="id-edit-pencil">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </span>
                      </span>
                    }
                  >
                    <input
                      className="id-inline-input"
                      value={estimateInput}
                      onChange={(e) => setEstimateInput(e.target.value)}
                      placeholder="e.g. 1d 4h"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveEstimate() } }}
                      autoFocus
                    />
                  </InlineField>
                </dd>
              </div>
            </dl>
          </div>

          {/* JL-77: Components / Environment / Resolution */}
          <div className="id-sidebar-section">
            <div className="id-sidebar-section-header"><h4>More details</h4></div>
            <dl className="id-detail-list">
              <div className="id-detail-row">
                <dt>Components</dt>
                <dd>
                  <InlineField
                    editing={editingField === 'components'}
                    onOpen={() => openField('components')}
                    onClose={saveComponents}
                    display={
                      <span className="id-sprint-display">
                        {components ? components : <span className="id-empty-value">None</span>}
                        <span className="id-edit-pencil">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </span>
                      </span>
                    }
                  >
                    <input
                      className="id-inline-input"
                      value={components}
                      onChange={(e) => setComponents(e.target.value)}
                      placeholder="Comma-separated, e.g. API, UI"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveComponents() } }}
                      autoFocus
                    />
                  </InlineField>
                </dd>
              </div>
              <div className="id-detail-row">
                <dt>Environment</dt>
                <dd>
                  <InlineField
                    editing={editingField === 'environment'}
                    onOpen={() => openField('environment')}
                    onClose={saveEnvironment}
                    display={
                      <span className="id-sprint-display">
                        {environment ? environment : <span className="id-empty-value">None</span>}
                        <span className="id-edit-pencil">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </span>
                      </span>
                    }
                  >
                    <input
                      className="id-inline-input"
                      value={environment}
                      onChange={(e) => setEnvironment(e.target.value)}
                      placeholder="e.g. Production, Chrome 120"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEnvironment() } }}
                      autoFocus
                    />
                  </InlineField>
                </dd>
              </div>
              <div className="id-detail-row">
                <dt>Resolution</dt>
                <dd>
                  <InlineField
                    editing={editingField === 'resolution'}
                    onOpen={() => openField('resolution')}
                    onClose={saveResolution}
                    display={
                      <span className="id-sprint-display">
                        {resolution ? resolution : <span className="id-empty-value">Unresolved</span>}
                        <span className="id-edit-pencil">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </span>
                      </span>
                    }
                  >
                    <input
                      className="id-inline-input"
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                      placeholder="e.g. Fixed, Won't Do, Duplicate"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveResolution() } }}
                      autoFocus
                    />
                  </InlineField>
                </dd>
              </div>
            </dl>
          </div>

          {/* Custom fields */}
          {(customFields.length > 0 || isAdmin) && (
          <div className="id-sidebar-section">
            <div className="id-sidebar-section-header"><h4>More fields</h4></div>
            <dl className="id-detail-list">
              {customFields.map((f) => (
                <div className="id-detail-row" key={f.id}>
                  <dt>
                    {f.name}
                    {isAdmin && <button type="button" className="id-cf-delete" title="Delete field" onClick={() => handleDeleteCustomField(f.id)}>&times;</button>}
                  </dt>
                  <dd>
                    {f.fieldType === 'dropdown' ? (
                      <select className="id-inline-select" value={f.value || ''} onChange={(e) => handleSaveCustomField(f.id, e.target.value)}>
                        <option value="">—</option>
                        {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        className="id-inline-input"
                        type={f.fieldType === 'number' ? 'number' : f.fieldType === 'date' ? 'date' : 'text'}
                        defaultValue={f.value || ''}
                        onBlur={(e) => { if (e.target.value !== (f.value || '')) handleSaveCustomField(f.id, e.target.value) }}
                      />
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {isAdmin && (
              showAddField ? (
                <div className="id-cf-add">
                  <input className="id-inline-input" placeholder="Field name" value={newField.name} onChange={(e) => setNewField((n) => ({ ...n, name: e.target.value }))} />
                  <select className="id-inline-select" value={newField.fieldType} onChange={(e) => setNewField((n) => ({ ...n, fieldType: e.target.value }))}>
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                    <option value="dropdown">Dropdown</option>
                  </select>
                  {newField.fieldType === 'dropdown' && (
                    <input className="id-inline-input" placeholder="Options, comma-separated" value={newField.options} onChange={(e) => setNewField((n) => ({ ...n, options: e.target.value }))} />
                  )}
                  <div className="id-link-dialog-actions">
                    <button className="btn btn-primary btn-sm" type="button" onClick={handleAddCustomField}>Add field</button>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowAddField(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button className="id-subtask-add-btn" type="button" onClick={() => setShowAddField(true)}>+ Add custom field</button>
              )
            )}
          </div>
          )}

          {/* Approvals */}
          <div className="id-sidebar-section">
            <div className="id-sidebar-section-header"><h4>Approvals</h4></div>
            {approvals.length === 0 ? (
              <p className="id-empty-text" style={{ fontSize: '12px', padding: '4px 0' }}>No approvals yet.</p>
            ) : (
              <div className="id-approval-list">
                {approvals.slice(0, 5).map((a) => (
                  <div key={a.id} className="id-approval-item">
                    <span className={`id-approval-badge id-approval-badge--${a.decision}`}>
                      {a.decision === 'approved' ? '\u2705' : a.decision === 'rejected' ? '\u274C' : '\u23F3'} {a.decision}
                    </span>
                    <span className="id-approval-by">{a.approver_email}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="id-approval-actions" style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => handleApprovalAction('approved')}>Approve</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleApprovalAction('rejected')}>Reject</button>
            </div>
          </div>

        </aside>
      </div>
    </section>
  )
}
