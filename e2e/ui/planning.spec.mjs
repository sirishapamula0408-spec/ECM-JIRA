// JL-157 Track B — Planning + execution UI: Backlog, sprints (create, start,
// Active sprints tab, complete), bulk toolbar, Board, Active sprint, List view.
//
// Sprints are workspace-global: every sprint created here is retired in a
// finally block, and the project opts into parallel sprints so starting one
// never collides with another suite's.
import { test, expect } from '@playwright/test'
import { apiAs, expectStatus, uniq } from '../support/api.mjs'
import { storageStatePath } from '../support/env.mjs'
import { createProject, createIssue, createSprint, allowParallel, retireSprint } from '../support/track-b.mjs'

let owner
test.beforeAll(async () => { owner = await apiAs('owner') })
test.afterAll(async () => { await owner?.dispose() })

test.use({ storageState: storageStatePath('owner') })

async function freshProject() {
  const p = await createProject(owner)
  await allowParallel(owner, p.id, true)
  return p
}

test.describe('backlog and sprints', () => {
  test('the Backlog lists the project\'s backlog issues', async ({ page }) => {
    const p = await freshProject()
    const a = await createIssue(owner, p.id, { status: 'Backlog', title: uniq('Backlog A') })
    const b = await createIssue(owner, p.id, { status: 'Backlog', title: uniq('Backlog B') })
    await page.goto(`/projects/${p.id}/backlog`)
    await expect(page.getByRole('heading', { level: 1, name: 'Backlog' })).toBeVisible()
    await expect(page.locator('.jira-backlog-row')).toContainText('(2 work items)')
    await expect(page.getByText(a.title)).toBeVisible()
    await expect(page.getByText(b.title)).toBeVisible()
  })

  test('Create sprint moves the selected backlog issue into a new sprint', async ({ page }) => {
    const p = await freshProject()
    const a = await createIssue(owner, p.id, { status: 'Backlog' })
    await page.goto(`/projects/${p.id}/backlog`)
    await page.getByRole('checkbox', { name: `Select ${a.key}` }).check()
    await page.locator('.jira-backlog-row').getByRole('button', { name: 'Create sprint' }).click()
    const message = page.locator('.backlog-message')
    // JL-165: the sprint belongs to this project and is numbered within it.
    await expect(message).toHaveText(new RegExp(`^${p.key} Sprint 1 created with 1 issue\\(s\\)\\.$`))
    const issue = await expectStatus(await owner.get(`/api/issues/${a.id}`), 200)
    try {
      expect(issue.status).toBe('To Do')
      expect(issue.sprintId).toBeTruthy()
    } finally {
      await retireSprint(owner, issue.sprintId)
    }
  })

  test('start a sprint: the Active sprints tab appears and shows the sprint board; complete it', async ({ page }) => {
    const p = await freshProject()
    const sprint = await createSprint(owner, p.id, { name: uniq('UI Sprint') })
    try {
      const issue = await createIssue(owner, p.id, { status: 'To Do', sprintId: sprint.id, title: uniq('Sprint work') })
      await page.goto(`/projects/${p.id}/backlog`)
      const panel = page.locator('.sprint-panel-wrap', { hasText: sprint.name })
      await panel.getByRole('button', { name: 'Start sprint' }).click()
      await expect(panel.getByRole('button', { name: 'Sprint started' })).toBeVisible()

      const tab = page.getByRole('navigation', { name: 'Project Views' }).getByRole('link', { name: 'Active sprints' })
      await expect(tab).toBeVisible()
      await tab.click()
      await expect(page).toHaveURL(new RegExp(`/projects/${p.id}/active-sprint$`))
      const selector = page.getByRole('tablist', { name: 'Active sprints' })
      if (await selector.count()) await selector.getByRole('tab', { name: sprint.name }).click()
      await expect(page.locator('.active-sprint-header__name')).toHaveText(sprint.name)
      const todo = page.locator('.active-sprint-col', { has: page.getByRole('heading', { name: 'To Do', exact: true }) })
      await expect(todo).toContainText(issue.title)

      await page.getByRole('button', { name: 'Complete sprint' }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Complete sprint' }).click()
      await expect.poll(async () => (await expectStatus(await owner.get(`/api/issues/${issue.id}`), 200)).status).toBe('Backlog')
      const sprints = await expectStatus(await owner.get('/api/sprints'), 200)
      expect(sprints.find((s) => s.id === sprint.id).isStarted).toBe(false)
    } finally {
      await retireSprint(owner, sprint.id)
    }
  })

  test("a project's Backlog does not show another project's sprint", async ({ page }) => {
    const a = await freshProject()
    const b = await freshProject()
    const sprint = await createSprint(owner, a.id, { name: uniq('Project A sprint') })
    try {
      await createIssue(owner, a.id, { status: 'To Do', sprintId: sprint.id })
      await page.goto(`/projects/${b.id}/backlog`)
      await expect(page.locator('.jira-backlog-row')).toBeVisible()
      expect(await page.locator('.sprint-panel-wrap', { hasText: sprint.name }).count()).toBe(0)
    } finally {
      await retireSprint(owner, sprint.id)
    }
  })

  test('the bulk toolbar counts the selection and applies a priority change', async ({ page }) => {
    const p = await freshProject()
    const a = await createIssue(owner, p.id, { status: 'Backlog', priority: 'Low' })
    const b = await createIssue(owner, p.id, { status: 'Backlog', priority: 'Low' })
    await page.goto(`/projects/${p.id}/backlog`)
    const bulk = page.locator('.backlog-bulk')
    await expect(bulk.locator('.bulk-count')).toHaveText('0 selected')
    await page.getByRole('checkbox', { name: `Select ${a.key}` }).check()
    await page.getByRole('checkbox', { name: `Select ${b.key}` }).check()
    await expect(bulk.locator('.bulk-count')).toHaveText('2 selected')
    await bulk.getByRole('combobox', { name: 'Bulk action' }).selectOption('priority')
    await bulk.getByRole('combobox', { name: 'Priority value' }).selectOption('High')
    await bulk.getByRole('button', { name: 'Apply' }).click()
    await expect(page.locator('.backlog-message')).toHaveText('Updated 2 issue(s).')
    for (const id of [a.id, b.id]) {
      expect((await expectStatus(await owner.get(`/api/issues/${id}`), 200)).priority).toBe('High')
    }
  })
})

test.describe('board', () => {
  test('columns render per status and the card sits in its status column', async ({ page }) => {
    const p = await freshProject()
    const issue = await createIssue(owner, p.id, { status: 'To Do', title: uniq('Board card') })
    await page.goto(`/projects/${p.id}/board`)
    for (const name of ['To Do', 'In Progress', 'Done']) {
      await expect(page.locator(`.kanban-col[data-column="${name}"]`)).toBeVisible()
    }
    await expect(page.locator('.kanban-col[data-column="To Do"]')).toContainText(issue.title)
  })

  test('moving a card with its status menu persists the new status', async ({ page }) => {
    const p = await freshProject()
    const issue = await createIssue(owner, p.id, { status: 'To Do', title: uniq('Move me') })
    await page.goto(`/projects/${p.id}/board`)
    await page.getByRole('button', { name: `Status for ${issue.key}: To Do` }).click()
    await page.getByRole('menuitem', { name: 'In Progress' }).click()
    await expect(page.locator('.kanban-col[data-column="In Progress"]')).toContainText(issue.title)
    await expect.poll(async () => (await expectStatus(await owner.get(`/api/issues/${issue.id}`), 200)).status).toBe('In Progress')
  })

  test('dragging a card to another column persists the new status', async ({ page }) => {
    const p = await freshProject()
    const issue = await createIssue(owner, p.id, { status: 'To Do', title: uniq('Drag me') })
    await page.goto(`/projects/${p.id}/board`)
    const card = page.locator('.kanban-card-draggable', { hasText: issue.title })
    await card.dragTo(page.locator('.kanban-col[data-column="In Progress"]'))
    await expect.poll(async () => (await expectStatus(await owner.get(`/api/issues/${issue.id}`), 200)).status).toBe('In Progress')
  })

  test('a move the workflow forbids is not persisted', async ({ page }) => {
    const p = await freshProject()
    const issue = await createIssue(owner, p.id, { status: 'To Do', title: uniq('No skip') })
    await page.goto(`/projects/${p.id}/board`)
    await page.getByRole('button', { name: `Status for ${issue.key}: To Do` }).click()
    await page.getByRole('menuitem', { name: 'Done', exact: true }).click()
    await page.waitForTimeout(1000)
    expect((await expectStatus(await owner.get(`/api/issues/${issue.id}`), 200)).status).toBe('To Do')
  })
})

test.describe('list view', () => {
  test('renders the project issues and sorts by Priority both ways', async ({ page }) => {
    const p = await freshProject()
    const low = await createIssue(owner, p.id, { status: 'Backlog', priority: 'Low' })
    const high = await createIssue(owner, p.id, { status: 'Backlog', priority: 'High' })
    const med = await createIssue(owner, p.id, { status: 'Backlog', priority: 'Medium' })
    await page.goto(`/projects/${p.id}/list`)
    await expect(page.getByRole('heading', { level: 1, name: 'List' })).toBeVisible()
    const keys = page.locator('table.jira-list-table tbody .jira-list-key-link')
    await expect(keys).toHaveCount(3)
    const priorityHeader = page.locator('table.jira-list-table thead th', { has: page.getByRole('button', { name: 'Priority' }) })
    await priorityHeader.getByRole('button', { name: 'Priority' }).click()
    await expect(priorityHeader).toHaveAttribute('aria-sort', 'ascending')
    await expect(keys).toHaveText([low.key, med.key, high.key])
    await priorityHeader.getByRole('button', { name: 'Priority' }).click()
    await expect(priorityHeader).toHaveAttribute('aria-sort', 'descending')
    await expect(keys).toHaveText([high.key, med.key, low.key])
  })

  test('add and remove a column from the + menu', async ({ page }) => {
    const p = await freshProject()
    await createIssue(owner, p.id, { status: 'Backlog' })
    await page.goto(`/projects/${p.id}/list`)
    const headers = page.locator('table.jira-list-table thead th:not(.col-plus)')
    await expect(headers.filter({ hasText: 'Reporter' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Add column' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Reporter' }).click()
    await expect(headers.filter({ hasText: 'Reporter' })).toHaveCount(1)
    await expect(page.getByRole('menuitemcheckbox', { name: 'Reporter' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('menuitemcheckbox', { name: 'Reporter' }).click()
    await expect(headers.filter({ hasText: 'Reporter' })).toHaveCount(0)
  })

  test('an empty project list has no horizontal scrollbar at 1280px', async ({ page }) => {
    const p = await freshProject()
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`/projects/${p.id}/list`)
    await expect(page.locator('.jira-list-empty-row')).toBeVisible()
    const scroller = page.locator('.jira-list-table-scroll')
    const { scrollWidth, clientWidth } = await scroller.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  })
})
