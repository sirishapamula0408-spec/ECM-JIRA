import { useState, useEffect } from 'react'
import { useIssues } from '../../context/IssueContext'
import { useMembers } from '../../context/MemberContext'
import { useSprints } from '../../context/SprintContext'
import { useAppData } from '../../context/AppDataContext'
import { useAuth } from '../../context/AuthContext'
import { fetchProjects } from '../../api/projectApi'
import { ISSUE_STATUSES, ISSUE_TYPES, PRIORITIES } from '../../constants'
import { RichTextEditor } from './RichTextEditor'

import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'
import Alert from '@mui/material/Alert'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Grid from '@mui/material/Grid'
import Avatar from '@mui/material/Avatar'
import Typography from '@mui/material/Typography'
import CloseIcon from '@mui/icons-material/Close'

import './CreateIssueModal.css'

const TYPE_META = {
  Story: { icon: '\u{1F4D7}', label: 'Story' },
  Bug:   { icon: '\u{1F41B}', label: 'Bug' },
  Task:  { icon: '\u2705',     label: 'Task' },
}

const PRIORITY_COLORS = {
  High:   'high',
  Medium: 'medium',
  Low:    'low',
}

export function CreateIssueModal({ onClose }) {
  const { handleCreate } = useIssues()
  const { profile, members } = useMembers()
  const { sprints } = useSprints()
  const { setAppError } = useAppData()
  const { authUser } = useAuth()

  const reporterName = authUser?.email || profile?.full_name || 'Current User'

  const [projects, setProjects] = useState([])
  const [form, setForm] = useState({
    projectId: '',
    title: '',
    description: '',
    issueType: 'Story',
    priority: 'Medium',
    status: 'Backlog',
    assignee: profile?.full_name || '',
    sprintId: null,
  })
  const [createAnother, setCreateAnother] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // Fetch projects on mount and default to first project
  useEffect(() => {
    fetchProjects().then((data) => {
      setProjects(data)
      if (data.length > 0) {
        setForm((c) => ({ ...c, projectId: data[0].id }))
      }
    }).catch(() => {})
  }, [])

  // When profile loads after mount, default assignee
  useEffect(() => {
    if (profile?.full_name && !form.assignee) {
      setForm((c) => ({ ...c, assignee: profile.full_name }))
    }
  }, [profile])

  // Sprint-status logic: disable sprint when Backlog
  useEffect(() => {
    if (form.status === 'Backlog') {
      setForm((c) => ({ ...c, sprintId: null }))
    } else if (form.sprintId === null && sprints.length > 0) {
      // Auto-select first sprint when moving out of Backlog
      setForm((c) => ({ ...c, sprintId: sprints[0].id }))
    }
  }, [form.status])

  function update(field, value) {
    setForm((c) => ({ ...c, [field]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    setSubmitError('')
    setSuccessMessage('')
    setSaving(true)

    try {
      const payload = {
        projectId: form.projectId || undefined,
        title: form.title,
        description: form.description,
        issueType: form.issueType,
        priority: form.priority,
        status: form.status,
        assignee: form.assignee,
        sprintId: form.status === 'Backlog' ? null : form.sprintId,
      }
      await handleCreate(payload)

      if (createAnother) {
        // Reset title + description, keep type/priority/assignee/sprint/status
        setForm((c) => ({ ...c, title: '', description: '' }))
        setSuccessMessage('Issue created successfully!')
        setTimeout(() => setSuccessMessage(''), 3000)
      } else {
        onClose()
      }
    } catch (createError) {
      setSubmitError(createError.message || 'Failed to create issue')
      setAppError(createError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={true} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={submit}>
        {/* Header */}
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          Create issue
          <IconButton onClick={onClose} aria-label="Close" size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        {/* Body */}
        <DialogContent dividers>
          <Stack spacing={2.5}>
            {/* Success toast */}
            {successMessage && (
              <Alert severity="success">{successMessage}</Alert>
            )}

            {/* Error */}
            {submitError && (
              <Alert severity="error">{submitError}</Alert>
            )}

            {/* Project */}
            <FormControl fullWidth size="small" required>
              <InputLabel>Project</InputLabel>
              <Select
                value={form.projectId}
                label="Project"
                onChange={(e) => update('projectId', Number(e.target.value))}
              >
                {projects.map((p) => (
                  <MenuItem key={p.id} value={p.id}>{p.name} ({p.key})</MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Issue Type toggle */}
            <Stack spacing={0.5}>
              <Typography variant="body2" fontWeight={500}>Issue Type</Typography>
              <ToggleButtonGroup
                value={form.issueType}
                exclusive
                onChange={(e, val) => { if (val !== null) update('issueType', val) }}
                size="small"
              >
                {ISSUE_TYPES.map((type) => {
                  const meta = TYPE_META[type] || { icon: '\u{1F4CC}', label: type }
                  return (
                    <ToggleButton key={type} value={type}>
                      <span style={{ marginRight: 6 }}>{meta.icon}</span>
                      {meta.label}
                    </ToggleButton>
                  )
                })}
              </ToggleButtonGroup>
            </Stack>

            {/* Status */}
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select
                value={form.status}
                label="Status"
                onChange={(e) => update('status', e.target.value)}
              >
                {ISSUE_STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <Divider />

            {/* Summary */}
            <TextField
              required
              fullWidth
              size="small"
              label="Summary"
              placeholder="What needs to be done?"
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
            />

            {/* Description */}
            <Stack spacing={0.5}>
              <Typography variant="body2" fontWeight={500}>
                Description <span style={{ color: 'red' }}>*</span>
              </Typography>
              <RichTextEditor
                required
                rows={6}
                placeholder="Add a description..."
                value={form.description}
                onChange={(val) => update('description', val)}
              />
            </Stack>

            <Divider />

            {/* Assignee + Reporter */}
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Assignee</InputLabel>
                  <Select
                    value={form.assignee}
                    label="Assignee"
                    onChange={(e) => update('assignee', e.target.value)}
                  >
                    {members.length === 0 && form.assignee && (
                      <MenuItem value={form.assignee}>{form.assignee}</MenuItem>
                    )}
                    {members.map((m) => (
                      <MenuItem key={m.id} value={m.name}>{m.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid size={{ xs: 12, sm: 6 }}>
                <Stack spacing={0.5}>
                  <Typography variant="body2" fontWeight={500}>Reporter</Typography>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ minHeight: 40 }}>
                    <Avatar sx={{ width: 28, height: 28, fontSize: 14 }}>
                      {reporterName.charAt(0).toUpperCase()}
                    </Avatar>
                    <Typography variant="body2">{reporterName}</Typography>
                  </Stack>
                </Stack>
              </Grid>
            </Grid>

            {/* Priority + Sprint */}
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Priority</InputLabel>
                  <Select
                    value={form.priority}
                    label="Priority"
                    onChange={(e) => update('priority', e.target.value)}
                  >
                    {PRIORITIES.map((p) => (
                      <MenuItem key={p} value={p}>{p}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth size="small" disabled={form.status === 'Backlog'}>
                  <InputLabel>Sprint</InputLabel>
                  <Select
                    value={form.sprintId ?? ''}
                    label="Sprint"
                    onChange={(e) => {
                      const val = e.target.value
                      update('sprintId', val === '' ? null : Number(val))
                    }}
                  >
                    <MenuItem value="">
                      {form.status === 'Backlog' ? 'N/A (Backlog)' : 'None'}
                    </MenuItem>
                    {sprints.map((s) => (
                      <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </Stack>
        </DialogContent>

        {/* Footer */}
        <DialogActions sx={{ justifyContent: 'space-between', px: 3, py: 1.5 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={createAnother}
                onChange={(e) => setCreateAnother(e.target.checked)}
                size="small"
              />
            }
            label="Create another"
          />

          <Stack direction="row" spacing={1}>
            <Button variant="text" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={saving || !form.title.trim() || !form.description.trim()}
            >
              {saving ? 'Creating...' : 'Create'}
            </Button>
          </Stack>
        </DialogActions>
      </form>
    </Dialog>
  )
}
