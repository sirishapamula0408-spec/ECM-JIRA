import { all, get, run } from './db.js'

async function seedIssues(defaultSprintId) {
  const row = await get('SELECT COUNT(*) AS count FROM issues')
  if (row.count > 0) {
    return
  }

  const issues = [
    ['ECM-1', 'Refactor core payment gateway logic', 'Break out provider adapters and stabilize retries.', 'High', 'Alex Rivera', 'In Progress', 'Task', defaultSprintId, 1],
    ['ECM-2', 'Design new authentication flow with MFA support', 'Add backup codes and step-up auth for sensitive actions.', 'Medium', 'Sarah Jenkins', 'To Do', 'Story', defaultSprintId, 1],
    ['ECM-3', 'Implement dark mode using Tailwind configuration', "Support 'class' mode and tokenized color scales.", 'Low', 'Jenna Ortega', 'In Progress', 'Task', defaultSprintId, 1],
    ['ECM-4', 'Initial project structure setup', 'Set up folder conventions and deployment scripts.', 'Low', 'David Chen', 'Done', 'Task', defaultSprintId, 1],
    ['ECM-5', 'Database schema migration for users table', 'Add profile fields and timezone preferences.', 'High', 'Marcus Hale', 'Done', 'Bug', defaultSprintId, 1],
    ['ECM-6', 'Fix layout issues on mobile Safari', 'Resolve sticky header overlap and viewport quirks.', 'Medium', 'Jordan Smith', 'Code Review', 'Bug', defaultSprintId, 1],
    ['ECM-7', 'Update documentation for API v2 endpoints', 'Capture breaking changes and migration examples.', 'Low', 'Alex Rivera', 'To Do', 'Task', defaultSprintId, 1],
    ['ECM-8', 'Improve issue search relevance', 'Boost exact key matches and recent work prioritization.', 'High', 'Sarah Jenkins', 'Backlog', 'Story', null, 1],
  ]

  for (const issue of issues) {
    await run(
      'INSERT INTO issues (issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      issue,
    )
  }
}

async function seedSprints() {
  const row = await get('SELECT COUNT(*) AS count FROM sprints')
  if (row.count > 0) {
    const existing = await get('SELECT id FROM sprints ORDER BY id ASC LIMIT 1')
    return existing?.id
  }

  const created = await run(
    'INSERT INTO sprints (name, date_range, is_started) VALUES (?, ?, ?)',
    ['SCRUM Sprint 1', '19 Jan - 2 Feb', 0],
  )
  return created.lastID
}

async function seedActivity() {
  const row = await get('SELECT COUNT(*) AS count FROM activity')
  if (row.count > 0) {
    return
  }

  const activity = [
    ['Sarah Johnson', 'moved APO-142 to IN PROGRESS', '2 minutes ago'],
    ['Emily Chen', 'commented on SEC-098', '45 minutes ago'],
    ['Michael Scott', 'closed CRM-440 as DONE', '1 hour ago'],
    ['Dave Miller', 'attached a file to APO-150', '3 hours ago'],
    ['Linda Wu', 'created a new project Marketing Automation', 'Yesterday'],
  ]

  for (const item of activity) {
    await run('INSERT INTO activity (actor, action, happened_at) VALUES (?, ?, ?)', item)
  }
}

async function seedMembers() {
  const row = await get('SELECT COUNT(*) AS count FROM members')
  if (row.count > 0) {
    return
  }

  const members = [
    ['David Chen', 'david.c@tracker.io', 'Admin', 'Active', 12, null],
    ['Sarah Jenkins', 's.jenkins@tracker.io', 'Member', 'Active', 8, null],
    ['Marcus V', 'marcus.v@tracker.io', 'Viewer', 'Invited', 0, 'Alex Rivers'],
    ['Alex Rivera', 'alex@tracker.io', 'Lead Dev', 'Active', 15, null],
    ['Jordan Smith', 'jordan@tracker.io', 'Engineer', 'Active', 8, null],
  ]

  for (const member of members) {
    await run(
      'INSERT INTO members (name, email, role, status, task_count, invited_by) VALUES (?, ?, ?, ?, ?, ?)',
      member,
    )
  }
}

async function seedRoadmap() {
  const row = await get('SELECT COUNT(*) AS count FROM roadmap_epics')
  if (row.count > 0) {
    return
  }

  const epics = [
    ['Authentication Overhaul', 'Planned', 'Oct 5', 'Oct 28', 1],
    ['Dashboard Analytics 2.0', 'In Progress', 'Oct 18', 'Nov 22', 1],
    ['Cloud Infrastructure Migration', 'To Do', 'Nov 12', 'Dec 6', 1],
    ['API Integration Layer', 'At Risk', 'Oct 30', 'Dec 15', 2],
    ['User Permission Refactoring', 'Planned', 'Nov 25', 'Dec 10', 2],
  ]

  for (const epic of epics) {
    await run(
      'INSERT INTO roadmap_epics (name, phase, start_date, end_date, project_id) VALUES (?, ?, ?, ?, ?)',
      epic,
    )
  }
}

async function seedProfile() {
  const row = await get('SELECT COUNT(*) AS count FROM profile')
  if (row.count > 0) {
    return
  }

  await run(
    'INSERT INTO profile (full_name, job_title, department, timezone, avatar_url) VALUES (?, ?, ?, ?, ?)',
    ['Alex Rivers', 'Senior Product Designer', 'Design & Creative', '(GMT-08:00) Pacific Time', ''],
  )
}

async function seedProjects() {
  const row = await get('SELECT COUNT(*) AS count FROM projects')
  if (row.count > 0) {
    return
  }

  const projects = [
    ['ECM Platform', 'ECM', 'Scrum', 'Alex Rivera', '#0052cc'],
    ['Mobile App', 'MOB', 'Kanban', 'Sarah Jenkins', '#00875a'],
  ]

  for (const project of projects) {
    await run(
      'INSERT INTO projects (name, key, type, lead, avatar_color) VALUES (?, ?, ?, ?, ?)',
      project,
    )
  }
}

async function seedWorkflows() {
  const row = await get('SELECT COUNT(*) AS count FROM workflows')
  if (row.count > 0) {
    return
  }

  const workflows = [
    ['Story', 'Software Development Workflow', 'Active'],
    ['Bug', 'Bug Tracking Workflow', 'Active'],
    ['Task', 'Standard Task Workflow', 'Active'],
  ]

  for (const workflow of workflows) {
    await run(
      'INSERT INTO workflows (issue_type, workflow_name, workflow_status) VALUES (?, ?, ?)',
      workflow,
    )
  }
}

export async function seedDatabase() {
  const defaultSprintId = await seedSprints()
  await seedIssues(defaultSprintId)
  await seedActivity()
  await seedMembers()
  await seedRoadmap()
  await seedProfile()
  await seedWorkflows()
  await seedProjects()
  return defaultSprintId
}
