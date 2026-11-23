/*
 * JL-488 — release monitoring.
 *
 * When a release is marked Released, every work item in it is checked:
 *   Done            -> pass
 *   any other state -> fail (it shipped while still open)
 *
 * A work item is "in" a release through the single release field
 * (issues.release_id) or a Fix Version (issue_versions type 'fix').
 *
 * The result is stored as a release_checks row, each work item gets ONE comment
 * from "Release Monitor" per release (tagged with checkMarker, so a re-check
 * never repeats it), and everyone holding the project role "Release Monitor"
 * gets one summary notification (in-app + email per their preferences).
 *
 * Comments are inserted directly rather than through POST /comments, so they
 * do not fan out a watcher email per work item: the monitors get the summary,
 * and the trail stays on each work item.
 */
import { all, get, run } from '../db.js'
import { createNotification } from '../routes/notifications.js'

export const RELEASE_MONITOR_ROLE = 'Release Monitor'
export const RELEASE_MONITOR_AUTHOR = 'Release Monitor'
export const DONE_STATUS = 'Done'
export const checkMarker = (releaseId) => `[release-check:R${releaseId}]`

export async function releaseWorkItems(releaseId) {
  return all(
    `SELECT DISTINCT i.id, i.issue_key, i.title, i.status
       FROM issues i
       LEFT JOIN issue_versions iv ON iv.issue_id = i.id AND iv.type = 'fix' AND iv.version_id = ?
      WHERE i.release_id = ? OR iv.version_id IS NOT NULL
      ORDER BY i.id ASC`,
    [releaseId, releaseId],
  )
}

export function mapCheck(row) {
  if (!row) return null
  const failed = typeof row.failed === 'string' ? JSON.parse(row.failed) : (row.failed || [])
  return {
    id: row.id,
    releaseId: row.release_id,
    checkedAt: row.checked_at,
    checkedBy: row.checked_by,
    total: Number(row.total),
    passed: Number(row.passed),
    failed,
    ok: failed.length === 0,
  }
}

export async function latestReleaseCheck(releaseId) {
  return mapCheck(await get(
    'SELECT * FROM release_checks WHERE release_id = ? ORDER BY checked_at DESC, id DESC LIMIT 1',
    [releaseId],
  ))
}

/**
 * Check one release. Returns the stored check, or null if the release is gone.
 * `actorEmail` is who released it (or asked for the re-check); it is recorded
 * and, like every notification, they are not notified about their own action.
 */
export async function runReleaseCheck(releaseId, { actorEmail = null } = {}) {
  const release = await get(
    `SELECT r.id, r.name, r.project_id, r.release_date, p.name AS project_name
       FROM releases r JOIN projects p ON p.id = r.project_id
      WHERE r.id = ?`,
    [releaseId],
  )
  if (!release) return null

  const items = await releaseWorkItems(releaseId)
  const failed = []
  const tag = checkMarker(releaseId)
  for (const item of items) {
    const pass = item.status === DONE_STATUS
    if (!pass) failed.push({ id: item.id, key: item.issue_key, title: item.title, status: item.status })
    // One comment per release AND outcome: re-checking never repeats itself, but
    // a work item that failed and was then closed gets its PASS on the record.
    const prefix = `${tag} Release check: ${pass ? 'shipped' : 'FAILED'}`
    const already = await get(
      'SELECT id FROM comments WHERE issue_id = ? AND author = ? AND text LIKE ? LIMIT 1',
      [item.id, RELEASE_MONITOR_AUTHOR, `${prefix}%`],
    )
    if (already) continue
    const text = pass
      ? `${tag} Release check: shipped in ${release.name}. Status is Done. PASS.`
      : `${tag} Release check: FAILED. ${release.name} is released, but this work item is still "${item.status}". Close it or move it to a later release.`
    await run('INSERT INTO comments (issue_id, author, text) VALUES (?, ?, ?)', [item.id, RELEASE_MONITOR_AUTHOR, text])
  }

  const passed = items.length - failed.length
  const created = await run(
    'INSERT INTO release_checks (release_id, checked_by, total, passed, failed) VALUES (?, ?, ?, ?, ?::jsonb)',
    [releaseId, actorEmail, items.length, passed, JSON.stringify(failed)],
  )
  const check = mapCheck(await get('SELECT * FROM release_checks WHERE id = ?', [created.lastID]))

  const monitors = await all(
    `SELECT m.email FROM project_members pm JOIN members m ON m.id = pm.member_id
      WHERE pm.project_id = ? AND pm.role = ? AND m.status = 'Active'`,
    [release.project_id, RELEASE_MONITOR_ROLE],
  )
  const verdict = items.length === 0
    ? 'no work items'
    : failed.length === 0 ? `all ${items.length} work items Done` : `${failed.length} of ${items.length} work items not Done`
  const title = `Release check ${failed.length ? 'FAILED' : 'passed'}: ${release.name} (${release.project_name}) - ${verdict}`
  const lines = failed.map((f) => `- ${f.key} ${f.title} (${f.status})`)
  const message = failed.length
    ? `${release.name} was released with work items that are not Done:\n${lines.join('\n')}`
    : items.length ? `Every work item in ${release.name} is Done.` : `${release.name} was released with no work items in it.`
  for (const { email } of monitors) {
    await createNotification({
      recipientEmail: email,
      type: 'release_check',
      title,
      message,
      projectId: release.project_id,
      actorEmail,
      link: `/projects/${release.project_id}/releases`,
    })
  }
  return check
}
