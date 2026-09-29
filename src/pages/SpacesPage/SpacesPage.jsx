import { useCallback, useEffect, useState } from 'react'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import { usePageTitle } from '../../hooks/usePageTitle'
import { usePermissions } from '../../hooks/usePermissions'
import { EmptyState } from '../../components/common/EmptyState'
import { LoadingState, ErrorState } from '../../components/common/LoadingState'
import { fetchSpaces } from '../../api/spaceApi'
// JL-156 — the same dialog the sidebar's "+" opens. One create form.
import { CreateSpaceDialog } from '../../components/wiki/SpaceDialogs'
import './SpacesPage.css'

/*
 * JL-65 / JL-85 — the Space directory.
 *
 * A Space is the unit documentation is organised by, and deliberately NOT a
 * project: a runbook or an onboarding guide outlives the project that prompted
 * it. That is why this page is reached from the main nav rather than from
 * inside a project shell.
 *
 * The API decorates every row with the caller's own `myRole` and a live
 * `pageCount`, so this page needs no permission round trip of its own and no
 * request per Space.
 */

const SPACES_ICON = (
  <svg viewBox="0 0 40 40" width="40" height="40" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="7" width="13" height="11" rx="2" />
    <rect x="22" y="7" width="13" height="11" rx="2" />
    <rect x="5" y="22" width="13" height="11" rx="2" />
    <rect x="22" y="22" width="13" height="11" rx="2" />
  </svg>
)

export function SpacesPage() {
  usePageTitle('Knowledge')
  const { canCreateIssue } = usePermissions()

  const [spaces, setSpaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setSpaces(await fetchSpaces({ includeArchived: showArchived }))
    } catch (err) {
      // JL-248: say what failed rather than showing an empty list, which reads
      // as "there are no Spaces" and is a different claim entirely.
      setError(err?.message || 'Could not load Spaces.')
    } finally {
      setLoading(false)
    }
  }, [showArchived])

  useEffect(() => { load() }, [load])

  return (
    <section className="page spaces-page">
      <div className="spaces-header">
        <div>
          <h1>Knowledge</h1>
          <p className="spaces-lede">
            Spaces organise documentation that outlives any one project.
          </p>
        </div>
        <Stack direction="row" spacing={2} alignItems="center">
          <FormControlLabel
            control={(
              <Checkbox
                id="spaces-show-archived"
                size="small"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
            )}
            label="Show archived"
          />
          {canCreateIssue && (
            <Button variant="contained" size="small" onClick={() => setAddOpen(true)}>
              Create Space
            </Button>
          )}
        </Stack>
      </div>

      {loading && <LoadingState label="Loading Spaces…" />}
      {!loading && error && <ErrorState error={error} onRetry={load} />}

      {!loading && !error && spaces.length === 0 && (
        <EmptyState
          icon={SPACES_ICON}
          title="No Spaces yet"
          description="A Space groups pages that belong together — a team's runbooks, an onboarding guide, an architecture decision log."
          action={canCreateIssue
            ? <Button variant="contained" onClick={() => setAddOpen(true)}>Create the first Space</Button>
            : null}
        />
      )}

      {!loading && !error && spaces.length > 0 && (
        <ul className="spaces-grid">
          {spaces.map((space) => (
            <li key={space.id} className={`space-card${space.archived ? ' space-card--archived' : ''}`}>
              <div className="space-card-top">
                <span className="space-card-key">{space.key}</span>
                {space.archived && <span className="pill pill--lozenge pill-yellow">Archived</span>}
              </div>
              <h2 className="space-card-name">{space.name}</h2>
              {space.description && <p className="space-card-desc">{space.description}</p>}
              <div className="space-card-meta">
                <span>{space.pageCount} {space.pageCount === 1 ? 'page' : 'pages'}</span>
                <span className="space-card-role">{space.myRole}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CreateSpaceDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(created) => setSpaces((current) => (
          [...current, created].sort((a, b) => a.name.localeCompare(b.name))
        ))}
      />
    </section>
  )
}

export default SpacesPage
