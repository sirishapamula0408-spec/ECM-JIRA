// JL-306: Built-in workflow templates. A template is a reusable definition of
// states + a transition graph + workflow metadata (initial / terminal states,
// cancel-from-any). Applying a template to a project seeds the project's
// issue_statuses, workflow_transitions and project_workflows rows.
//
// The transition list here is the CORE forward/rework graph. Cancel edges are NOT
// listed explicitly — they are expressed by `cancelFromAny` + `cancelStatus`, which
// the engine (isTransitionAllowed) honours from every non-terminal state.

// State catalog with board categories ('todo' | 'inprogress' | 'done').
//
// JL-324: `color` is used as the node FILL in the Workflow Editor, so these are
// Atlassian *surface* tokens (light), not text tokens. They were previously
// N500/B400/Y400/R300/P300/G400, which produced dark-on-dark node labels.
export const QA_LIFECYCLE_STATES = [
  { name: 'Backlog', category: 'todo', color: '#F4F5F7' },
  { name: 'To Do', category: 'todo', color: '#F4F5F7' },
  { name: 'In Progress', category: 'inprogress', color: '#DEEBFF' },
  { name: 'In Testing', category: 'inprogress', color: '#FFF0B3' },
  { name: 'In Rework', category: 'inprogress', color: '#FFEBE6' },
  { name: 'In UAT', category: 'inprogress', color: '#EAE6FF' },
  { name: 'Done', category: 'done', color: '#E3FCEF' },
  { name: 'Cancelled', category: 'done', color: '#F4F5F7' },
]

// Core allowed transitions (excluding cancel edges — see cancelFromAny).
export const QA_LIFECYCLE_TRANSITIONS = [
  ['Backlog', 'To Do'],
  ['To Do', 'In Progress'],
  ['In Progress', 'In Testing'],
  ['In Testing', 'In UAT'], // no defect found
  ['In Testing', 'In Rework'], // defect found in testing
  ['In Rework', 'In Progress'], // rework re-enters development
  ['In UAT', 'Done'], // no defect in UAT
  ['In UAT', 'In Rework'], // defect in UAT → re-execute from development
]

export const QA_LIFECYCLE = {
  key: 'qa-lifecycle',
  name: 'QA Lifecycle',
  description:
    'Backlog → To Do → In Progress → In Testing → (In UAT | In Rework) → Done. ' +
    'In Rework re-enters development; Cancel is available from any active state.',
  states: QA_LIFECYCLE_STATES,
  transitions: QA_LIFECYCLE_TRANSITIONS,
  initialStatus: 'Backlog',
  terminalStatuses: ['Done', 'Cancelled'],
  cancelFromAny: true,
  cancelStatus: 'Cancelled',
}

export const WORKFLOW_TEMPLATES = [QA_LIFECYCLE]

export function getTemplate(keyOrName) {
  const needle = String(keyOrName || '').trim().toLowerCase()
  return (
    WORKFLOW_TEMPLATES.find(
      (t) => t.key.toLowerCase() === needle || t.name.toLowerCase() === needle,
    ) || null
  )
}

// Public, serialisable summary of the built-in templates (for the templates API).
export function listTemplates() {
  return WORKFLOW_TEMPLATES.map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    states: t.states.map((s) => s.name),
    transitions: t.transitions.map(([fromStatus, toStatus]) => ({ fromStatus, toStatus })),
    initialStatus: t.initialStatus,
    terminalStatuses: t.terminalStatuses,
    cancelFromAny: t.cancelFromAny,
    cancelStatus: t.cancelStatus,
  }))
}
