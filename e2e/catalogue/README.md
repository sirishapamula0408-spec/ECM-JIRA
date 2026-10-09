# Functional test catalogue (JL-157)

Every test in the suite, one row each, with its result. Results are from the
run on 2026-10-08 against an empty database and the production build.

| Track | Catalogue | Tests | Pass | Known defect |
|---|---|---|---|---|
| A — Authentication, administration, RBAC | [track-a.md](track-a.md) | 112 | 103 | 9 |
| B — Projects, issues, planning, boards | [track-b.md](track-b.md) | 122 | 111 | 11 |
| C — Tracking, Confluence Lite, every route | [track-c.md](track-c.md) | 198 | 183 | 15 |
| Harness smoke | `e2e/*/smoke.spec.mjs` | 7 | 7 | 0 |
| **Total** | | **439** | **404** | **35** |

A known-defect test asserts the correct behaviour and is marked
`test.fail(true, 'DEFECT: …')`, so the suite stays green while the bug is open
and turns red when it is fixed — remove the marker then. Some defects are
covered by more than one test, which is why 35 tests map to 26 open tickets.

## Defects filed (projects.fosasoft.com, JIRA Lite)

| Ticket | Priority | Defect |
|---|---|---|
| JL-158 | High | Fresh install fails: database init creates indexes before their tables — **fixed in this branch** |
| JL-159 | High | Deactivated user's existing login token keeps working |
| JL-160 | High | Deleted member's existing token keeps working (as Viewer) |
| JL-161 | High | Audit-log integrity check always reports tampering |
| JL-162 | High | Bulk issue update lets a project Viewer edit issues |
| JL-163 | High | Top-bar '+ Create' button is always disabled in Jira |
| JL-164 | High | Deleting a project exposes its issues to every member |
| JL-165 | High | Sprints are not scoped to a project — one project's sprint blocks another |
| JL-166 | High | Wiki pages ignore Space roles — a Space Viewer can edit pages |
| JL-167 | High | JQL and basic search return issues from projects the user cannot access |
| JL-168 | Medium | Watcher endpoints have no project-access check |
| JL-169 | Medium | Bulk status change bypasses workflow transitions |
| JL-170 | Medium | Duplicate project key returns 500 |
| JL-171 | Medium | Adding an existing project member returns 500 |
| JL-172 | Medium | Import: unknown sprint_id passes the dry run, then the commit returns 500 |
| JL-173 | Medium | Admins opening /members or /users directly are sent to the Dashboard |
| JL-174 | Medium | /members invite says 'Invitation sent' when no email was sent |
| JL-175 | Medium | Reports return data for projects the user cannot access |
| JL-176 | Medium | Legacy wiki search returns other users' drafts and trashed pages |
| JL-177 | Medium | Activity feed attributes issue actions to the assignee, not the actor |
| JL-178 | Medium | Activity type filters (Issues, Comments, Sprints) never match |
| JL-179 | Medium | 'In-app notifications' preference switch has no effect |
| JL-180 | Medium | ~~'Create page' from a Space opens without that Space; picker shows only 5 Spaces~~ — **fixed by JL-187** |
| JL-181 | Low | Create project modal: default lead is not a valid option |
| JL-182 | Low | Sign-up password hint says 6 characters; the server requires 8 |
| JL-183 | Low | JQL 'project = KEY' returns a raw database error |
| JL-184 | Low | CFD 'Current WIP' counts Cancelled issues |
| JL-185 | Low | Four page states have no level-1 heading (JL-409/JL-416) |
