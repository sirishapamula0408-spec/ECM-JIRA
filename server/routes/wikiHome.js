import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { pageVisibilityFilter, visibleSpaceIds } from '../utils/wikiVisibility.js'
// JL-112: the snippet that shows why a page matched.
import { buildExcerpt } from '../utils/searchExcerpt.js'

/*
 * JL-152 — the Confluence Lite home page's data.
 *
 * ── Why one router, and why it owns recently_viewed and favorites ───────────
 *
 * The home page is assembled from three sources the brief names (recently
 * viewed, starred, Spaces) plus an activity feed. Two of those sources did not
 * exist before this ticket — recently_viewed (FR-FV-02 / JL-129) and favorites
 * (FR-FV-01 / JL-128) — and both exist ONLY to answer home-page questions.
 * Their read, their write and the permission filter that guards them therefore
 * live together here, rather than being scattered into wiki.js and spaces.js
 * where the filter would have to be restated twice more.
 *
 * ── What this no longer returns ─────────────────────────────────────────────
 *
 * JL-154 removed "Pick up where you left off" from the page, so the payload
 * no longer carries `pickUp` and the per-user "pages you created" query that
 * built it is gone. Computing it for a client that ignores it would be an
 * extra query on every home load. Recently-viewed still feeds the sidebar's
 * Recent section.
 *
 * ── Round trips ─────────────────────────────────────────────────────────────
 *
 * The brief asks for as few round trips as practical, and separately that a
 * slow feed must not block the card grid. Those pull in opposite directions,
 * so this settles at exactly two:
 *
 *   GET /api/wiki-home        everything the sidebar and the card grid need
 *   GET /api/wiki-home/feed   the feed alone, paginated
 *
 * One request per card — the thing the brief rules out — would have been six
 * to thirty. Folding the feed into the first would have made the grid wait for
 * it. Two is the floor that satisfies both constraints.
 *
 * ── Permissions ─────────────────────────────────────────────────────────────
 *
 * Every query below is filtered SERVER-SIDE through pageVisibilityFilter or
 * visibleSpaceIds (server/utils/wikiVisibility.js). Nothing here decides
 * visibility for itself — a second opinion is how a leak gets in, because the
 * query that forgets does not fail, it just returns more.
 */

const router = Router()

/** Sidebar sections show 5 and offer "Show more". */
const SIDEBAR_LIMIT = 5
const FEED_PAGE = 20
const FEED_MAX = 50

const FEED_TABS = ['following', 'popular']
const FEED_SORTS = ['relevant', 'recent']

/** Columns a page row carries into any home-page response. */
const CARD_COLUMNS = `
  w.id, w.title, w.space_id, w.project_id, w.status,
  w.created_by, w.created_at, w.updated_at,
  s.name AS space_name, s.key AS space_key`

/**
 * Pages the caller may see, as a ready-made FROM + WHERE.
 * `extra` is ANDed on; `extraParams` follow the visibility params.
 */
async function visiblePages(user, extra = '', extraParams = []) {
  const vis = await pageVisibilityFilter(user, 'w')
  return {
    from: 'FROM wiki_pages w LEFT JOIN spaces s ON s.id = w.space_id',
    where: `WHERE ${vis.clause}${extra ? ` AND ${extra}` : ''}`,
    params: [...vis.params, ...extraParams],
  }
}

/* ================================================================
   GET /api/wiki-home — sidebar + "Pick up where you left off"
   ================================================================ */
router.get('/', asyncHandler(async (req, res) => {
  const user = req.user
  const email = String(user?.email || '')

  /*
   * Each list asks for one more row than it shows. That single extra row is
   * what tells the client whether to render "Show more", without a COUNT(*)
   * over the same filtered set — which would double the query count for a
   * boolean.
   */
  const probe = SIDEBAR_LIMIT + 1

  const viewedQ = await visiblePages(user)
  const viewed = await all(
    `SELECT ${CARD_COLUMNS}, rv.viewed_at
       ${viewedQ.from}
       JOIN recently_viewed rv ON rv.page_id = w.id AND LOWER(rv.user_email) = LOWER(?)
       ${viewedQ.where}
      ORDER BY rv.viewed_at DESC
      LIMIT ?`,
    [email, ...viewedQ.params, probe],
  )

  const starredQ = await visiblePages(user)
  const starredPages = await all(
    `SELECT ${CARD_COLUMNS}, f.created_at AS starred_at
       ${starredQ.from}
       JOIN favorites f ON f.target_id = w.id AND f.target_type = 'page'
        AND LOWER(f.user_email) = LOWER(?)
       ${starredQ.where}
      ORDER BY f.created_at DESC
      LIMIT ?`,
    [email, ...starredQ.params, probe],
  )

  const spaceIds = await visibleSpaceIds(user)
  const spaceMarks = [...spaceIds].map(() => '?').join(', ')

  const spaces = spaceIds.size
    ? await all(
      `SELECT id, key, name, archived FROM spaces
        WHERE archived = FALSE AND id IN (${spaceMarks})
        ORDER BY name ASC LIMIT ?`,
      [...spaceIds, probe],
    )
    : []

  const starredSpaces = spaceIds.size
    ? await all(
      `SELECT sp.id, sp.key, sp.name, sp.archived, f.created_at AS starred_at
         FROM favorites f
         JOIN spaces sp ON sp.id = f.target_id
        WHERE f.target_type = 'space' AND LOWER(f.user_email) = LOWER(?)
          AND sp.id IN (${spaceMarks})
        ORDER BY sp.name ASC`,
      [email, ...spaceIds],
    )
    : []

  res.json({
    recent: viewed.slice(0, SIDEBAR_LIMIT),
    recentHasMore: viewed.length > SIDEBAR_LIMIT,
    starredPages: starredPages.slice(0, SIDEBAR_LIMIT),
    starredPagesHasMore: starredPages.length > SIDEBAR_LIMIT,
    spaces: spaces.slice(0, SIDEBAR_LIMIT),
    spacesHasMore: spaces.length > SIDEBAR_LIMIT,
    starredSpaces,
  })
}))

/* ================================================================
   JL-110→114 — page search
   ================================================================ */

/** Result page size, and the ceiling a caller can ask for. */
const SEARCH_PAGE = 20
const SEARCH_MAX = 50

/*
 * Searching from Confluence Lite must not run a JQL query, and the existing
 * /api/wiki/search demands a projectId — it was built for the per-project wiki
 * tab and cannot answer "search everything I can read".
 *
 * JL-111 is not a feature of this endpoint so much as a property of it: the
 * SAME pageVisibilityFilter every other read here uses. A page the caller
 * cannot see is not findable by guessing a word in it, and the filter is not
 * restated — restating it is how the two would drift.
 *
 * JL-114: a page also matches on the NAME of the Space it lives in, so
 * searching "engineering" finds the Engineering runbooks even when no page
 * says the word. The Space name comes back on every row so a result is
 * identifiable without opening it.
 *
 * JL-113: ?spaceId= narrows to one Space. Applied on top of the visibility
 * filter, never instead of it — asking for a Space you cannot see returns
 * nothing rather than its contents.
 */
router.get('/search', asyncHandler(async (req, res) => {
  const term = String(req.query.q || '').trim()
  if (!term) {
    res.json({ items: [], total: 0, term: '', hasMore: false, nextCursor: null })
    return
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || SEARCH_PAGE, 1), SEARCH_MAX)
  const cursor = Math.max(Number(req.query.cursor) || 0, 0)
  const spaceId = req.query.spaceId ? Number(req.query.spaceId) : null

  const vis = await pageVisibilityFilter(req.user, 'w')
  const like = `%${term}%`

  // JL-110 title + content, JL-114 Space name.
  const match = '(w.title ILIKE ? OR w.content ILIKE ? OR s.name ILIKE ? OR s.key ILIKE ?)'
  const matchParams = [like, like, like, like]

  /*
   * JL-113. The requested Space is intersected with what the caller may see
   * rather than trusted: a spaceId they have no access to must return an empty
   * result, not that Space's pages.
   */
  let spaceClause = ''
  const spaceParams = []
  if (spaceId) {
    const visibleSpaces = await visibleSpaceIds(req.user)
    if (!visibleSpaces.has(spaceId)) {
      res.json({ items: [], total: 0, term, hasMore: false, nextCursor: null })
      return
    }
    spaceClause = ' AND w.space_id = ?'
    spaceParams.push(spaceId)
  }

  const from = 'FROM wiki_pages w LEFT JOIN spaces s ON s.id = w.space_id'
  const where = `WHERE ${vis.clause} AND ${match}${spaceClause}`
  const params = [...vis.params, ...matchParams, ...spaceParams]

  /*
   * A total, so the page can say "24 results" rather than "20 results" when
   * there are more. One extra COUNT against the same filter — cheaper than
   * paging blind, and the number is the first thing a searcher reads.
   */
  const counted = await get(`SELECT COUNT(*)::int AS n ${from} ${where}`, params)
  const total = Number(counted?.n || 0)

  const rows = await all(
    `SELECT ${CARD_COLUMNS}, w.content
       ${from} ${where}
      ORDER BY
        /* A title hit outranks a body hit: someone searching "runbook" wants
           the page called Runbook first, not the one that mentions it. */
        CASE WHEN w.title ILIKE ? THEN 0 ELSE 1 END,
        w.updated_at DESC
      LIMIT ? OFFSET ?`,
    [...params, like, limit, cursor],
  )

  /*
   * JL-112. The excerpt is text plus match OFFSETS, never pre-marked HTML —
   * building markup out of stored content outside sanitizeHtml is the thing
   * JL-359 removed. `content` is dropped from the response: the excerpt is
   * what a result list needs, and shipping whole pages for a search would be
   * both slower and a wider disclosure than the snippet.
   */
  const items = rows.map(({ content, ...row }) => ({
    ...row,
    excerpt: buildExcerpt(content, term),
  }))

  const hasMore = cursor + items.length < total
  res.json({
    items,
    total,
    term,
    spaceId,
    hasMore,
    nextCursor: hasMore ? cursor + limit : null,
  })
}))

/* ================================================================
   GET /api/wiki-home/list?kind=recent|starred — the "Show more" target
   ================================================================ */

/*
 * The sidebar shows five of each and offers "Show more". That link has to go
 * somewhere real — a nav item pointing at a route that does not resolve is a
 * dead end shipped on purpose — so this is the paginated form of the same two
 * lists the home payload truncates.
 *
 * Same visibility filter as everything else here. Nothing widens just because
 * the caller asked for a longer list.
 */
router.get('/list', asyncHandler(async (req, res) => {
  const user = req.user
  const email = String(user?.email || '')
  /*
   * JL-130 adds 'modified': what changed recently, optionally within one
   * Space. Unlike 'recent' (what I looked at) and 'starred' (what I kept),
   * this one is about the SPACE rather than about me — which is why it takes
   * a spaceId and the other two do not.
   */
  const KINDS = ['recent', 'starred', 'modified']
  const kind = KINDS.includes(String(req.query.kind)) ? String(req.query.kind) : 'recent'
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100)
  const cursor = Math.max(Number(req.query.cursor) || 0, 0)

  /*
   * 'modified' needs no join and no per-user parameter — it is a property of
   * the Space, not of the reader — so it is built separately rather than
   * bent through the same JOIN with a dummy condition.
   */
  let rows
  if (kind === 'modified') {
    const spaceId = req.query.spaceId ? Number(req.query.spaceId) : null
    // Narrowing is applied ON TOP of the visibility filter, never instead:
    // a Space the caller cannot see must yield nothing, not its pages.
    if (spaceId) {
      const visibleSpaces = await visibleSpaceIds(user)
      if (!visibleSpaces.has(spaceId)) {
        res.json({ kind, items: [], hasMore: false, nextCursor: null })
        return
      }
    }
    const q = await visiblePages(user, spaceId ? 'w.space_id = ?' : '', spaceId ? [spaceId] : [])
    rows = await all(
      `SELECT ${CARD_COLUMNS}, w.updated_at AS modified_at
         ${q.from} ${q.where}
        ORDER BY w.updated_at DESC
        LIMIT ? OFFSET ?`,
      [...q.params, limit + 1, cursor],
    )
  } else {
    const q = await visiblePages(user)
    const join = kind === 'starred'
      ? `JOIN favorites f ON f.target_id = w.id AND f.target_type = 'page'
          AND LOWER(f.user_email) = LOWER(?)`
      : 'JOIN recently_viewed rv ON rv.page_id = w.id AND LOWER(rv.user_email) = LOWER(?)'
    const order = kind === 'starred' ? 'ORDER BY f.created_at DESC' : 'ORDER BY rv.viewed_at DESC'
    const stamp = kind === 'starred' ? 'f.created_at AS starred_at' : 'rv.viewed_at'

    rows = await all(
      `SELECT ${CARD_COLUMNS}, ${stamp}
         ${q.from}
         ${join}
         ${q.where}
        ${order}
        LIMIT ? OFFSET ?`,
      [email, ...q.params, limit + 1, cursor],
    )
  }

  const items = rows.slice(0, limit)
  const hasMore = rows.length > limit
  res.json({ kind, items, hasMore, nextCursor: hasMore ? cursor + limit : null })
}))

/* ================================================================
   GET /api/wiki-home/feed — "Discover what's happening"
   ================================================================ */

/*
 * Three sources: a page created, a page edited (a wiki_page_versions row after
 * the first), and — since JL-115 — a comment added.
 *
 * The comment arm is the one JL-152 deliberately left out because the table
 * did not exist yet, and it went in exactly as predicted: one more arm of the
 * same shape, no change to the surrounding query. The arms are kept identical
 * on purpose so a fourth source costs the same.
 */
router.get('/feed', asyncHandler(async (req, res) => {
  const user = req.user
  const email = String(user?.email || '')

  const tab = FEED_TABS.includes(String(req.query.tab)) ? String(req.query.tab) : 'following'
  const sort = FEED_SORTS.includes(String(req.query.sort)) ? String(req.query.sort) : 'relevant'
  const limit = Math.min(Math.max(Number(req.query.limit) || FEED_PAGE, 1), FEED_MAX)
  const cursor = Math.max(Number(req.query.cursor) || 0, 0)

  const vis = await pageVisibilityFilter(user, 'w')

  /*
   * "Following" is activity on pages this person has a stake in: a Space they
   * are an explicit member of, a page they starred, or a page they wrote.
   * That is a definition rather than a guess, and it is why the tab can
   * legitimately be empty for a new user — the empty state the brief asks for.
   *
   * "Popular" drops the relationship requirement and ranks by how many
   * distinct people have read the page.
   */
  const followingClause = `(
       w.space_id IN (SELECT space_id FROM space_members WHERE LOWER(user_email) = LOWER(?))
    OR w.id IN (SELECT target_id FROM favorites WHERE target_type = 'page' AND LOWER(user_email) = LOWER(?))
    OR LOWER(w.created_by) = LOWER(?)
  )`
  const tabParams = tab === 'following' ? [email, email, email] : []
  const tabWhere = tab === 'following' ? ` AND ${followingClause}` : ''

  /*
   * "Most recent" is plain recency. "Most relevant" puts what the reader has a
   * stake in first — starred, then widely read — and only then falls back to
   * recency, so a relevant older page is not buried under noise from a busy
   * Space.
   */
  const orderBy = sort === 'recent'
    ? 'ORDER BY at DESC'
    : 'ORDER BY is_starred DESC, viewers DESC, at DESC'

  const starredExpr = `(EXISTS (SELECT 1 FROM favorites f
      WHERE f.target_type = 'page' AND f.target_id = w.id AND LOWER(f.user_email) = LOWER(?)))`
  const viewersExpr = '(SELECT COUNT(*)::int FROM recently_viewed rv WHERE rv.page_id = w.id)'

  // One row more than asked for, so hasMore needs no second COUNT query.
  const rows = await all(
    `SELECT * FROM (
        SELECT 'page_created' AS kind, w.id AS page_id, w.title, w.space_id,
               s.name AS space_name, s.key AS space_key,
               w.created_by AS actor, w.created_at AS at,
               ${starredExpr} AS is_starred, ${viewersExpr} AS viewers
          FROM wiki_pages w LEFT JOIN spaces s ON s.id = w.space_id
         WHERE ${vis.clause}${tabWhere}
        UNION ALL
        SELECT 'page_updated' AS kind, w.id AS page_id, w.title, w.space_id,
               s.name AS space_name, s.key AS space_key,
               v.edited_by AS actor, v.created_at AS at,
               ${starredExpr} AS is_starred, ${viewersExpr} AS viewers
          FROM wiki_page_versions v
          JOIN wiki_pages w ON w.id = v.page_id
          LEFT JOIN spaces s ON s.id = w.space_id
         WHERE v.version_number > 1 AND ${vis.clause}${tabWhere}
        UNION ALL
        SELECT 'comment_added' AS kind, w.id AS page_id, w.title, w.space_id,
               s.name AS space_name, s.key AS space_key,
               c.author AS actor, c.created_at AS at,
               ${starredExpr} AS is_starred, ${viewersExpr} AS viewers
          FROM wiki_page_comments c
          JOIN wiki_pages w ON w.id = c.page_id
          LEFT JOIN spaces s ON s.id = w.space_id
         WHERE ${vis.clause}${tabWhere}
     ) feed
     ${orderBy}
     LIMIT ? OFFSET ?`,
    [
      // One set per UNION arm, in the order the arms appear. A missing set
      // shifts every placeholder after it, which the db.js ?->$n conversion
      // would happily accept and answer wrongly.
      email, ...vis.params, ...tabParams,
      email, ...vis.params, ...tabParams,
      email, ...vis.params, ...tabParams,
      limit + 1, cursor,
    ],
  )

  const items = rows.slice(0, limit)
  const hasMore = rows.length > limit
  res.json({ items, hasMore, nextCursor: hasMore ? cursor + limit : null, tab, sort })
}))

/* ================================================================
   Writes — recording a view, and starring
   ================================================================ */

/*
 * POST /api/wiki-home/views/:pageId — record that the caller read a page.
 *
 * Upsert, not insert: one row per (user, page) that moves forward in time, so
 * the table stays proportional to pages-read rather than to reads.
 *
 * It refuses to record a view of a page the caller cannot see. Without that
 * check the history itself becomes an oracle: POST an id, then read your own
 * Recent list back to learn whether the page exists.
 */
router.post('/views/:pageId', asyncHandler(async (req, res) => {
  const pageId = Number(req.params.pageId)
  if (!Number.isInteger(pageId) || pageId <= 0) {
    res.status(400).json({ error: 'A numeric page id is required' })
    return
  }
  const vis = await pageVisibilityFilter(req.user, 'w')
  const page = await get(
    `SELECT w.id FROM wiki_pages w WHERE w.id = ? AND ${vis.clause}`,
    [pageId, ...vis.params],
  )
  if (!page) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }
  await run(
    `INSERT INTO recently_viewed (user_email, page_id, viewed_at) VALUES (?, ?, NOW())
     ON CONFLICT (user_email, page_id) DO UPDATE SET viewed_at = NOW()
     RETURNING id`,
    [req.user.email, pageId],
  )
  res.status(201).json({ success: true })
}))

const FAVORITE_TYPES = ['page', 'space']

/** Can the caller see this favourite target? The same filters as every read. */
async function canFavorite(user, targetType, targetId) {
  if (targetType === 'space') {
    const ids = await visibleSpaceIds(user)
    return ids.has(targetId)
  }
  const vis = await pageVisibilityFilter(user, 'w')
  const row = await get(
    `SELECT w.id FROM wiki_pages w WHERE w.id = ? AND ${vis.clause}`,
    [targetId, ...vis.params],
  )
  return Boolean(row)
}

router.post('/favorites', asyncHandler(async (req, res) => {
  const targetType = String(req.body?.targetType || '')
  const targetId = Number(req.body?.targetId)
  if (!FAVORITE_TYPES.includes(targetType) || !Number.isInteger(targetId) || targetId <= 0) {
    res.status(400).json({ error: `targetType must be one of: ${FAVORITE_TYPES.join(', ')}, with a numeric targetId` })
    return
  }
  if (!await canFavorite(req.user, targetType, targetId)) {
    // 404, not 403: starring must not confirm that something hidden exists.
    res.status(404).json({ error: 'Not found' })
    return
  }
  await run(
    `INSERT INTO favorites (user_email, target_type, target_id) VALUES (?, ?, ?)
     ON CONFLICT (user_email, target_type, target_id) DO NOTHING
     RETURNING id`,
    [req.user.email, targetType, targetId],
  )
  res.status(201).json({ success: true, favorited: true })
}))

router.delete('/favorites/:targetType/:targetId', asyncHandler(async (req, res) => {
  const targetType = String(req.params.targetType)
  const targetId = Number(req.params.targetId)
  if (!FAVORITE_TYPES.includes(targetType) || !Number.isInteger(targetId)) {
    res.status(400).json({ error: `targetType must be one of: ${FAVORITE_TYPES.join(', ')}` })
    return
  }
  /*
   * Unstarring needs no visibility check: it only ever removes the caller's
   * own row. Gating it would strand a star on something that later became
   * invisible, with no way to clear it.
   */
  await run(
    'DELETE FROM favorites WHERE LOWER(user_email) = LOWER(?) AND target_type = ? AND target_id = ?',
    [req.user.email, targetType, targetId],
  )
  res.json({ success: true, favorited: false })
}))

export default router
