export const STATUS_COLUMNS = ['To Do', 'In Progress', 'Code Review', 'Done']
// JL-306: QA-lifecycle statuses (In Testing, In Rework, In UAT, Cancelled) are added
// alongside the legacy defaults so the configurable "QA Lifecycle" workflow can use them.
export const ISSUE_STATUSES = [
  'Backlog',
  'To Do',
  'In Progress',
  'Code Review',
  'In Testing',
  'In Rework',
  'In UAT',
  'Done',
  'Cancelled',
]
export const PRIORITIES = ['Low', 'Medium', 'High']
export const ISSUE_TYPES = ['Epic', 'Story', 'Bug', 'Task', 'Sub-task']
