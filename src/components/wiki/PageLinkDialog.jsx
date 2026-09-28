import { useCallback, useEffect, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import { DocumentIcon } from './WikiIcons'
import { searchWikiHomePages } from '../../api/wikiSearchApi'
import './PageLinkDialog.css'

/*
 * JL-99 — choose a link target by TITLE rather than by knowing its id.
 *
 * This is the half of JL-99 that was left open in Phase 4: links worked, but
 * linking to another page meant typing /wiki/pages/<id>, which nobody knows.
 * It waited on Phase 6's search rather than growing a second title lookup
 * that would have been thrown away when the real one arrived.
 *
 * ── Both kinds of link, one dialog ──────────────────────────────────────────
 *
 * The same box takes a URL or a search term. Two controls would make the user
 * classify their own input before typing it, and the classification is
 * obvious from the result: a page is picked from the list, anything else is
 * used as typed.
 *
 * The URL inserted for a page is RELATIVE (/wiki/pages/42). sanitizeHtml
 * permits relative URLs (JL-368), so the link survives the round trip, and it
 * keeps working if the deployment moves host.
 */

const SEARCH_DEBOUNCE_MS = 250

export function PageLinkDialog({ open, initialHref = '', onCancel, onConfirm }) {
  const [term, setTerm] = useState(initialHref)
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)

  useEffect(() => { if (open) setTerm(initialHref) }, [open, initialHref])

  const runSearch = useCallback(async (value) => {
    const q = value.trim()
    /*
     * Something that already looks like a destination is not a search term.
     * Searching for "https://example.com" would return nothing and imply the
     * URL was wrong, which it is not.
     */
    if (!q || q.startsWith('/') || q.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(q)) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const data = await searchWikiHomePages(q, { limit: 8 })
      setResults(data?.items ?? [])
    } catch {
      // A failed search leaves the typed text usable as a URL — the dialog
      // still does its primary job.
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const t = setTimeout(() => runSearch(term), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [open, term, runSearch])

  function useTypedValue() {
    const value = term.trim()
    // Empty means "remove the link", which is a real choice, not a no-op.
    onConfirm(value)
  }

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>Link</DialogTitle>
      <DialogContent>
        <TextField
          id="wiki-link-term"
          label="Paste a URL, or search for a page"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          fullWidth
          size="small"
          autoFocus
          sx={{ mt: 1 }}
          helperText="Leave empty to remove the link."
        />

        {searching && <p className="wiki-linkdlg-status">Searching…</p>}

        {!searching && results.length > 0 && (
          <ul className="wiki-linkdlg-results">
            {results.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="wiki-linkdlg-hit"
                  // A relative URL: permitted by the sanitiser, and it keeps
                  // working if the deployment moves host.
                  onClick={() => onConfirm(`/wiki/pages/${row.id}`)}
                >
                  <DocumentIcon size={16} />
                  <span className="wiki-linkdlg-title">{row.title}</span>
                  <span className="wiki-linkdlg-space">{row.space_name || 'No space'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" onClick={useTypedValue}>
          {term.trim() ? 'Use this' : 'Remove link'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default PageLinkDialog
