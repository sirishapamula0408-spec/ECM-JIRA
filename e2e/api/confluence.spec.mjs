// JL-157 Track C — Confluence Lite, API layer: spaces, pages + versions,
// comments, attachments, templates, search, recent/starred, issue links, and
// the Document Store (multipart uploads, folders, versions).
import { test, expect } from '@playwright/test'
import { apiAs, uniq } from '../support/api.mjs'
import { ACCOUNTS } from '../support/env.mjs'
import {
  expectStatus, createIssue, createProject, createSpace, createPage, uploadDocument, spaceKey,
} from '../support/track-c.mjs'

let owner
let member
let viewer

test.beforeAll(async () => {
  owner = await apiAs('owner')
  member = await apiAs('member')
  viewer = await apiAs('viewer')
})

test.afterAll(async () => {
  await owner?.dispose()
  await member?.dispose()
  await viewer?.dispose()
})

// ───────────────────────────── Spaces ─────────────────────────────
test.describe('spaces', () => {
  test('create a space: key is upper-cased and the creator is its Admin', async () => {
    const key = spaceKey()
    const space = await expectStatus(await owner.post('/api/spaces', {
      data: { key: key.toLowerCase(), name: `Zz ${key}`, description: 'desc' },
    }), 201)
    expect(space.key).toBe(key)
    expect(space.myRole).toBe('Admin')
    expect(space.owner_email).toBe(ACCOUNTS.owner.email)
  })

  test('an invalid key and a missing name are rejected', async () => {
    const badKey = await expectStatus(await owner.post('/api/spaces', { data: { key: '1X', name: 'n' } }), 400)
    expect(badKey.error).toBe('key must be 2-10 characters, starting with a letter')
    const noName = await expectStatus(await owner.post('/api/spaces', { data: { key: spaceKey() } }), 400)
    expect(noName.error).toBe('name is required')
  })

  test('a duplicate key is a 409, case-insensitively', async () => {
    const space = await createSpace(owner)
    const body = await expectStatus(await owner.post('/api/spaces', {
      data: { key: space.key.toLowerCase(), name: 'dupe' },
    }), 409)
    expect(body.error).toBe(`A Space with the key ${space.key} already exists`)
  })

  test('a space is reachable by key and by id, and listed with its page count', async () => {
    const space = await createSpace(owner)
    await createPage(owner, space.id)
    const byKey = await expectStatus(await owner.get(`/api/spaces/${space.key}`), 200)
    const byId = await expectStatus(await owner.get(`/api/spaces/${space.id}`), 200)
    expect(byKey.id).toBe(space.id)
    expect(byId.key).toBe(space.key)
    const list = await expectStatus(await owner.get('/api/spaces'), 200)
    expect(list.find((s) => s.id === space.id)?.pageCount).toBe(1)
  })

  test('workspace Viewer cannot create a space', async () => {
    await expectStatus(await viewer.post('/api/spaces', { data: { key: spaceKey(), name: 'nope' } }), 403)
  })

  test('space admin can rename and archive; a non-admin gets 403', async () => {
    const space = await createSpace(owner)
    const renamed = await expectStatus(await owner.patch(`/api/spaces/${space.key}`, { data: { name: `Zz renamed ${space.key}` } }), 200)
    expect(renamed.name).toBe(`Zz renamed ${space.key}`)
    const denied = await expectStatus(await member.patch(`/api/spaces/${space.key}`, { data: { name: 'x' } }), 403)
    expect(denied.error).toBe('Only a Space Admin can change its settings')
    const archived = await expectStatus(await owner.patch(`/api/spaces/${space.key}`, { data: { archived: true } }), 200)
    expect(archived.archived).toBe(true)
    const list = await expectStatus(await owner.get('/api/spaces'), 200)
    expect(list.some((s) => s.id === space.id)).toBe(false)
    const withArchived = await expectStatus(await owner.get('/api/spaces?archived=true'), 200)
    expect(withArchived.some((s) => s.id === space.id)).toBe(true)
  })

  test('space members can be added with a role and removed', async () => {
    const space = await createSpace(owner)
    const members = await expectStatus(await owner.post(`/api/spaces/${space.key}/members`, {
      data: { email: ACCOUNTS.member.email, role: 'Member' },
    }), 201)
    expect(members.find((m) => m.user_email === ACCOUNTS.member.email)?.role).toBe('Member')
    const bad = await expectStatus(await owner.post(`/api/spaces/${space.key}/members`, { data: { email: 'x@e2e.example.com', role: 'Boss' } }), 400)
    expect(bad.error).toContain('role must be one of')
    await expectStatus(await owner.delete(`/api/spaces/${space.key}/members/${ACCOUNTS.member.email}`), 200)
    const owners = await expectStatus(await owner.delete(`/api/spaces/${space.key}/members/${ACCOUNTS.owner.email}`), 409)
    expect(owners.error).toBe('Reassign ownership before removing the owner')
  })

  test('a space with live pages cannot be deleted; an empty one can', async () => {
    const space = await createSpace(owner)
    const page = await createPage(owner, space.id)
    const refused = await expectStatus(await owner.delete(`/api/spaces/${space.key}`), 409)
    expect(refused.pageCount).toBe(1)
    await expectStatus(await owner.delete(`/api/wiki/${page.id}`), 200)
    const ok = await expectStatus(await owner.delete(`/api/spaces/${space.key}`), 200)
    expect(ok.key).toBe(space.key)
    await expectStatus(await owner.get(`/api/spaces/${space.key}`), 404)
  })

  test('only a space admin can delete it', async () => {
    const space = await createSpace(owner)
    const body = await expectStatus(await member.delete(`/api/spaces/${space.key}`), 403)
    expect(body.error).toBe('Only a Space Admin can delete a Space')
  })
})

// ───────────────────────────── Pages + versions ─────────────────────────────
test.describe('pages and versions', () => {
  let space
  test.beforeAll(async () => { space = await createSpace(owner) })

  test('create a page: version 1, and the space name comes back on read', async () => {
    const page = await createPage(owner, space.id, { title: uniq('Created') })
    const read = await expectStatus(await owner.get(`/api/wiki/${page.id}`), 200)
    expect(read.version).toBe(1)
    expect(read.space_name).toBe(space.name)
    expect(read.space_key).toBe(space.key)
    expect(read.status).toBe('published')
  })

  test('a page needs a title and a space or project', async () => {
    const body = await expectStatus(await owner.post('/api/wiki', { data: { spaceId: space.id, title: ' ' } }), 400)
    expect(body.error).toBe('projectId or spaceId, and title, are required')
  })

  test('workspace Viewer cannot create a page', async () => {
    await expectStatus(await viewer.post('/api/wiki', { data: { spaceId: space.id, title: 'x' } }), 403)
  })

  test('editing writes a new version; history is newest first', async () => {
    const page = await createPage(owner, space.id)
    await expectStatus(await owner.patch(`/api/wiki/${page.id}`, { data: { content: 'Second body line', expectedVersion: 1 } }), 200)
    const versions = await expectStatus(await owner.get(`/api/wiki/${page.id}/versions`), 200)
    expect(versions.map((v) => v.version_number)).toEqual([2, 1])
    expect(versions[0].edited_by).toBe(ACCOUNTS.owner.email)
    const read = await expectStatus(await owner.get(`/api/wiki/${page.id}`), 200)
    expect(read.version).toBe(2)
    expect(read.content).toBe('Second body line')
  })

  test('a save against a stale version is refused with 409 and who changed it', async () => {
    const page = await createPage(owner, space.id)
    await expectStatus(await owner.patch(`/api/wiki/${page.id}`, { data: { content: 'v2', expectedVersion: 1 } }), 200)
    const body = await expectStatus(await member.patch(`/api/wiki/${page.id}`, { data: { content: 'stale', expectedVersion: 1 } }), 409)
    expect(body.currentVersion).toBe(2)
    expect(body.editedBy).toBe(ACCOUNTS.owner.email)
  })

  test('compare two versions returns a line diff and flags a title change', async () => {
    const page = await createPage(owner, space.id, { content: 'alpha\nbeta' })
    await expectStatus(await owner.patch(`/api/wiki/${page.id}`, { data: { title: `${page.title} v2`, content: 'alpha\ngamma\ndelta' } }), 200)
    const cmp = await expectStatus(await owner.get(`/api/wiki/${page.id}/versions/compare?from=1&to=2`), 200)
    expect(cmp.titleChanged).toBe(true)
    expect(cmp.summary.added).toBe(2)
    expect(cmp.summary.removed).toBe(1)
    await expectStatus(await owner.get(`/api/wiki/${page.id}/versions/compare?from=1&to=9`), 404)
  })

  test('restore appends a new version carrying the old content', async () => {
    const page = await createPage(owner, space.id, { content: 'original' })
    await expectStatus(await owner.patch(`/api/wiki/${page.id}`, { data: { content: 'changed' } }), 200)
    const versions = await expectStatus(await owner.get(`/api/wiki/${page.id}/versions`), 200)
    const v1 = versions.find((v) => v.version_number === 1)
    const restored = await expectStatus(await owner.post(`/api/wiki/${page.id}/versions/${v1.id}/restore`), 200)
    expect(restored.version).toBe(3)
    expect(restored.restoredFrom).toBe(1)
    expect(restored.content).toBe('original')
    const after = await expectStatus(await owner.get(`/api/wiki/${page.id}/versions`), 200)
    expect(after.map((v) => v.version_number)).toEqual([3, 2, 1])
  })

  test('the page tree nests a child under its parent', async () => {
    const parent = await createPage(owner, space.id, { title: uniq('Parent') })
    const child = await createPage(owner, space.id, { title: uniq('Child'), parentId: parent.id })
    const tree = await expectStatus(await owner.get(`/api/wiki/tree?spaceId=${space.id}`), 200)
    const node = tree.find((n) => n.id === parent.id)
    expect(node.children.map((c) => c.id)).toEqual([child.id])
  })

  test('a draft is visible only to its author', async () => {
    const draft = await createPage(owner, space.id, { title: uniq('Draft'), status: 'draft' })
    await expectStatus(await owner.get(`/api/wiki/${draft.id}`), 200)
    await expectStatus(await member.get(`/api/wiki/${draft.id}`), 404)
    const list = await expectStatus(await member.get(`/api/wiki?spaceId=${space.id}`), 200)
    expect(list.some((p) => p.id === draft.id)).toBe(false)
  })

  test('delete is soft: the page goes to the trash and can be restored', async () => {
    const page = await createPage(owner, space.id)
    const del = await expectStatus(await owner.delete(`/api/wiki/${page.id}`), 200)
    expect(del.softDeleted).toBe(true)
    await expectStatus(await owner.get(`/api/wiki/${page.id}`), 404)
    const trash = await expectStatus(await owner.get(`/api/wiki/trash?spaceId=${space.id}`), 200)
    expect(trash.some((p) => p.id === page.id)).toBe(true)
    await expectStatus(await owner.post(`/api/wiki/${page.id}/restore`), 200)
    await expectStatus(await owner.get(`/api/wiki/${page.id}`), 200)
  })

  test('a space Viewer cannot edit pages in that space', async () => {
    test.fail(true, 'DEFECT: page create/edit/delete ignore the Space role; a Space Viewer can edit any page')
    const s = await createSpace(owner)
    await expectStatus(await owner.post(`/api/spaces/${s.key}/members`, { data: { email: ACCOUNTS.member.email, role: 'Viewer' } }), 201)
    const page = await createPage(owner, s.id, { content: 'owner text' })
    const res = await member.patch(`/api/wiki/${page.id}`, { data: { content: 'viewer overwrote this' } })
    expect(res.status()).toBe(403)
  })
})

// ───────────────────────────── Comments + attachments ─────────────────────────────
test.describe('page comments', () => {
  let page
  test.beforeAll(async () => {
    const space = await createSpace(owner)
    page = await createPage(owner, space.id)
  })

  test('comment, reply, and list as threads', async () => {
    const top = await expectStatus(await owner.post(`/api/wiki/${page.id}/comments`, { data: { body: 'Top level' } }), 201)
    const reply = await expectStatus(await member.post(`/api/wiki/${page.id}/comments`, { data: { body: 'A reply', parentId: top.id } }), 201)
    expect(reply.parent_id).toBe(top.id)
    const list = await expectStatus(await owner.get(`/api/wiki/${page.id}/comments`), 200)
    const thread = list.threads.find((t) => t.id === top.id)
    expect(thread.replies.map((r) => r.id)).toEqual([reply.id])
  })

  test('an empty comment is rejected', async () => {
    const body = await expectStatus(await owner.post(`/api/wiki/${page.id}/comments`, { data: { body: '   ' } }), 400)
    expect(body.error).toBe('A comment cannot be empty')
  })

  test('only the author can edit; author or admin can delete', async () => {
    const c = await expectStatus(await member.post(`/api/wiki/${page.id}/comments`, { data: { body: 'mine' } }), 201)
    const denied = await expectStatus(await owner.patch(`/api/wiki/${page.id}/comments/${c.id}`, { data: { body: 'not yours' } }), 403)
    expect(denied.error).toBe('Only the author can edit a comment')
    const edited = await expectStatus(await member.patch(`/api/wiki/${page.id}/comments/${c.id}`, { data: { body: 'mine, edited' } }), 200)
    expect(edited.body).toBe('mine, edited')
    expect(edited.edited_at).toBeTruthy()
    await expectStatus(await owner.delete(`/api/wiki/${page.id}/comments/${c.id}`), 200)
  })

  test('resolve and reopen a thread', async () => {
    const c = await expectStatus(await owner.post(`/api/wiki/${page.id}/comments`, { data: { body: 'resolve me' } }), 201)
    const resolved = await expectStatus(await owner.post(`/api/wiki/${page.id}/comments/${c.id}/resolve`), 200)
    expect(resolved.resolved_by).toBe(ACCOUNTS.owner.email)
    const reopened = await expectStatus(await owner.post(`/api/wiki/${page.id}/comments/${c.id}/resolve`, { data: { resolved: false } }), 200)
    expect(reopened.resolved_at).toBeNull()
  })

  test('workspace Viewer cannot comment', async () => {
    await expectStatus(await viewer.post(`/api/wiki/${page.id}/comments`, { data: { body: 'hi' } }), 403)
  })
})

test.describe('page attachments', () => {
  let page
  test.beforeAll(async () => {
    const space = await createSpace(owner)
    page = await createPage(owner, space.id)
  })

  test('upload, list, download and delete an attachment', async () => {
    const text = `attachment ${uniq('x')}`
    const created = await expectStatus(await owner.post(`/api/wiki/${page.id}/attachments`, {
      data: { filename: 'notes.txt', mimeType: 'text/plain', data: Buffer.from(text).toString('base64') },
    }), 201)
    expect(created.size_bytes).toBe(text.length)
    const list = await expectStatus(await owner.get(`/api/wiki/${page.id}/attachments`), 200)
    expect(list.map((a) => a.id)).toContain(created.id)
    const dl = await owner.get(`/api/wiki/${page.id}/attachments/${created.id}/download`)
    expect(dl.status()).toBe(200)
    expect(dl.headers()['content-disposition']).toContain('notes.txt')
    expect(await dl.text()).toBe(text)
    await expectStatus(await owner.delete(`/api/wiki/${page.id}/attachments/${created.id}`), 200)
    const after = await expectStatus(await owner.get(`/api/wiki/${page.id}/attachments`), 200)
    expect(after.some((a) => a.id === created.id)).toBe(false)
  })

  test('an executable attachment is refused', async () => {
    const body = await expectStatus(await owner.post(`/api/wiki/${page.id}/attachments`, {
      data: { filename: 'tool.exe', mimeType: 'application/octet-stream', data: Buffer.from('MZ').toString('base64') },
    }), 415)
    expect(body.error).toContain('Executable files are not allowed')
  })

  test('another member cannot delete someone else\'s attachment', async () => {
    const created = await expectStatus(await owner.post(`/api/wiki/${page.id}/attachments`, {
      data: { filename: 'keep.txt', mimeType: 'text/plain', data: Buffer.from('keep').toString('base64') },
    }), 201)
    const body = await expectStatus(await member.delete(`/api/wiki/${page.id}/attachments/${created.id}`), 403)
    expect(body.error).toBe('Only the uploader or an admin can delete an attachment')
  })
})

// ───────────────────────────── Templates ─────────────────────────────
test.describe('templates', () => {
  test('the template list includes the built-ins', async () => {
    const rows = await expectStatus(await member.get('/api/wiki-templates'), 200)
    expect(rows.some((t) => t.is_builtin)).toBe(true)
  })

  test('admin creates, edits and deletes a custom template; a page can start from it', async () => {
    const name = uniq('Template')
    const tpl = await expectStatus(await owner.post('/api/wiki-templates', { data: { name, body: 'Template body text' } }), 201)
    expect(tpl.is_builtin).toBe(false)
    const edited = await expectStatus(await owner.patch(`/api/wiki-templates/${tpl.id}`, { data: { description: 'edited' } }), 200)
    expect(edited.description).toBe('edited')
    const space = await createSpace(owner)
    const page = await createPage(owner, space.id, { content: '', templateId: tpl.id })
    const read = await expectStatus(await owner.get(`/api/wiki/${page.id}`), 200)
    expect(read.content).toBe('Template body text')
    await expectStatus(await owner.delete(`/api/wiki-templates/${tpl.id}`), 200)
    await expectStatus(await owner.get(`/api/wiki-templates/${tpl.id}`), 404)
  })

  test('a workspace Member cannot create a template', async () => {
    await expectStatus(await member.post('/api/wiki-templates', { data: { name: 'nope' } }), 403)
  })

  test('a built-in template cannot be deleted', async () => {
    const rows = await expectStatus(await owner.get('/api/wiki-templates'), 200)
    const builtin = rows.find((t) => t.is_builtin)
    const body = await expectStatus(await owner.delete(`/api/wiki-templates/${builtin.id}`), 409)
    expect(body.error).toContain('A built-in template cannot be deleted')
  })
})

// ───────────────────────────── Search, recent, starred ─────────────────────────────
test.describe('search, recent and starred', () => {
  let spaceA
  let spaceB
  let term
  let pageA
  let pageB
  test.beforeAll(async () => {
    term = uniq('zebra').replace(/-/g, '')
    spaceA = await createSpace(owner)
    spaceB = await createSpace(owner)
    pageA = await createPage(owner, spaceA.id, { title: uniq('SearchA'), content: `Intro words. The ${term} appears in the middle of this body.` })
    pageB = await createPage(owner, spaceB.id, { title: uniq('SearchB'), content: `Another ${term} mention` })
  })

  test('search finds pages by body text and returns an excerpt with the term', async () => {
    const body = await expectStatus(await owner.get(`/api/wiki-home/search?q=${term}`), 200)
    expect(body.total).toBe(2)
    const hit = body.items.find((i) => i.id === pageA.id)
    expect(hit.excerpt.text.toLowerCase()).toContain(term.toLowerCase())
    expect(hit.excerpt.ranges.length).toBeGreaterThanOrEqual(1)
  })

  test('the space filter narrows search to one space', async () => {
    const body = await expectStatus(await owner.get(`/api/wiki-home/search?q=${term}&spaceId=${spaceB.id}`), 200)
    expect(body.items.map((i) => i.id)).toEqual([pageB.id])
  })

  test('a title match ranks above a body match', async () => {
    const titled = await createPage(owner, spaceA.id, { title: `${term} handbook`, content: 'no mention here' })
    const body = await expectStatus(await owner.get(`/api/wiki-home/search?q=${term}`), 200)
    expect(body.items[0].id).toBe(titled.id)
  })

  test('trashed pages and other people\'s drafts are not searchable', async () => {
    const t2 = uniq('quokka').replace(/-/g, '')
    const trashed = await createPage(owner, spaceA.id, { content: `gone ${t2}` })
    await expectStatus(await owner.delete(`/api/wiki/${trashed.id}`), 200)
    await createPage(owner, spaceA.id, { content: `draft ${t2}`, status: 'draft' })
    const forOwner = await expectStatus(await owner.get(`/api/wiki-home/search?q=${t2}`), 200)
    expect(forOwner.items.some((i) => i.id === trashed.id)).toBe(false)
    const forMember = await expectStatus(await member.get(`/api/wiki-home/search?q=${t2}`), 200)
    expect(forMember.total).toBe(0)
  })

  test('the legacy /api/wiki/search hides other people\'s drafts and trashed pages', async () => {
    test.fail(true, 'DEFECT: GET /api/wiki/search has no draft or trash filter and discloses private draft titles')
    const t3 = uniq('narwhal').replace(/-/g, '')
    const draft = await createPage(owner, spaceA.id, { title: `Secret ${t3}`, status: 'draft' })
    const rows = await expectStatus(await member.get(`/api/wiki/search?q=${t3}`), 200)
    expect(rows.some((r) => r.id === draft.id)).toBe(false)
  })

  test('viewing a page puts it in Recent', async () => {
    await expectStatus(await member.post(`/api/wiki-home/views/${pageA.id}`), 201)
    const recent = await expectStatus(await member.get('/api/wiki-home/list?kind=recent'), 200)
    expect(recent.items[0].id).toBe(pageA.id)
    const home = await expectStatus(await member.get('/api/wiki-home'), 200)
    expect(home.recent.some((p) => p.id === pageA.id)).toBe(true)
  })

  test('star and unstar a page and a space', async () => {
    await expectStatus(await member.post('/api/wiki-home/favorites', { data: { targetType: 'page', targetId: pageB.id } }), 201)
    await expectStatus(await member.post('/api/wiki-home/favorites', { data: { targetType: 'space', targetId: spaceB.id } }), 201)
    const starred = await expectStatus(await member.get('/api/wiki-home/list?kind=starred'), 200)
    expect(starred.items.some((p) => p.id === pageB.id)).toBe(true)
    const home = await expectStatus(await member.get('/api/wiki-home'), 200)
    expect(home.starredSpaces.some((s) => s.id === spaceB.id)).toBe(true)
    await expectStatus(await member.delete(`/api/wiki-home/favorites/page/${pageB.id}`), 200)
    await expectStatus(await member.delete(`/api/wiki-home/favorites/space/${spaceB.id}`), 200)
    const after = await expectStatus(await member.get('/api/wiki-home/list?kind=starred'), 200)
    expect(after.items.some((p) => p.id === pageB.id)).toBe(false)
  })

  test('favouriting a bad target type is a 400', async () => {
    await expectStatus(await member.post('/api/wiki-home/favorites', { data: { targetType: 'issue', targetId: 1 } }), 400)
  })
})

// ───────────────────────────── Page <-> issue links ─────────────────────────────
test.describe('page to issue links', () => {
  test('link by key is visible from the page and from the issue; unlink removes it', async () => {
    const project = await createProject(owner)
    const issue = await createIssue(owner, project.id, { status: 'In Testing' })
    const space = await createSpace(owner)
    const page = await createPage(owner, space.id)
    const linked = await expectStatus(await owner.post(`/api/wiki/${page.id}/link-issue`, { data: { issueKey: issue.key.toLowerCase() } }), 201)
    expect(linked.issueId).toBe(issue.id)
    const read = await expectStatus(await owner.get(`/api/wiki/${page.id}`), 200)
    const li = read.linkedIssues.find((l) => l.issue_id === issue.id)
    expect(li.issue_key).toBe(issue.key)
    expect(li.issue_status).toBe('In Testing')
    const fromIssue = await expectStatus(await owner.get(`/api/wiki/by-issue/${issue.id}`), 200)
    expect(fromIssue.map((p) => p.id)).toEqual([page.id])
    expect(fromIssue[0].space_key).toBe(space.key)
    await expectStatus(await owner.delete(`/api/wiki/${page.id}/link-issue/${issue.id}`), 200)
    expect(await expectStatus(await owner.get(`/api/wiki/by-issue/${issue.id}`), 200)).toEqual([])
  })

  test('linking a non-existent issue key is a 404', async () => {
    const space = await createSpace(owner)
    const page = await createPage(owner, space.id)
    const body = await expectStatus(await owner.post(`/api/wiki/${page.id}/link-issue`, { data: { issueKey: 'NOPE-99999' } }), 404)
    expect(body.error).toBe('Issue NOPE-99999 not found')
  })
})

// ───────────────────────────── Documents ─────────────────────────────
test.describe('documents', () => {
  let space
  test.beforeAll(async () => { space = await createSpace(owner) })

  test('multipart upload creates version 1 and the list shows it with storage usage', async () => {
    const res = await uploadDocument(owner, space.key, { name: `${uniq('doc')}.txt`, body: 'hello documents', fields: { description: 'first', tags: 'alpha,beta' } })
    const doc = await expectStatus(res, 201)
    expect(doc.current_version).toBe(1)
    expect(doc.file_extension).toBe('txt')
    expect(Number(doc.file_size)).toBe(15)
    const list = await expectStatus(await owner.get(`/api/spaces/${space.key}/documents`), 200)
    expect(list.items.some((d) => d.id === doc.id)).toBe(true)
    expect(list.storage.usedBytes).toBeGreaterThanOrEqual(15)
    expect(list.myRole).toBe('Admin')
  })

  test('create a folder, refuse a duplicate, upload into it and filter by it', async () => {
    const folderName = uniq('Folder')
    const folder = await expectStatus(await owner.post(`/api/spaces/${space.key}/folders`, { data: { folderName } }), 201)
    const dup = await expectStatus(await owner.post(`/api/spaces/${space.key}/folders`, { data: { folderName: folderName.toUpperCase() } }), 409)
    expect(dup.error).toContain('already exists here')
    const doc = await expectStatus(await uploadDocument(owner, space.key, {
      name: 'in-folder.md', body: '# in folder', mimeType: 'text/markdown', fields: { folderId: String(folder.id) },
    }), 201)
    const inFolder = await expectStatus(await owner.get(`/api/spaces/${space.key}/documents?folderId=${folder.id}`), 200)
    expect(inFolder.items.map((d) => d.id)).toEqual([doc.id])
    expect(inFolder.items[0].folder_name).toBe(folderName)
    const folders = await expectStatus(await owner.get(`/api/spaces/${space.key}/folders`), 200)
    expect(folders.some((f) => f.id === folder.id)).toBe(true)
  })

  test('a new version bumps current_version; download serves current and old versions', async () => {
    const name = `${uniq('versioned')}.txt`
    const doc = await expectStatus(await uploadDocument(owner, space.key, { name, body: 'version one' }), 201)
    const v2 = await expectStatus(await owner.post(`/api/documents/${doc.id}/versions`, {
      multipart: { file: { name, mimeType: 'text/plain', buffer: Buffer.from('version two!') }, changeComment: 'second' },
    }), 201)
    expect(v2.current_version).toBe(2)
    const versions = await expectStatus(await owner.get(`/api/documents/${doc.id}/versions`), 200)
    expect(versions.items.map((v) => v.version_number)).toEqual([2, 1])
    expect(versions.items[0].change_comment).toBe('second')
    const current = await owner.get(`/api/documents/${doc.id}/download`)
    expect(current.status()).toBe(200)
    expect(current.headers()['content-disposition']).toContain(name)
    expect(await current.text()).toBe('version two!')
    const v1 = versions.items.find((v) => v.version_number === 1)
    const old = await owner.get(`/api/documents/${doc.id}/download?versionId=${v1.id}`)
    expect(await old.text()).toBe('version one')
  })

  test('an executable (.exe) is refused', async () => {
    const res = await uploadDocument(owner, space.key, { name: 'setup.exe', body: Buffer.from([0x4d, 0x5a, 0x90, 0x00]), mimeType: 'application/octet-stream' })
    const body = await expectStatus(res, 415)
    expect(body.error).toBe('Executable files are not allowed. ".exe" cannot be uploaded.')
  })

  test('a file whose bytes do not match its extension is refused', async () => {
    const res = await uploadDocument(owner, space.key, { name: `${uniq('fake')}.pdf`, body: 'this is not a pdf', mimeType: 'application/pdf' })
    expect(res.status()).toBe(415)
  })

  test('a duplicate file name in the same folder is a 409', async () => {
    const name = `${uniq('dupe')}.txt`
    await expectStatus(await uploadDocument(owner, space.key, { name, body: 'a' }), 201)
    const body = await expectStatus(await uploadDocument(owner, space.key, { name, body: 'b' }), 409)
    expect(body.existingDocumentId).toBeTruthy()
  })

  test('an upload with no file is a 400', async () => {
    const body = await expectStatus(await owner.post(`/api/spaces/${space.key}/documents`, { multipart: { description: 'nothing' } }), 400)
    expect(body.error).toContain('No file was uploaded')
  })

  test('a space Viewer cannot upload', async () => {
    const s = await createSpace(owner)
    await expectStatus(await owner.post(`/api/spaces/${s.key}/members`, { data: { email: ACCOUNTS.member.email, role: 'Viewer' } }), 201)
    const body = await expectStatus(await uploadDocument(member, s.key, { name: 'x.txt', body: 'x' }), 403)
    expect(body.error).toBe('You do not have permission to upload to this Space')
  })

  test('delete a document: it leaves the list and its detail is a 404', async () => {
    const doc = await expectStatus(await uploadDocument(owner, space.key, { name: `${uniq('bye')}.txt`, body: 'bye' }), 201)
    const nonAdmin = await expectStatus(await member.delete(`/api/documents/${doc.id}`), 403)
    expect(nonAdmin.error).toBe('Only a Space Admin can delete a document')
    await expectStatus(await owner.delete(`/api/documents/${doc.id}`), 200)
    await expectStatus(await owner.get(`/api/documents/${doc.id}`), 404)
    const list = await expectStatus(await owner.get(`/api/spaces/${space.key}/documents`), 200)
    expect(list.items.some((d) => d.id === doc.id)).toBe(false)
  })

  test('a folder that still holds documents cannot be deleted', async () => {
    const folder = await expectStatus(await owner.post(`/api/spaces/${space.key}/folders`, { data: { folderName: uniq('Full') } }), 201)
    await expectStatus(await uploadDocument(owner, space.key, { name: 'f.txt', body: 'f', fields: { folderId: String(folder.id) } }), 201)
    const body = await expectStatus(await owner.delete(`/api/folders/${folder.id}`), 409)
    expect(body.documentCount).toBe(1)
  })
})
