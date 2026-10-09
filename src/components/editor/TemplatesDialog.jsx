import { useEffect, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import { fetchWikiTemplates } from '../../api/wikiTemplateApi'
import { BUILT_IN_TEMPLATES } from './pageTemplates'

/*
 * JL-187 (fosasoft) — "All templates": the built-in starters plus the
 * workspace's own templates (JL-125). Picking one hands its body back; the
 * editor inserts it.
 */
export function TemplatesDialog({ open, onClose, onPick }) {
  const [workspace, setWorkspace] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    fetchWikiTemplates()
      .then((rows) => { if (!cancelled) setWorkspace(Array.isArray(rows) ? rows : []) })
      .catch((err) => { if (!cancelled) setError(err?.message || 'Could not load the workspace templates.') })
    return () => { cancelled = true }
  }, [open])

  const all = [
    ...BUILT_IN_TEMPLATES.map((t) => ({ id: `built-in:${t.key}`, name: t.name, description: t.description, body: t.body })),
    ...workspace.map((t) => ({ id: `ws:${t.id}`, name: t.name, description: t.description || '', body: t.body || '' })),
  ]

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="pe-templates-title">
      <DialogTitle id="pe-templates-title">Templates</DialogTitle>
      <DialogContent dividers>
        {error && <p className="pe-dialog-error" role="alert">{error}</p>}
        <ul className="pe-templates">
          {all.map((t) => (
            <li key={t.id}>
              <button type="button" className="pe-templates__item" onClick={() => onPick(t.body)}>
                <span className="pe-templates__name">{t.name}</span>
                {t.description && <span className="pe-templates__desc">{t.description}</span>}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  )
}

export default TemplatesDialog
