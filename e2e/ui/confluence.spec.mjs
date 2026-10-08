// JL-157 Track C — Confluence Lite, UI layer: the app switcher and product
// shell, spaces, creating / editing a page, version history, comments, search
// and document upload.
import { test, expect } from '@playwright/test'
import { apiAs, uniq } from '../support/api.mjs'
import { storageStatePath } from '../support/env.mjs'
import { expectStatus, createSpace, createPage, watchPage, expectClean, spaceKey } from '../support/track-c.mjs'

test.use({ storageState: storageStatePath('owner') })

let owner
test.beforeAll(async () => { owner = await apiAs('owner') })
test.afterAll(async () => { await owner?.dispose() })

/*
 * Spaces made for the UI flows are named to sort FIRST: the page creator only
 * offers the first five Spaces by name (see the defect test below), and every
 * run of every spec adds more.
 */
async function uiSpace() {
  const key = spaceKey()
  // The number shrinks over time, so the newest such Space always sorts first.
  const rank = String(1e13 - Date.now()).padStart(13, '0')
  return expectStatus(await owner.post('/api/spaces', { data: { key, name: `0 ${rank} TrackC ${key}` } }), 201)
}

test('the app switcher opens Confluence Lite with its own sidebar and no Jira sidebar', async ({ page }) => {
  const problems = watchPage(page)
  await page.goto('/projects')
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible()
  await page.getByRole('button', { name: 'App switcher' }).click()
  await page.getByRole('menuitem', { name: /Confluence Lite/ }).click()
  await expect(page).toHaveURL(/\/wiki\/home$/)
  await expect(page.getByLabel('Confluence Lite', { exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Confluence Lite home' })).toBeVisible()
  expectClean(problems)
})

test('create a space from the Spaces page and open it', async ({ page }) => {
  const problems = watchPage(page)
  const key = spaceKey()
  const name = `0 TrackC UI ${key}`
  await page.goto('/spaces')
  await expect(page.getByRole('heading', { level: 1, name: 'Knowledge' })).toBeVisible()
  await page.getByRole('button', { name: 'Create Space' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create a Space' })
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Key').fill(key.toLowerCase())
  await dialog.getByLabel('Description').fill('Made by the UI suite')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await expect(page).toHaveURL(new RegExp(`/spaces/${key}$`))
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  await expect(page.getByText('No pages in this Space yet')).toBeVisible()
  expectClean(problems)
})

test('a duplicate space key shows the server\'s error in the dialog', async ({ page }) => {
  const existing = await uiSpace()
  await page.goto('/spaces')
  await page.getByRole('button', { name: 'Create Space' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create a Space' })
  await dialog.getByLabel('Name').fill('dupe')
  await dialog.getByLabel('Key').fill(existing.key)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText(`A Space with the key ${existing.key} already exists`)
})

test('create a page in a space; it opens with its title, content and space link', async ({ page }) => {
  const problems = watchPage(page)
  const space = await uiSpace()
  const title = uniq('UI page')
  await page.goto('/wiki/new')
  await expect(page.getByRole('heading', { level: 1, name: 'Create page' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Space' }).click()
  await page.getByRole('option', { name: space.name, exact: true }).click()
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Content').fill('Hello from the functional suite')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page).toHaveURL(/\/wiki\/pages\/\d+$/)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(page.getByText('Hello from the functional suite')).toBeVisible()
  await expect(page.getByRole('link', { name: space.name })).toHaveAttribute('href', `/spaces/${space.key}`)
  expectClean(problems)
})

test('"Create page" inside a space preselects that space', async ({ page }) => {
  test.fail(true, 'DEFECT: Create page from a Space ignores the Space; the creator defaults to the first of only five sidebar Spaces')
  const space = await createSpace(owner) // a "Zz…" space, sorted late
  await page.goto(`/spaces/${space.key}`)
  await page.getByRole('button', { name: 'Create page' }).first().click()
  await expect(page).toHaveURL(/\/wiki\/new/)
  await expect(page.getByRole('combobox', { name: 'Space' })).toHaveText(space.name, { timeout: 5_000 })
})

test('edit a page, then compare and restore versions from history', async ({ page }) => {
  const problems = watchPage(page)
  const space = await uiSpace()
  const created = await createPage(owner, space.id, { title: uniq('Versioned'), content: 'First draft text' })
  await page.goto(`/wiki/pages/${created.id}`)
  await expect(page.getByText('First draft text')).toBeVisible()

  await page.getByRole('button', { name: 'Edit' }).click()
  const editor = page.locator('.ProseMirror').first()
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' plus an edit made in the browser')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('plus an edit made in the browser')).toBeVisible()

  const versions = await expectStatus(await owner.get(`/api/wiki/${created.id}/versions`), 200)
  expect(versions.map((v) => v.version_number)).toEqual([2, 1])

  await page.getByRole('button', { name: 'History' }).click()
  const history = page.getByRole('complementary', { name: 'Version history' })
  await expect(history.getByRole('heading', { name: 'Version history' })).toBeVisible()
  await history.getByLabel('Select version 1 to compare').check()
  await history.getByLabel('Select version 2 to compare').check()
  await history.getByRole('button', { name: 'Compare selected' }).click()
  await expect(history.getByRole('heading', { name: 'v1 → v2' })).toBeVisible()

  await history.getByRole('button', { name: 'Restore' }).click()
  const confirm = page.getByRole('dialog', { name: 'Restore version 1?' })
  await confirm.getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByText('plus an edit made in the browser')).toHaveCount(0)
  await expect(page.getByText('First draft text')).toBeVisible()
  const after = await expectStatus(await owner.get(`/api/wiki/${created.id}/versions`), 200)
  expect(after.map((v) => v.version_number)).toEqual([3, 2, 1])
  expectClean(problems)
})

test('add a comment to a page', async ({ page }) => {
  const problems = watchPage(page)
  const space = await uiSpace()
  const created = await createPage(owner, space.id)
  const text = uniq('A page comment')
  await page.goto(`/wiki/pages/${created.id}`)
  await page.getByLabel('Add a comment').fill(text)
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(page.locator('.wiki-comments').getByText(text)).toBeVisible()
  const list = await expectStatus(await owner.get(`/api/wiki/${created.id}/comments`), 200)
  expect(list.threads.some((t) => t.body === text)).toBe(true)
  expectClean(problems)
})

test('search finds a page and highlights the term in its excerpt', async ({ page }) => {
  const problems = watchPage(page)
  const space = await uiSpace()
  const term = uniq('pangolin').replace(/-/g, '')
  const created = await createPage(owner, space.id, { title: uniq('Searchable'), content: `Some text about the ${term} here.` })
  await page.goto(`/wiki/search?q=${term}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible()
  const hit = page.locator('.wiki-search-result', { hasText: created.title })
  await expect(hit).toBeVisible()
  await expect(hit.locator('mark.wiki-search-mark')).toHaveText(term)
  expectClean(problems)
})

test('upload a document to a space from the Documents tab', async ({ page }) => {
  const problems = watchPage(page)
  const space = await uiSpace()
  const fileName = `${uniq('ui-doc')}.txt`
  await page.goto(`/spaces/${space.key}`)
  await page.getByRole('tab', { name: 'Documents' }).click()
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Upload documents' })
  await dialog.locator('#document-upload-input').setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: Buffer.from('uploaded through the UI') })
  await dialog.getByRole('button', { name: 'Upload 1 file' }).click()
  await expect(dialog.getByText('Uploaded', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.space-documents-table').getByText(fileName)).toBeVisible()
  const list = await expectStatus(await owner.get(`/api/spaces/${space.key}/documents`), 200)
  expect(list.items.map((d) => d.file_name)).toContain(fileName)
  expectClean(problems)
})

test('an executable is refused in the upload dialog with the server\'s message', async ({ page }) => {
  const space = await uiSpace()
  await page.goto(`/spaces/${space.key}`)
  await page.getByRole('tab', { name: 'Documents' }).click()
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Upload documents' })
  await dialog.locator('#document-upload-input').setInputFiles({ name: 'setup.exe', mimeType: 'application/octet-stream', buffer: Buffer.from([0x4d, 0x5a]) })
  const uploadButton = dialog.getByRole('button', { name: /^Upload/ })
  if (await uploadButton.isEnabled()) await uploadButton.click()
  await expect(dialog.getByRole('alert')).toContainText('.exe')
})
