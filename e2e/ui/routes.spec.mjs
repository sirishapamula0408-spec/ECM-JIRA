// JL-157 Track C — page-by-page smoke over every route in src/App.jsx.
//
// For each route: no uncaught page error, no console error, no /api response
// >= 500, and a visible level-1 heading (JL-409 / JL-416: every page owns a
// plain <h1>). Generated from a table so one broken page cannot hide another.
import { test, expect } from '@playwright/test'
import { apiAs, uniq } from '../support/api.mjs'
import { storageStatePath } from '../support/env.mjs'
import { expectStatus, createIssue, createProject, createSpace, createPage, watchPage } from '../support/track-c.mjs'

// Ids every parameterised route needs, created once per worker.
const ids = {}

test.beforeAll(async () => {
  const owner = await apiAs('owner')
  const project = await createProject(owner)
  const issue = await createIssue(owner, project.id)
  const space = await createSpace(owner)
  const page = await createPage(owner, space.id, { title: uniq('Route page') })
  const team = await expectStatus(await owner.post('/api/teams', { data: { name: uniq('Route team') } }), 201)
  Object.assign(ids, {
    projectId: project.id,
    issueId: issue.id,
    issueKey: issue.key,
    spaceKey: space.key,
    pageId: page.id,
    teamId: team.id ?? team.team?.id,
  })
  await owner.dispose()
})

// [path builder, label, known defect or null]
const ROUTES = [
  [() => '/', 'home (dashboard)'],
  [() => '/dashboard', 'dashboard'],
  [() => '/backlog', 'backlog'],
  [() => '/board', 'board'],
  [() => '/active-sprint', 'active sprint'],
  [() => '/reports', 'reports'],
  [() => '/report-builder', 'report builder'],
  [() => '/roadmap', 'roadmap'],
  [() => '/projects', 'projects'],
  [(i) => `/projects/${i.projectId}`, 'project summary'],
  [(i) => `/projects/${i.projectId}/settings`, 'project settings'],
  [(i) => `/projects/${i.projectId}/board`, 'project board'],
  [(i) => `/projects/${i.projectId}/backlog`, 'project backlog'],
  [(i) => `/projects/${i.projectId}/reports`, 'project reports'],
  [(i) => `/projects/${i.projectId}/roadmap`, 'project roadmap'],
  [(i) => `/projects/${i.projectId}/active-sprint`, 'project active sprint'],
  [(i) => `/projects/${i.projectId}/list`, 'project issue list'],
  [() => '/list', 'issue list'],
  [() => '/workflow-editor', 'workflow editor'],
  [() => '/filters', 'filters'],
  [() => '/portfolio', 'portfolio'],
  [() => '/knowledge-base', 'knowledge base'],
  [() => '/advanced-roadmap', 'advanced roadmap'],
  [() => '/members', 'member directory'],
  [() => '/users', 'user management'],
  [() => '/teams', 'team directory'],
  [(i) => `/teams/${i.teamId}`, 'team profile'],
  [() => '/profile', 'profile'],
  [(i) => `/browse/${i.issueKey}`, 'issue by key'],
  [(i) => `/issues/${i.issueId}`, 'issue by legacy id'],
  [() => '/activity', 'activity feed'],
  [() => '/shared-dashboards', 'shared dashboards'],
  [() => '/cross-project-boards', 'cross-project boards'],
  [() => '/webhooks', 'webhooks'],
  [() => '/marketplace', 'marketplace'],
  [() => '/inbound-email', 'inbound email'],
  [() => '/audit-log', 'audit log'],
  [() => '/bi-export', 'BI export'],
  [(i) => `/projects/${i.projectId}/wiki`, 'project wiki'],
  [() => '/automation', 'automation'],
  [(i) => `/projects/${i.projectId}/automation`, 'project automation'],
  [() => '/releases', 'releases'],
  [(i) => `/projects/${i.projectId}/releases`, 'project releases'],
  [() => '/queues', 'queues'],
  [(i) => `/projects/${i.projectId}/queues`, 'project queues'],
  [() => '/incidents', 'incidents'],
  [() => '/goals', 'goals'],
  [() => '/plugins', 'plugins'],
  [(i) => `/projects/${i.projectId}/goals`, 'project goals'],
  [() => '/assets', 'assets'],
  [() => '/portal', 'portal'],
  // Confluence Lite
  [() => '/wiki/home', 'wiki home'],
  [() => '/wiki/new', 'wiki create page'],
  [(i) => `/wiki/pages/${i.pageId}`, 'wiki page viewer'],
  [() => '/wiki/recent', 'wiki recent'],
  [() => '/wiki/starred', 'wiki starred'],
  [() => '/wiki/search?q=route', 'wiki search'],
  [() => '/wiki/apps', 'wiki apps'],
  [() => '/spaces', 'spaces directory'],
  [(i) => `/spaces/${i.spaceKey}`, 'space view'],
]

// Defects confirmed by reading the code; the test stays and is expected to fail.
const KNOWN = {
  'project wiki': 'no level-1 heading until a page is selected; the placeholder title "Project Wiki" is an <h2> (src/pages/WikiPage/WikiPage.jsx:273)',
  'wiki apps': '/wiki/apps renders only an EmptyState (<h3>) and has no <h1> (src/pages/WikiHomePage/WikiAppsPage.jsx:20)',
}
// Same, for the lower-role runs: the "Admins only" branch drops the page <h1>.
const KNOWN_LOWER_ROLE = {
  'audit log': 'non-admin "Admins only" branch has no <h1> (src/pages/AuditLogPage/AuditLogPage.jsx:77)',
  'BI export': 'non-admin "Admins only" branch has no <h1> (src/pages/BiExportPage/BiExportPage.jsx:52)',
}

async function smoke(page, path) {
  const problems = watchPage(page)
  await page.goto(path)
  await page.waitForLoadState('networkidle').catch(() => {})
  const h1 = page.locator('h1:visible').first()
  await expect(h1, `visible <h1> on ${path}`).toBeVisible({ timeout: 15_000 })
  await expect(h1).not.toHaveText(/^\s*$/)
  // Late-arriving errors (a second fetch, a lazy chunk) get a moment to land.
  await page.waitForTimeout(400)
  return problems
}

function assertClean(problems) {
  expect.soft(problems.pageErrors, 'uncaught page errors').toEqual([])
  expect.soft(problems.consoleErrors, 'console errors').toEqual([])
  expect(problems.serverErrors, 'API responses >= 500').toEqual([])
}

test.describe('every route as owner', () => {
  test.use({ storageState: storageStatePath('owner') })

  for (const [build, label] of ROUTES) {
    test(`${label} renders cleanly with an h1`, async ({ page }) => {
      if (KNOWN[label]) test.fail(true, `DEFECT: ${KNOWN[label]}`)
      const problems = await smoke(page, build(ids))
      assertClean(problems)
    })
  }

  test('an unknown URL shows the 404 page', async ({ page }) => {
    const problems = await smoke(page, `/no-such-page-${Date.now()}`)
    await expect(page.locator('h1:visible').first()).toHaveText('404')
    await expect(page.getByText('The page you are looking for does not exist.')).toBeVisible()
    assertClean(problems)
  })

  test('legacy /teams-directory redirects to /teams', async ({ page }) => {
    await page.goto('/teams-directory')
    await expect(page).toHaveURL(/\/teams$/)
  })

  test('legacy /workflows redirects to /list', async ({ page }) => {
    await page.goto('/workflows')
    await expect(page).toHaveURL(/\/list$/)
  })

  test('/wiki redirects to /wiki/home', async ({ page }) => {
    await page.goto('/wiki')
    await expect(page).toHaveURL(/\/wiki\/home$/)
  })
})

// Admin-gated (RequireRole) and admin-flavoured pages, as lower roles.
const ADMIN_PAGES = [
  ['/webhooks', 'webhooks'],
  ['/audit-log', 'audit log'],
  ['/bi-export', 'BI export'],
  ['/inbound-email', 'inbound email'],
  ['/automation', 'automation'],
  ['/workflow-editor', 'workflow editor'],
]

for (const role of ['member', 'viewer']) {
  test.describe(`as ${role}`, () => {
    test.use({ storageState: storageStatePath(role) })

    for (const path of ['/members', '/users']) {
      test(`${path} redirects a ${role} away`, async ({ page }) => {
        const problems = watchPage(page)
        await page.goto(path)
        await page.waitForLoadState('networkidle').catch(() => {})
        await expect(page).not.toHaveURL(new RegExp(`${path}$`))
        expect(problems.serverErrors).toEqual([])
        expect(problems.pageErrors).toEqual([])
      })
    }

    for (const [path, label] of ADMIN_PAGES) {
      test(`${label} renders for a ${role} without errors, with an h1`, async ({ page }) => {
        if (KNOWN_LOWER_ROLE[label]) test.fail(true, `DEFECT: ${KNOWN_LOWER_ROLE[label]}`)
        const problems = await smoke(page, path)
        expect.soft(problems.pageErrors, 'uncaught page errors').toEqual([])
        expect(problems.serverErrors, 'API responses >= 500').toEqual([])
      })
    }
  })
}
