import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, InputLabel, MenuItem, OutlinedInput, Select, TextField,
  ToggleButton, ToggleButtonGroup, Checkbox, ListItemText, CircularProgress,
} from '@mui/material'
import { fetchProjects } from '../../api/projectApi'
import {
  fetchCrossProjectBoards, createCrossProjectBoard, updateCrossProjectBoard,
  deleteCrossProjectBoard, fetchCrossProjectBoardIssues,
} from '../../api/crossProjectBoardApi'
import EmptyState from '../../components/common/EmptyState'
import { useConfirm } from '../../components/common/ConfirmDialog'
import './CrossProjectBoardPage.css'

const SWIMLANE_OPTIONS = [
  { value: 'project', label: 'By project' },
  { value: 'assignee', label: 'By assignee' },
  { value: 'none', label: 'None' },
]

const emptyForm = { name: '', projectIds: [], swimlaneBy: 'project' }

export function CrossProjectBoardPage() {
  const navigate = useNavigate()
  const { confirm, confirmDialog } = useConfirm()
  const [projects, setProjects] = useState([])
  const [boards, setBoards] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [boardData, setBoardData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [issuesLoading, setIssuesLoading] = useState(false)
  const [error, setError] = useState('')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const projectName = useMemo(() => {
    const map = {}
    for (const p of projects) map[p.id] = p.name || p.key
    return map
  }, [projects])

  async function loadBoards() {
    setLoading(true)
    try {
      const [proj, brds] = await Promise.all([fetchProjects(), fetchCrossProjectBoards()])
      setProjects(proj)
      setBoards(brds)
      if (brds.length && selectedId == null) setSelectedId(brds[0].id)
    } catch (err) {
      setError(err.message || 'Failed to load boards')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadBoards() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedId == null) { setBoardData(null); return }
    let cancelled = false
    setIssuesLoading(true)
    fetchCrossProjectBoardIssues(selectedId)
      .then((data) => { if (!cancelled) setBoardData(data) })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load issues') })
      .finally(() => { if (!cancelled) setIssuesLoading(false) })
    return () => { cancelled = true }
  }, [selectedId])

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  function openEdit(board) {
    setEditingId(board.id)
    setForm({ name: board.name, projectIds: board.projectIds || [], swimlaneBy: board.swimlaneBy })
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    try {
      if (editingId) {
        const updated = await updateCrossProjectBoard(editingId, form)
        setBoards((b) => b.map((x) => (x.id === editingId ? updated : x)))
        if (selectedId === editingId) {
          // reload issues for the edited board
          setBoardData(await fetchCrossProjectBoardIssues(editingId))
        }
      } else {
        const created = await createCrossProjectBoard(form)
        setBoards((b) => [created, ...b])
        setSelectedId(created.id)
      }
      setDialogOpen(false)
    } catch (err) {
      setError(err.message || 'Failed to save board')
    }
  }

  async function handleDelete(id) {
    if (!(await confirm({ title: 'Delete board?', message: 'Delete this cross-project board?', confirmLabel: 'Delete', danger: true }))) return
    try {
      await deleteCrossProjectBoard(id)
      setBoards((b) => b.filter((x) => x.id !== id))
      if (selectedId === id) setSelectedId(null)
    } catch (err) {
      setError(err.message || 'Failed to delete board')
    }
  }

  const selectedBoard = boards.find((b) => b.id === selectedId)

  return (
    <section className="page cpb-page">
      {confirmDialog}
      <div className="board-jira-header">
        <h1 className="board-jira-title">Cross-Project Boards</h1>
        <div className="board-jira-actions">
          <Button variant="contained" size="small" onClick={openCreate}>New board</Button>
        </div>
      </div>

      {error && <p className="backlog-message cpb-error" role="alert">{error}</p>}

      {loading ? (
        <Box className="cpb-loading"><CircularProgress size={28} /></Box>
      ) : boards.length === 0 ? (
        <EmptyState
          icon={<span style={{ fontSize: 40 }}>🗂️</span>}
          title="No cross-project boards yet"
          description="Create a board that aggregates issues from multiple projects into one Kanban view."
          action={<Button variant="contained" onClick={openCreate}>Create board</Button>}
        />
      ) : (
        <>
          <div className="cpb-board-tabs" role="tablist" aria-label="Boards">
            {boards.map((b) => (
              <div
                key={b.id}
                className={`cpb-board-tab${b.id === selectedId ? ' cpb-board-tab-active' : ''}`}
                role="tab"
                aria-selected={b.id === selectedId}
                tabIndex={0}
                onClick={() => setSelectedId(b.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedId(b.id) }}
              >
                <span className="cpb-board-tab-name">{b.name}</span>
                <button type="button" className="cpb-tab-btn" title="Edit" onClick={(e) => { e.stopPropagation(); openEdit(b) }}>Edit</button>
                <button type="button" className="cpb-tab-btn cpb-tab-btn-danger" title="Delete" onClick={(e) => { e.stopPropagation(); handleDelete(b.id) }}>Delete</button>
              </div>
            ))}
          </div>

          {selectedBoard && (
            <div className="cpb-board-meta">
              <span>Swimlanes: <strong>{SWIMLANE_OPTIONS.find((o) => o.value === selectedBoard.swimlaneBy)?.label}</strong></span>
              <span className="cpb-board-meta-projects">
                {(selectedBoard.projectIds || []).map((pid) => (
                  <Chip key={pid} size="small" label={projectName[pid] || `#${pid}`} className="cpb-project-chip" />
                ))}
              </span>
            </div>
          )}

          {issuesLoading ? (
            <Box className="cpb-loading"><CircularProgress size={28} /></Box>
          ) : boardData ? (
            <CrossProjectKanban data={boardData} projectName={projectName} onOpenIssue={(id) => navigate(`/issues/${id}`)} />
          ) : null}
        </>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editingId ? 'Edit board' : 'New cross-project board'}</DialogTitle>
        <DialogContent>
          <TextField
            label="Board name" fullWidth margin="normal" value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <FormControl fullWidth margin="normal">
            <InputLabel id="cpb-projects-label">Projects</InputLabel>
            <Select
              labelId="cpb-projects-label" multiple value={form.projectIds}
              onChange={(e) => setForm((f) => ({ ...f, projectIds: e.target.value }))}
              input={<OutlinedInput label="Projects" />}
              renderValue={(sel) => sel.map((id) => projectName[id] || `#${id}`).join(', ')}
            >
              {projects.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  <Checkbox checked={form.projectIds.indexOf(p.id) > -1} />
                  <ListItemText primary={p.name || p.key} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Box sx={{ mt: 2 }}>
            <span className="cpb-field-label">Swimlanes</span>
            <ToggleButtonGroup
              exclusive size="small" value={form.swimlaneBy}
              onChange={(_e, v) => { if (v) setForm((f) => ({ ...f, swimlaneBy: v })) }}
            >
              {SWIMLANE_OPTIONS.map((o) => (
                <ToggleButton key={o.value} value={o.value}>{o.label}</ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={!form.name.trim()}>Save</Button>
        </DialogActions>
      </Dialog>
    </section>
  )
}

function IssueCard({ issue, projectName, onOpenIssue }) {
  const pname = projectName[issue.project_id] || issue.project_name || `#${issue.project_id}`
  return (
    <div className="board-card cpb-card" role="button" tabIndex={0}
      onClick={() => onOpenIssue(issue.id)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpenIssue(issue.id) }}
    >
      <div className="cpb-card-key">
        <Chip size="small" label={pname} className="cpb-project-chip" />
        <span className="cpb-card-issuekey">{issue.issue_key}</span>
      </div>
      <div className="cpb-card-title">{issue.title}</div>
      <div className="cpb-card-meta">
        <span className="cpb-card-type">{issue.issue_type}</span>
        <span className="cpb-card-assignee">{issue.assignee || 'Unassigned'}</span>
      </div>
    </div>
  )
}

function ColumnGrid({ columns, projectName, onOpenIssue }) {
  return (
    <div className="cpb-columns">
      {columns.map((col) => (
        <div className="board-column cpb-column" key={col.status}>
          <div className="board-column-header cpb-column-header">
            <span>{col.status}</span>
            <span className="cpb-column-count">{col.issues.length}</span>
          </div>
          <div className="cpb-column-body">
            {col.issues.map((issue) => (
              <IssueCard key={issue.id} issue={issue} projectName={projectName} onOpenIssue={onOpenIssue} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function CrossProjectKanban({ data, projectName, onOpenIssue }) {
  const { columns, swimlanes, board } = data
  if (board?.swimlaneBy === 'none' || !swimlanes?.length) {
    return <ColumnGrid columns={columns} projectName={projectName} onOpenIssue={onOpenIssue} />
  }
  const swimlaneLabel = (key) =>
    board.swimlaneBy === 'project' ? (projectName[key] || `#${key}`) : String(key)

  return (
    <div className="cpb-swimlanes">
      {swimlanes.map((lane) => (
        <div className="cpb-swimlane" key={String(lane.key)}>
          <div className="cpb-swimlane-header">{swimlaneLabel(lane.key)}</div>
          <ColumnGrid columns={lane.columns} projectName={projectName} onOpenIssue={onOpenIssue} />
        </div>
      ))}
    </div>
  )
}

export default CrossProjectBoardPage
