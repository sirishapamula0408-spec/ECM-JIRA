import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

/**
 * Pure, unit-testable slug generator.
 * Lowercases, replaces any run of non-alphanumeric characters with a single
 * hyphen, and strips leading/trailing hyphens.
 *
 *   slugify('Hello, World!')       -> 'hello-world'
 *   slugify('  Multiple   Spaces') -> 'multiple-spaces'
 *   slugify('Reset -- Password!!') -> 'reset-password'
 */
export function slugify(title) {
  return String(title || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Generate a slug for `title` that is unique within `table`, appending a
 * numeric suffix (-2, -3, ...) when a collision is found. `excludeId` lets an
 * update keep its own slug.
 */
async function uniqueSlug(table, title, excludeId = null) {
  const base = slugify(title) || 'untitled'
  let candidate = base
  let n = 1
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = excludeId
      ? await get(`SELECT id FROM ${table} WHERE slug = ? AND id <> ?`, [candidate, excludeId])
      : await get(`SELECT id FROM ${table} WHERE slug = ?`, [candidate])
    if (!existing) return candidate
    n += 1
    candidate = `${base}-${n}`
  }
}

/* ================================================================
   Categories
   ================================================================ */

// GET /api/kb/categories — list categories (with article counts)
router.get('/kb/categories', asyncHandler(async (_req, res) => {
  const rows = await all(
    `SELECT c.id, c.name, c.slug, c.description, c.created_at,
            COUNT(a.id) AS article_count
       FROM kb_categories c
       LEFT JOIN kb_articles a ON a.category_id = c.id
      GROUP BY c.id
      ORDER BY c.name ASC`,
  )
  res.json(rows)
}))

// POST /api/kb/categories — create category (Admin only)
router.post('/kb/categories', requireRole('Admin'), asyncHandler(async (req, res) => {
  const { name, description = '' } = req.body
  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const slug = await uniqueSlug('kb_categories', name)
  const result = await run(
    'INSERT INTO kb_categories (name, slug, description) VALUES (?, ?, ?)',
    [name.trim(), slug, description],
  )
  const row = await get('SELECT * FROM kb_categories WHERE id = ?', [result.lastID])
  res.status(201).json(row)
}))

// PATCH /api/kb/categories/:id — update category (Admin only)
router.patch('/kb/categories/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT * FROM kb_categories WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Category not found' })
    return
  }
  const { name, description } = req.body
  const sets = []
  const params = []
  if (name !== undefined) {
    sets.push('name = ?'); params.push(name.trim())
    sets.push('slug = ?'); params.push(await uniqueSlug('kb_categories', name, id))
  }
  if (description !== undefined) { sets.push('description = ?'); params.push(description) }
  if (sets.length === 0) {
    res.json(existing)
    return
  }
  params.push(id)
  await run(`UPDATE kb_categories SET ${sets.join(', ')} WHERE id = ?`, params)
  const row = await get('SELECT * FROM kb_categories WHERE id = ?', [id])
  res.json(row)
}))

// DELETE /api/kb/categories/:id — delete category (Admin only)
router.delete('/kb/categories/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  await run('DELETE FROM kb_categories WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

/* ================================================================
   Public (customer-facing) read view — published articles only
   Registered BEFORE the authoring /kb/articles/:id route so the
   'public' path segment is never captured as an :id.
   ================================================================ */

// GET /api/kb/public/articles — list published articles
router.get('/kb/public/articles', asyncHandler(async (req, res) => {
  const search = String(req.query.search || '').trim()
  const category = req.query.category ? Number(req.query.category) : null
  let sql = `SELECT a.id, a.category_id, a.title, a.slug, a.body, a.author_email,
                    a.views, a.created_at, a.updated_at, c.name AS category_name
               FROM kb_articles a
               LEFT JOIN kb_categories c ON c.id = a.category_id
              WHERE a.status = ?`
  const params = ['published']
  if (category) { sql += ' AND a.category_id = ?'; params.push(category) }
  if (search) {
    sql += ' AND (a.title ILIKE ? OR a.body ILIKE ?)'
    const term = `%${search}%`
    params.push(term, term)
  }
  sql += ' ORDER BY a.updated_at DESC'
  const rows = await all(sql, params)
  res.json(rows)
}))

// GET /api/kb/public/articles/:slug — single published article (increments views)
router.get('/kb/public/articles/:slug', asyncHandler(async (req, res) => {
  const slug = String(req.params.slug)
  const row = await get(
    `SELECT a.id, a.category_id, a.title, a.slug, a.body, a.author_email,
            a.views, a.created_at, a.updated_at, c.name AS category_name
       FROM kb_articles a
       LEFT JOIN kb_categories c ON c.id = a.category_id
      WHERE a.slug = ? AND a.status = ?`,
    [slug, 'published'],
  )
  if (!row) {
    res.status(404).json({ error: 'Article not found' })
    return
  }
  await run("UPDATE kb_articles SET views = views + 1 WHERE slug = ? AND status = 'published'", [slug])
  res.json({ ...row, views: (row.views || 0) + 1 })
}))

/* ================================================================
   Articles (authoring)
   ================================================================ */

// GET /api/kb/articles — list (authoring), ?search ?status ?category
router.get('/kb/articles', asyncHandler(async (req, res) => {
  const search = String(req.query.search || '').trim()
  const status = req.query.status ? String(req.query.status) : null
  const category = req.query.category ? Number(req.query.category) : null
  let sql = `SELECT a.id, a.category_id, a.title, a.slug, a.status, a.author_email,
                    a.views, a.created_at, a.updated_at, c.name AS category_name
               FROM kb_articles a
               LEFT JOIN kb_categories c ON c.id = a.category_id
              WHERE 1 = 1`
  const params = []
  if (status) { sql += ' AND a.status = ?'; params.push(status) }
  if (category) { sql += ' AND a.category_id = ?'; params.push(category) }
  if (search) {
    sql += ' AND (a.title ILIKE ? OR a.body ILIKE ?)'
    const term = `%${search}%`
    params.push(term, term)
  }
  sql += ' ORDER BY a.updated_at DESC'
  const rows = await all(sql, params)
  res.json(rows)
}))

// GET /api/kb/articles/:id — single article (authoring)
router.get('/kb/articles/:id', asyncHandler(async (req, res) => {
  const row = await get(
    `SELECT a.*, c.name AS category_name
       FROM kb_articles a
       LEFT JOIN kb_categories c ON c.id = a.category_id
      WHERE a.id = ?`,
    [Number(req.params.id)],
  )
  if (!row) {
    res.status(404).json({ error: 'Article not found' })
    return
  }
  res.json(row)
}))

// POST /api/kb/articles — create article (generated slug, default draft)
router.post('/kb/articles', asyncHandler(async (req, res) => {
  const { title, body = '', categoryId = null, status = 'draft' } = req.body
  if (!title?.trim()) {
    res.status(400).json({ error: 'title is required' })
    return
  }
  if (status !== 'draft' && status !== 'published') {
    res.status(400).json({ error: "status must be 'draft' or 'published'" })
    return
  }
  const slug = await uniqueSlug('kb_articles', title)
  const result = await run(
    'INSERT INTO kb_articles (category_id, title, slug, body, status, author_email) VALUES (?, ?, ?, ?, ?, ?)',
    [categoryId, title.trim(), slug, body, status, req.user.email],
  )
  const row = await get('SELECT * FROM kb_articles WHERE id = ?', [result.lastID])
  res.status(201).json(row)
}))

// PATCH /api/kb/articles/:id — update article (publish = set status)
router.patch('/kb/articles/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT * FROM kb_articles WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Article not found' })
    return
  }
  const { title, body, categoryId, status } = req.body
  const sets = []
  const params = []
  if (title !== undefined) {
    sets.push('title = ?'); params.push(title.trim())
    sets.push('slug = ?'); params.push(await uniqueSlug('kb_articles', title, id))
  }
  if (body !== undefined) { sets.push('body = ?'); params.push(body) }
  if (categoryId !== undefined) { sets.push('category_id = ?'); params.push(categoryId) }
  if (status !== undefined) {
    if (status !== 'draft' && status !== 'published') {
      res.status(400).json({ error: "status must be 'draft' or 'published'" })
      return
    }
    sets.push('status = ?'); params.push(status)
  }
  if (sets.length === 0) {
    res.json(existing)
    return
  }
  sets.push('updated_at = NOW()')
  params.push(id)
  await run(`UPDATE kb_articles SET ${sets.join(', ')} WHERE id = ?`, params)
  const row = await get('SELECT * FROM kb_articles WHERE id = ?', [id])
  res.json(row)
}))

// DELETE /api/kb/articles/:id — delete article
router.delete('/kb/articles/:id', asyncHandler(async (req, res) => {
  await run('DELETE FROM kb_articles WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

export default router
