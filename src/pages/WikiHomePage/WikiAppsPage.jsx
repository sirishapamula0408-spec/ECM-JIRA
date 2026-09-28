import Button from '@mui/material/Button'
import { useNavigate } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { EmptyState } from '../../components/common/EmptyState'
import { AppsIcon } from '../../components/wiki/WikiIcons'

/*
 * JL-152 — /wiki/apps, the stub the brief asks for.
 *
 * A stub, not a hidden nav item: the sidebar lists Apps, so the route has to
 * resolve to something honest rather than a blank screen or a 404. It says
 * what it is and offers the way back, which is what makes it a placeholder
 * instead of a dead end.
 */
export function WikiAppsPage() {
  usePageTitle('Apps')
  const navigate = useNavigate()
  return (
    <div className="wiki-viewer">
      <EmptyState
        icon={<AppsIcon size={40} />}
        title="Apps are not available yet"
        description="Integrations and macros for Confluence Lite will appear here once they ship."
        action={<Button variant="contained" onClick={() => navigate('/wiki/home')}>Back to home</Button>}
      />
    </div>
  )
}

export default WikiAppsPage
