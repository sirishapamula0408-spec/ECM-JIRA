// JL-191: the current-page crumb for a project route.
//
// Every route under /projects/:projectId (see App.jsx) has a label here, and
// the view is resolved from the FIRST path segment, so a nested path such as
// /projects/6/settings/fields keeps its "Settings" crumb instead of losing it.
// The bare project route is the Summary tab.
export const VIEW_LABELS = {
  '': 'Summary',
  'active-sprint': 'Active sprints',
  automation: 'Automation',
  backlog: 'Backlog',
  board: 'Board',
  goals: 'Goals',
  list: 'List',
  queues: 'Queues',
  releases: 'Releases',
  reports: 'Reports',
  roadmap: 'Timeline',
  settings: 'Settings',
  wiki: 'Wiki',
}

// '' when the path is not inside this project or names an unknown view.
export function projectViewLabel(pathname, projectId) {
  if (!projectId) return ''
  const base = `/projects/${projectId}`
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return ''
  const segment = pathname.slice(base.length).replace(/^\/+/, '').split('/')[0]
  return Object.hasOwn(VIEW_LABELS, segment) ? VIEW_LABELS[segment] : ''
}
