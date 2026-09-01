// JL-423 — "Worked on": resolving a team to the actors that appear in `activity`.
//
// WHY THIS IS NOT A FOREIGN KEY
// -----------------------------
// `activity.actor` is free text, and the forms that actually occur differ by
// writer. Verified against every insert site in this repo:
//
//   server/routes/issues.js  (3 sites) — writes the issue's `assignee`. That
//       column holds a member DISPLAY NAME in practice ('Sarah Johnson'), but
//       an email address also occurs, and it can be NULL/'' on an unassigned
//       issue.
//   server/routes/members.js (1 site) — writes the acting user's identifier,
//       or the literal string 'System' when there is no human actor.
//   server/seed.js           (1 site) — writes display names only
//       ('Sarah Johnson', 'Emily Chen', …), and no email anywhere.
//
// So there is no id to join on, and matching on one identifier form would
// silently drop half the rows. This is the same trap JL-417 documented for
// `members.task_count`, where GET /api/members has to match `issues.assignee`
// against the member's NAME **or** EMAIL because both forms occur in the data.
//
// The approach: resolve the team's members to a set of lower-cased identifiers
// (every name AND every email) and match `LOWER(activity.actor)` against that
// set. Lower-casing both sides is deliberate — 'sarah johnson' and
// 'Sarah Johnson' are the same person, and PostgreSQL's `=` is not.
//
// Consequence worth stating: a member whose display name collides with another
// person's would over-match. There is no column that would let us do better,
// and inventing one is outside this ticket. Under-matching (a strict FK join
// returning nothing) would be the worse failure — the feed would simply look
// empty and nobody would know why.
import { all, get } from '../db.js'

/**
 * Atlassian's team profile shows the 100 most recent actions by team members.
 * The cap is applied to the query, not trimmed after the fact.
 */
export const TEAM_FEED_MAX = 100

/**
 * The identifiers to match `activity.actor` against for one team.
 *
 * @returns {Promise<string[]|null>}
 *   `null`  — the team does not exist IN THE CALLER'S WORKSPACE (or no workspace
 *             resolved). Callers must render an empty feed: the team filter must
 *             never become a way to read another tenant's activity, which is
 *             exactly the hole JL-362 had to close on this endpoint.
 *   `[]`    — a real, visible team with no members (or no usable identifiers).
 *             Also an empty feed, but for a benign reason.
 *   `[...]` — lower-cased names and emails, de-duplicated.
 */
export async function loadTeamActorIdentifiers(teamId, workspaceId) {
  const id = Number(teamId)
  const ws = Number(workspaceId)
  if (!Number.isInteger(id) || id <= 0) return null
  if (!Number.isInteger(ws) || ws <= 0) return null

  // Tenant check FIRST. Membership is looked up only for a team the caller can
  // actually see, so a foreign teamId cannot even leak who is on it.
  const team = await get('SELECT id FROM teams WHERE id = ? AND workspace_id = ?', [id, ws])
  if (!team) return null

  const rows = await all(
    `SELECT m.name, m.email
       FROM team_members tm
       JOIN members m ON m.id = tm.member_id
      WHERE tm.team_id = ?`,
    [id],
  )

  const identifiers = new Set()
  for (const row of rows) {
    const name = String(row?.name ?? '').trim().toLowerCase()
    const email = String(row?.email ?? '').trim().toLowerCase()
    if (name) identifiers.add(name)
    if (email) identifiers.add(email)
  }
  return [...identifiers]
}

export default loadTeamActorIdentifiers
