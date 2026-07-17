import { useEffect, useState, useCallback } from 'react'
import {
  Box, Typography, Card, CardActionArea, CardContent, TextField, Button,
  Chip, Divider, Alert, Stack, MenuItem, CircularProgress,
} from '@mui/material'
import { usePermissions } from '../../hooks/usePermissions'
import { fetchProjects } from '../../api/projectApi'
import {
  fetchPortalCatalog, submitPortalRequest, fetchMyRequests,
  fetchRequestTypes, createRequestType, deleteRequestType,
} from '../../api/portalApi'
import { ISSUE_TYPES } from '../../constants'
import './PortalPage.css'

const STATUS_COLORS = {
  Backlog: 'default',
  'To Do': 'info',
  'In Progress': 'warning',
  'Code Review': 'secondary',
  Done: 'success',
}

export function PortalPage() {
  const { isAdmin } = usePermissions()
  const [catalog, setCatalog] = useState([])
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({ requesterEmail: '', summary: '', description: '' })
  const [submitState, setSubmitState] = useState({ loading: false, error: '', result: null })

  const [lookupEmail, setLookupEmail] = useState('')
  const [myRequests, setMyRequests] = useState(null)
  const [lookupLoading, setLookupLoading] = useState(false)

  const loadCatalog = useCallback(() => {
    fetchPortalCatalog()
      .then((data) => setCatalog(Array.isArray(data) ? data : []))
      .catch(() => setCatalog([]))
  }, [])

  useEffect(() => { loadCatalog() }, [loadCatalog])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!selected) return
    setSubmitState({ loading: true, error: '', result: null })
    try {
      const result = await submitPortalRequest({
        requestTypeId: selected.id,
        requesterEmail: form.requesterEmail,
        summary: form.summary,
        description: form.description,
      })
      setSubmitState({ loading: false, error: '', result })
      setForm({ requesterEmail: form.requesterEmail, summary: '', description: '' })
    } catch (err) {
      setSubmitState({ loading: false, error: err?.data?.error || err.message || 'Submission failed', result: null })
    }
  }

  const handleLookup = async (e) => {
    e.preventDefault()
    if (!lookupEmail.trim()) return
    setLookupLoading(true)
    try {
      const data = await fetchMyRequests(lookupEmail.trim())
      setMyRequests(Array.isArray(data) ? data : [])
    } catch {
      setMyRequests([])
    } finally {
      setLookupLoading(false)
    }
  }

  return (
    <Box className="portal-page">
      <Typography variant="h4" component="h1" gutterBottom>Help Center</Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Pick a request type, tell us what you need, and track your submitted requests.
      </Typography>

      {/* 1. Pick a request type */}
      <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>What can we help you with?</Typography>
      {catalog.length === 0 ? (
        <Alert severity="info">No request types are available yet.</Alert>
      ) : (
        <Box className="portal-type-grid">
          {catalog.map((rt) => (
            <Card key={rt.id} variant="outlined" className={`portal-type-card${selected?.id === rt.id ? ' selected' : ''}`}>
              <CardActionArea onClick={() => { setSelected(rt); setSubmitState({ loading: false, error: '', result: null }) }}>
                <CardContent>
                  <Typography variant="h6">{rt.icon ? `${rt.icon} ` : ''}{rt.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{rt.description || 'Submit a request'}</Typography>
                  {rt.projectName && <Chip size="small" label={rt.projectName} sx={{ mt: 1 }} />}
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Box>
      )}

      {/* 2. Submission form */}
      {selected && (
        <Box component="form" onSubmit={handleSubmit} className="portal-form" sx={{ mt: 3 }}>
          <Typography variant="h6" gutterBottom>New request: {selected.name}</Typography>
          {submitState.result ? (
            <Alert severity="success" sx={{ mb: 2 }}>
              Request submitted! Your reference is <strong>{submitState.result.issueKey}</strong> (status: {submitState.result.status}).
            </Alert>
          ) : null}
          {submitState.error && <Alert severity="error" sx={{ mb: 2 }}>{submitState.error}</Alert>}
          <Stack spacing={2}>
            <TextField
              label="Your email" type="email" required fullWidth
              value={form.requesterEmail}
              onChange={(e) => setForm((f) => ({ ...f, requesterEmail: e.target.value }))}
            />
            <TextField
              label="Summary" required fullWidth
              value={form.summary}
              onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
            />
            <TextField
              label="Details" fullWidth multiline minRows={4}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
            <Box>
              <Button type="submit" variant="contained" disabled={submitState.loading}>
                {submitState.loading ? 'Submitting...' : 'Submit request'}
              </Button>
              <Button sx={{ ml: 1 }} onClick={() => setSelected(null)}>Cancel</Button>
            </Box>
          </Stack>
        </Box>
      )}

      <Divider sx={{ my: 4 }} />

      {/* 3. My requests */}
      <Typography variant="h6" gutterBottom>Track my requests</Typography>
      <Box component="form" onSubmit={handleLookup} sx={{ display: 'flex', gap: 1, mb: 2, maxWidth: 480 }}>
        <TextField
          label="Enter your email" type="email" size="small" fullWidth
          value={lookupEmail}
          onChange={(e) => setLookupEmail(e.target.value)}
        />
        <Button type="submit" variant="outlined" disabled={lookupLoading}>View</Button>
      </Box>
      {lookupLoading && <CircularProgress size={24} />}
      {myRequests && myRequests.length === 0 && <Alert severity="info">No requests found for that email.</Alert>}
      {myRequests && myRequests.length > 0 && (
        <Stack spacing={1}>
          {myRequests.map((r) => (
            <Card key={r.id} variant="outlined" className="portal-request-row">
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: '12px !important' }}>
                <Chip size="small" label={r.issueKey} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>{r.summary}</Typography>
                  {r.requestType && <Typography variant="caption" color="text.secondary">{r.requestType}</Typography>}
                </Box>
                <Chip size="small" color={STATUS_COLORS[r.status] || 'default'} label={r.status} />
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {isAdmin && (
        <>
          <Divider sx={{ my: 4 }} />
          <RequestTypeAdmin onChange={loadCatalog} />
        </>
      )}
    </Box>
  )
}

// --- Admin: define request types ---
function RequestTypeAdmin({ onChange }) {
  const [types, setTypes] = useState([])
  const [projects, setProjects] = useState([])
  const [draft, setDraft] = useState({ projectId: '', name: '', description: '', icon: '', defaultIssueType: 'Task' })
  const [error, setError] = useState('')

  const load = useCallback(() => {
    fetchRequestTypes().then((d) => setTypes(Array.isArray(d) ? d : [])).catch(() => setTypes([]))
  }, [])

  useEffect(() => {
    load()
    fetchProjects().then((d) => setProjects(Array.isArray(d) ? d : [])).catch(() => setProjects([]))
  }, [load])

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await createRequestType({
        projectId: Number(draft.projectId),
        name: draft.name,
        description: draft.description,
        icon: draft.icon,
        defaultIssueType: draft.defaultIssueType,
      })
      setDraft({ projectId: '', name: '', description: '', icon: '', defaultIssueType: 'Task' })
      load()
      if (onChange) onChange()
    } catch (err) {
      setError(err?.data?.error || err.message || 'Failed to create request type')
    }
  }

  const handleDelete = async (id) => {
    await deleteRequestType(id)
    load()
    if (onChange) onChange()
  }

  return (
    <Box className="portal-admin">
      <Typography variant="h6" gutterBottom>Manage request types (admin)</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Box component="form" onSubmit={handleCreate}>
        <Stack spacing={2} direction={{ xs: 'column', md: 'row' }} sx={{ mb: 2 }}>
          <TextField
            select label="Project" size="small" required sx={{ minWidth: 180 }}
            value={draft.projectId}
            onChange={(e) => setDraft((d) => ({ ...d, projectId: e.target.value }))}
          >
            {projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.name} ({p.key})</MenuItem>)}
          </TextField>
          <TextField label="Name" size="small" required value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          <TextField label="Icon (emoji)" size="small" sx={{ width: 120 }} value={draft.icon}
            onChange={(e) => setDraft((d) => ({ ...d, icon: e.target.value }))} />
          <TextField
            select label="Issue type" size="small" sx={{ minWidth: 140 }}
            value={draft.defaultIssueType}
            onChange={(e) => setDraft((d) => ({ ...d, defaultIssueType: e.target.value }))}
          >
            {ISSUE_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </TextField>
        </Stack>
        <TextField label="Description" size="small" fullWidth sx={{ mb: 2 }} value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
        <Button type="submit" variant="contained">Add request type</Button>
      </Box>
      <Stack spacing={1} sx={{ mt: 3 }}>
        {types.map((t) => (
          <Card key={t.id} variant="outlined">
            <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: '12px !important' }}>
              <Typography sx={{ flex: 1 }}>{t.icon ? `${t.icon} ` : ''}{t.name}</Typography>
              <Chip size="small" label={t.defaultIssueType} />
              <Button color="error" size="small" onClick={() => handleDelete(t.id)}>Delete</Button>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Box>
  )
}
