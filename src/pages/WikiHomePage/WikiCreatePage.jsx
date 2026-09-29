import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Alert from '@mui/material/Alert'
import Stack from '@mui/material/Stack'
import { usePageTitle } from '../../hooks/usePageTitle'
import { EmptyState } from '../../components/common/EmptyState'
import { SpacesIcon } from '../../components/wiki/WikiIcons'
import { createWikiPage } from '../../api/wikiApi'
import { fetchWikiTemplates } from '../../api/wikiTemplateApi'

/*
 * JL-153 — /wiki/new, the Confluence Lite Create action.
 *
 * A ROUTE rather than a modal, unlike Jira's Create. The top bar sits above
 * both product layouts, so a modal here would mean threading a callback from
 * this layout up past the bar that triggers it; an address needs nothing, is
 * deep-linkable, and survives a refresh mid-draft.
 *
 * Spaces come from the layout's already-loaded home payload — creating a page
 * costs no extra round trip to find out where it can go.
 */
export function WikiCreatePage() {
  usePageTitle('Create page')
  const navigate = useNavigate()
  const { home, homeLoading, reloadHome } = useOutletContext() ?? {}

  // Memoised so the default-space effect below does not see a new array
  // identity on every render.
  const spaces = useMemo(() => home?.spaces ?? [], [home])
  const [spaceId, setSpaceId] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  // JL-125: the body is resolved SERVER-side from templateId, so the template
  // text never travels back and forth just to be posted again.
  const [templateId, setTemplateId] = useState('')
  const [templates, setTemplates] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchWikiTemplates()
      .then((rows) => { if (!cancelled) setTemplates(Array.isArray(rows) ? rows : []) })
      .catch(() => { /* templates are optional — a page can be started blank */ })
    return () => { cancelled = true }
  }, [])

  // Default to the first Space the user can write in, once they have loaded.
  useEffect(() => {
    if (!spaceId && spaces.length) setSpaceId(String(spaces[0].id))
  }, [spaces, spaceId])

  const handleSubmit = useCallback(async (event) => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const created = await createWikiPage({
        spaceId: Number(spaceId),
        title: title.trim(),
        content,
        // Ignored by the server when content is non-empty: what the author
        // actually typed wins over the template.
        templateId: templateId ? Number(templateId) : undefined,
      })
      // The sidebar's Recent/Spaces counts are now stale.
      reloadHome?.()
      navigate(`/wiki/pages/${created.id}`)
    } catch (err) {
      // The server owns the rules (title length, Space access); surface its
      // message rather than restating them here and letting the two drift.
      setError(err?.message || 'Could not create the page.')
    } finally {
      setSaving(false)
    }
  }, [spaceId, title, content, templateId, navigate, reloadHome])

  // A page has to live in a Space. Saying so beats a disabled form.
  if (!homeLoading && spaces.length === 0) {
    return (
      <div className="wiki-list-page">
        <EmptyState
          icon={<SpacesIcon size={40} />}
          title="Create a space first"
          description="Pages live inside a space. Create one, then come back and write."
          action={<Button variant="contained" onClick={() => navigate('/spaces')}>Create a space</Button>}
        />
      </div>
    )
  }

  return (
    <div className="wiki-list-page">
      <h1>Create page</h1>
      <form onSubmit={handleSubmit}>
        <Stack spacing={2} sx={{ maxWidth: 640, mt: 2 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            id="wiki-new-space"
            select
            label="Space"
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
            required
            fullWidth
          >
            {spaces.map((space) => (
              <MenuItem key={space.id} value={String(space.id)}>{space.name}</MenuItem>
            ))}
          </TextField>
          <TextField
            id="wiki-new-title"
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            fullWidth
            autoFocus
          />
          {/* JL-125. Offered only when there are templates AND the author has
              not started writing: a picker that would be ignored is worse
              than no picker, because it implies a choice that has no effect. */}
          {templates.length > 0 && !content.trim() && (
            <TextField
              id="wiki-new-template"
              select
              label="Start from a template"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              fullWidth
              helperText="Optional. The template fills the page; you can change anything afterwards."
            >
              <MenuItem value="">Blank page</MenuItem>
              {templates.map((t) => (
                <MenuItem key={t.id} value={String(t.id)}>{t.name}</MenuItem>
              ))}
            </TextField>
          )}

          <TextField
            id="wiki-new-content"
            label="Content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            fullWidth
            multiline
            minRows={8}
            helperText={templateId && !content.trim()
              ? 'Leave blank to use the template.'
              : undefined}
          />
          <Stack direction="row" spacing={2}>
            <Button type="submit" variant="contained" disabled={saving || !title.trim() || !spaceId}>
              {saving ? 'Creating…' : 'Create'}
            </Button>
            <Button onClick={() => navigate('/wiki/home')} disabled={saving}>Cancel</Button>
          </Stack>
        </Stack>
      </form>
    </div>
  )
}

export default WikiCreatePage
