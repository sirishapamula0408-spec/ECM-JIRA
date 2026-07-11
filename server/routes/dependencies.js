import { Router } from 'express'
import { all } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

// The final ("done") status — issues in this status no longer block anything.
export const DONE_STATUS = 'Done'

// Only the blocking relationship pair is relevant for dependency flags.
// Both link types are stored on the source row; normalize to a directed
// "blocker -> blocked" edge:
//   'blocks'        → source blocks target   (blocker=source, blocked=target)
//   'is blocked by' → source blocked by target (blocker=target, blocked=source)
function normalizeEdge(link) {
  const type = link.link_type
  const source = link.source_issue_id
  const target = link.target_issue_id
  if (type === 'blocks') return { blockerId: source, blockedId: target }
  if (type === 'is blocked by') return { blockerId: target, blockedId: source }
  return null
}

/**
 * Pure, db-free dependency graph builder — UNIT TESTABLE in isolation.
 *
 * @param {Array<{id:number, key?:string, title?:string, status?:string, issueType?:string}>} issues
 * @param {Array<{source_issue_id:number, target_issue_id:number, link_type:string}>} links
 * @param {{doneStatus?:string}} [options]
 * @returns {{issues:Array, edges:Array, cycles:Array<Array<string>>}}
 *   - issues: each input issue augmented with `isBlocked`, `blockedBy` (keys), `blocking` (keys)
 *   - edges: directed blocker→blocked edges as { from, to, fromId, toId }
 *   - cycles: arrays of issue keys that form a dependency cycle
 */
export function buildDependencyGraph(issues, links, options = {}) {
  const doneStatus = options.doneStatus || DONE_STATUS
  const byId = new Map()
  for (const issue of issues || []) {
    byId.set(issue.id, issue)
  }

  const keyOf = (id) => {
    const issue = byId.get(id)
    return issue ? (issue.key ?? String(id)) : String(id)
  }
  const isDone = (id) => {
    const issue = byId.get(id)
    return !!issue && issue.status === doneStatus
  }

  // Deduplicate edges (a 'blocks' and inverse 'is blocked by' can describe the same pair)
  const edgeSet = new Set()
  const edges = []
  // Adjacency for cycle detection: blocker -> [blocked...]
  const adjacency = new Map()
  // Per-issue relationship accumulators
  const blockedBy = new Map() // blockedId -> Set(blockerId)
  const blocking = new Map() // blockerId -> Set(blockedId)

  for (const link of links || []) {
    const edge = normalizeEdge(link)
    if (!edge) continue
    const { blockerId, blockedId } = edge
    if (blockerId === blockedId) continue // ignore self-links
    // Only consider edges where both endpoints are known issues
    if (!byId.has(blockerId) || !byId.has(blockedId)) continue

    const dedupeKey = `${blockerId}->${blockedId}`
    if (edgeSet.has(dedupeKey)) continue
    edgeSet.add(dedupeKey)

    edges.push({ from: keyOf(blockerId), to: keyOf(blockedId), fromId: blockerId, toId: blockedId })

    if (!adjacency.has(blockerId)) adjacency.set(blockerId, [])
    adjacency.get(blockerId).push(blockedId)

    if (!blockedBy.has(blockedId)) blockedBy.set(blockedId, new Set())
    blockedBy.get(blockedId).add(blockerId)

    if (!blocking.has(blockerId)) blocking.set(blockerId, new Set())
    blocking.get(blockerId).add(blockedId)
  }

  const annotated = (issues || []).map((issue) => {
    const blockers = blockedBy.get(issue.id) || new Set()
    const blocks = blocking.get(issue.id) || new Set()
    // isBlocked only when at least one blocker is NOT Done.
    let isBlocked = false
    for (const blockerId of blockers) {
      if (!isDone(blockerId)) { isBlocked = true; break }
    }
    return {
      ...issue,
      isBlocked,
      blockedBy: [...blockers].map(keyOf),
      blocking: [...blocks].map(keyOf),
    }
  })

  const cycles = detectCycles(byId, adjacency, keyOf)

  return { issues: annotated, edges, cycles }
}

// Tarjan strongly-connected components — any component with >1 node (or a
// self-loop, already excluded) represents a dependency cycle.
function detectCycles(byId, adjacency, keyOf) {
  let index = 0
  const stack = []
  const onStack = new Set()
  const indices = new Map()
  const lowlink = new Map()
  const cycles = []

  const nodes = [...byId.keys()]

  const strongconnect = (v) => {
    indices.set(v, index)
    lowlink.set(v, index)
    index += 1
    stack.push(v)
    onStack.add(v)

    for (const w of adjacency.get(v) || []) {
      if (!indices.has(w)) {
        strongconnect(w)
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)))
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)))
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const component = []
      let w
      do {
        w = stack.pop()
        onStack.delete(w)
        component.push(w)
      } while (w !== v)
      if (component.length > 1) {
        cycles.push(component.map(keyOf))
      }
    }
  }

  for (const v of nodes) {
    if (!indices.has(v)) strongconnect(v)
  }
  return cycles
}

// GET /api/projects/:id/dependencies
router.get('/projects/:id/dependencies', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id)

  const issues = await all(
    `SELECT id, issue_key, title, status, issue_type
     FROM issues
     WHERE project_id = ?
     ORDER BY id ASC`,
    [projectId],
  )
  const mapped = issues.map((r) => ({
    id: r.id,
    key: r.issue_key,
    title: r.title,
    status: r.status,
    issueType: r.issue_type,
  }))

  const links = await all(
    `SELECT il.source_issue_id, il.target_issue_id, il.link_type
     FROM issue_links il
     JOIN issues s ON s.id = il.source_issue_id
     JOIN issues t ON t.id = il.target_issue_id
     WHERE s.project_id = ? AND t.project_id = ?
       AND il.link_type IN ('blocks', 'is blocked by')`,
    [projectId, projectId],
  )

  const graph = buildDependencyGraph(mapped, links)
  const blockedCount = graph.issues.filter((i) => i.isBlocked).length

  res.json({
    issues: graph.issues,
    edges: graph.edges,
    cycles: graph.cycles,
    summary: {
      totalIssues: graph.issues.length,
      blockedCount,
      edgeCount: graph.edges.length,
      cycleCount: graph.cycles.length,
    },
  })
}))

export default router
