# JL-157 Track C — test-case catalogue

Tracking (dashboard, reports, filters/JQL, activity, notifications), Confluence Lite
(spaces, pages, versions, comments, attachments, templates, search, documents) and a
route-by-route smoke check of every route in `src/App.jsx`.

Files: `e2e/api/tracking.spec.mjs`, `e2e/api/confluence.spec.mjs`, `e2e/ui/tracking.spec.mjs`,
`e2e/ui/confluence.spec.mjs`, `e2e/ui/routes.spec.mjs` (helpers: `e2e/support/track-c.mjs`).

A **Defect** row is a test that asserts the intended behaviour and is marked
`test.fail(...)`: it is expected to fail until the app is fixed, and will turn the
suite red (as an unexpected pass) the day the fix lands, so the annotation can be removed.

| ID | Area | Test case | Layer (API/UI) | Role | Result |
|----|------|-----------|----------------|------|--------|
| C-001 | Dashboard | GET /api/dashboard returns metrics, activities and team | API | Owner | Pass |
| C-002 | Dashboard | dashboard total grows when an issue is created | API | Owner | Pass |
| C-003 | Dashboard | gadget catalog lists the six gadget types | API | Owner | Pass |
| C-004 | Dashboard | issues_by_status gadget counts every status in the project, incl. In Testing and Cancelled | API | Owner | Pass |
| C-005 | Dashboard | issue_count gadget honours a status filter | API | Owner | Pass |
| C-006 | Dashboard | filter_results gadget lists the project issues by key | API | Owner | Pass |
| C-007 | Dashboard | unknown gadget type is rejected with 400 | API | Owner | Pass |
| C-008 | Dashboard | gadgets do not reveal a project the caller is not a member of | API | Owner + Member | Pass |
| C-009 | Reports | project report reflects completion and priority mix | API | Owner | Pass |
| C-010 | Reports | CFD bands cover every workflow status and count today's issues in each | API | Owner | Pass |
| C-011 | Reports | CFD current WIP excludes terminal statuses (Done and Cancelled) and Backlog | API | Owner | Defect: CFD currentWip counts Cancelled issues as work in progress |
| C-012 | Reports | created-vs-resolved counts created and resolved issues for the project | API | Owner | Pass |
| C-013 | Reports | CFD CSV export is a text/csv download with a column per status | API | Owner | Pass |
| C-014 | Reports | burndown requires a sprintId | API | Owner | Pass |
| C-015 | Reports | reports do not disclose a project the caller cannot access | API | Owner + Member | Defect: /api/reports?projectId= is not scoped to the caller's projects |
| C-016 | Filters | create a filter, then it is listed as owned by the creator | API | Owner | Pass |
| C-017 | Filters | a filter needs a name | API | Owner | Pass |
| C-018 | Filters | invalid visibility is rejected | API | Owner | Pass |
| C-019 | Filters | owner can rename and star a filter | API | Owner + Member | Pass |
| C-020 | Filters | a private filter is hidden from, and read-only to, other users | API | Owner + Member | Pass |
| C-021 | Filters | a shared filter is visible to others and can be favourited by them | API | Owner + Member | Pass |
| C-022 | Filters | delete a filter; a second delete is 404 | API | Owner | Pass |
| C-023 | Filters | basic search by project + status returns the matching issue | API | Owner | Pass |
| C-024 | Filters / JQL | a valid query by key returns exactly that issue | API | Owner | Pass |
| C-025 | Filters / JQL | project + status clauses combine with AND | API | Owner | Pass |
| C-026 | Filters / JQL | IN and ORDER BY work together | API | Owner | Pass |
| C-027 | Filters / JQL | an unknown field is a 400 with a helpful message | API | Owner | Pass |
| C-028 | Filters / JQL | an unparseable clause is a 400 | API | Owner | Pass |
| C-029 | Filters / JQL | an empty query is a 400 | API | Owner | Pass |
| C-030 | Filters / JQL | project = <KEY> does not surface a raw database error | API | Owner | Defect: JQL "project = KEY" leaks a PostgreSQL integer-cast error instead of resolving the key |
| C-031 | Filters / JQL | JQL results are scoped to projects the caller can access | API | Owner + Member | Defect: /api/filters/jql returns issues from projects the caller is not a member of |
| C-032 | Activity | response carries paging metadata | API | Owner | Pass |
| C-033 | Activity | creating and transitioning issues writes project-attributed rows | API | Owner | Pass |
| C-034 | Activity | the actor is the person who acted, not the assignee | API | Owner | Defect: activity rows record the issue assignee as the actor, not the acting user |
| C-035 | Activity | type filter "issue" returns issue activity | API | Owner | Defect: issue activity is stored as activity_type "general", so the Issues type filter is always empty |
| C-036 | Activity | actor filter returns only that actor's rows | API | Owner | Pass |
| C-037 | Activity | offset pagination returns disjoint consecutive pages | API | Owner | Pass |
| C-038 | Activity | cursor pagination continues after nextCursor | API | Owner | Pass |
| C-039 | Activity | limit is capped at 100 | API | Owner | Pass |
| C-040 | Activity | a member outside the project cannot see its activity | API | Owner + Member | Pass |
| C-041 | Notifications | an @mention in a comment notifies the mentioned user | API | Owner + new Member | Pass |
| C-042 | Notifications | a comment on a watched issue notifies the watcher | API | Owner + new Member | Pass |
| C-043 | Notifications | nobody is notified of their own @mention | API | Owner + new Member | Pass |
| C-044 | Notifications | mark one notification read lowers the unread count | API | Owner + new Member | Pass |
| C-045 | Notifications | another user's notification cannot be marked read or deleted (404) | API | Owner + new Member | Pass |
| C-046 | Notifications | mark all read clears the unread count; unread=true then lists none | API | Owner + new Member | Pass |
| C-047 | Notifications | dismiss one notification and clear the read ones | API | Owner + new Member | Pass |
| C-048 | Notifications | preferences default, save, and reject an invalid digest | API | Owner + new Member | Pass |
| C-049 | Notifications | turning in-app notifications off stops new in-app notifications | API | Owner + new Member | Defect: the "In-app notifications" preference is saved but never consulted; notifications are still created |
| C-050 | Dashboard | dashboard renders its default gadgets, and the project filter scopes Filter Results | UI | Owner | Pass |
| C-051 | Reports | project reports page renders stat cards and a CFD with every status band | UI | Owner | Pass |
| C-052 | Filters | create a saved filter from a basic search, then run it from My Filters | UI | Owner | Pass |
| C-053 | Filters | JQL search returns the matching issue, and an invalid query shows the server error | UI | Owner | Pass |
| C-054 | Filters | activity feed lists rows, filters by project, and pages | UI | Owner | Pass |
| C-055 | Notifications | shows an unread badge, lists the mention, and Mark all read clears it | UI | Owner + new Member | Pass |
| C-056 | Notifications | clicking a notification marks it read and opens its issue | UI | Owner + new Member | Pass |
| C-057 | Spaces | create a space: key is upper-cased and the creator is its Admin | API | Owner | Pass |
| C-058 | Spaces | an invalid key and a missing name are rejected | API | Owner | Pass |
| C-059 | Spaces | a duplicate key is a 409, case-insensitively | API | Owner | Pass |
| C-060 | Spaces | a space is reachable by key and by id, and listed with its page count | API | Owner | Pass |
| C-061 | Spaces | workspace Viewer cannot create a space | API | Owner + Viewer | Pass |
| C-062 | Spaces | space admin can rename and archive; a non-admin gets 403 | API | Owner + Member | Pass |
| C-063 | Spaces | space members can be added with a role and removed | API | Owner + Member | Pass |
| C-064 | Spaces | a space with live pages cannot be deleted; an empty one can | API | Owner | Pass |
| C-065 | Spaces | only a space admin can delete it | API | Owner | Pass |
| C-066 | Pages & versions | create a page: version 1, and the space name comes back on read | API | Owner | Pass |
| C-067 | Pages & versions | a page needs a title and a space or project | API | Owner | Pass |
| C-068 | Pages & versions | workspace Viewer cannot create a page | API | Owner + Viewer | Pass |
| C-069 | Pages & versions | editing writes a new version; history is newest first | API | Owner | Pass |
| C-070 | Pages & versions | a save against a stale version is refused with 409 and who changed it | API | Owner + Member | Pass |
| C-071 | Pages & versions | compare two versions returns a line diff and flags a title change | API | Owner | Pass |
| C-072 | Pages & versions | restore appends a new version carrying the old content | API | Owner | Pass |
| C-073 | Pages & versions | the page tree nests a child under its parent | API | Owner | Pass |
| C-074 | Pages & versions | a draft is visible only to its author | API | Owner + Member | Pass |
| C-075 | Pages & versions | delete is soft: the page goes to the trash and can be restored | API | Owner | Pass |
| C-076 | Pages & versions | a space Viewer cannot edit pages in that space | API | Owner + Viewer | Defect: page create/edit/delete ignore the Space role; a Space Viewer can edit any page |
| C-077 | Page comments | comment, reply, and list as threads | API | Owner + Member | Pass |
| C-078 | Page comments | an empty comment is rejected | API | Owner | Pass |
| C-079 | Page comments | only the author can edit; author or admin can delete | API | Owner + Member | Pass |
| C-080 | Page comments | resolve and reopen a thread | API | Owner | Pass |
| C-081 | Page comments | workspace Viewer cannot comment | API | Owner + Viewer | Pass |
| C-082 | Page attachments | upload, list, download and delete an attachment | API | Owner | Pass |
| C-083 | Page attachments | an executable attachment is refused | API | Owner | Pass |
| C-084 | Page attachments | another member cannot delete someone else's attachment | API | Owner + Member | Pass |
| C-085 | Templates | the template list includes the built-ins | API | Owner + Member | Pass |
| C-086 | Templates | admin creates, edits and deletes a custom template; a page can start from it | API | Owner + Member | Pass |
| C-087 | Templates | a workspace Member cannot create a template | API | Owner + Member | Pass |
| C-088 | Templates | a built-in template cannot be deleted | API | Owner | Pass |
| C-089 | Search / recent / starred | search finds pages by body text and returns an excerpt with the term | API | Owner | Pass |
| C-090 | Search / recent / starred | the space filter narrows search to one space | API | Owner | Pass |
| C-091 | Search / recent / starred | a title match ranks above a body match | API | Owner | Pass |
| C-092 | Search / recent / starred | trashed pages and other people's drafts are not searchable | API | Owner + Member | Pass |
| C-093 | Search / recent / starred | the legacy /api/wiki/search hides other people's drafts and trashed pages | API | Owner + Member | Defect: GET /api/wiki/search has no draft or trash filter and discloses private draft titles |
| C-094 | Search / recent / starred | viewing a page puts it in Recent | API | Owner + Member | Pass |
| C-095 | Search / recent / starred | star and unstar a page and a space | API | Owner + Member | Pass |
| C-096 | Search / recent / starred | favouriting a bad target type is a 400 | API | Owner + Member | Pass |
| C-097 | Page-issue links | link by key is visible from the page and from the issue; unlink removes it | API | Owner | Pass |
| C-098 | Page-issue links | linking a non-existent issue key is a 404 | API | Owner | Pass |
| C-099 | Documents | multipart upload creates version 1 and the list shows it with storage usage | API | Owner | Pass |
| C-100 | Documents | create a folder, refuse a duplicate, upload into it and filter by it | API | Owner | Pass |
| C-101 | Documents | a new version bumps current_version; download serves current and old versions | API | Owner | Pass |
| C-102 | Documents | an executable (.exe) is refused | API | Owner | Pass |
| C-103 | Documents | a file whose bytes do not match its extension is refused | API | Owner | Pass |
| C-104 | Documents | a duplicate file name in the same folder is a 409 | API | Owner | Pass |
| C-105 | Documents | an upload with no file is a 400 | API | Owner | Pass |
| C-106 | Documents | a space Viewer cannot upload | API | Owner + Viewer | Pass |
| C-107 | Documents | delete a document: it leaves the list and its detail is a 404 | API | Owner | Pass |
| C-108 | Documents | a folder that still holds documents cannot be deleted | API | Owner | Pass |
| C-109 | Confluence Lite | the app switcher opens Confluence Lite with its own sidebar and no Jira sidebar | UI | Owner | Pass |
| C-110 | Confluence Lite | create a space from the Spaces page and open it | UI | Owner | Pass |
| C-111 | Confluence Lite | a duplicate space key shows the server's error in the dialog | UI | Owner | Pass |
| C-112 | Confluence Lite | create a page in a space; it opens with its title, content and space link | UI | Owner | Pass |
| C-113 | Confluence Lite | "Create page" inside a space preselects that space | UI | Owner | Pass (JL-180 fixed by JL-187) |
| C-114 | Confluence Lite | edit a page, then compare and restore versions from history | UI | Owner | Pass |
| C-115 | Confluence Lite | add a comment to a page | UI | Owner | Pass |
| C-116 | Confluence Lite | search finds a page and highlights the term in its excerpt | UI | Owner | Pass |
| C-117 | Documents | upload a document to a space from the Documents tab | UI | Owner | Pass |
| C-118 | Documents | an executable is refused in the upload dialog with the server's message | UI | Owner | Pass |
| C-119 | Route smoke | home (dashboard) renders cleanly with an h1 | UI | Owner | Pass |
| C-120 | Route smoke | dashboard renders cleanly with an h1 | UI | Owner | Pass |
| C-121 | Route smoke | backlog renders cleanly with an h1 | UI | Owner | Pass |
| C-122 | Route smoke | board renders cleanly with an h1 | UI | Owner | Pass |
| C-123 | Route smoke | active sprint renders cleanly with an h1 | UI | Owner | Pass |
| C-124 | Route smoke | reports renders cleanly with an h1 | UI | Owner | Pass |
| C-125 | Route smoke | report builder renders cleanly with an h1 | UI | Owner | Pass |
| C-126 | Route smoke | roadmap renders cleanly with an h1 | UI | Owner | Pass |
| C-127 | Route smoke | projects renders cleanly with an h1 | UI | Owner | Pass |
| C-128 | Route smoke | project summary renders cleanly with an h1 | UI | Owner | Pass |
| C-129 | Route smoke | project settings renders cleanly with an h1 | UI | Owner | Pass |
| C-130 | Route smoke | project board renders cleanly with an h1 | UI | Owner | Pass |
| C-131 | Route smoke | project backlog renders cleanly with an h1 | UI | Owner | Pass |
| C-132 | Route smoke | project reports renders cleanly with an h1 | UI | Owner | Pass |
| C-133 | Route smoke | project roadmap renders cleanly with an h1 | UI | Owner | Pass |
| C-134 | Route smoke | project active sprint renders cleanly with an h1 | UI | Owner | Pass |
| C-135 | Route smoke | project issue list renders cleanly with an h1 | UI | Owner | Pass |
| C-136 | Route smoke | issue list renders cleanly with an h1 | UI | Owner | Pass |
| C-137 | Route smoke | workflow editor renders cleanly with an h1 | UI | Owner | Pass |
| C-138 | Route smoke | filters renders cleanly with an h1 | UI | Owner | Pass |
| C-139 | Route smoke | portfolio renders cleanly with an h1 | UI | Owner | Pass |
| C-140 | Route smoke | knowledge base renders cleanly with an h1 | UI | Owner | Pass |
| C-141 | Route smoke | advanced roadmap renders cleanly with an h1 | UI | Owner | Pass |
| C-142 | Route smoke | member directory renders cleanly with an h1 | UI | Owner + Member | Pass |
| C-143 | Route smoke | user management renders cleanly with an h1 | UI | Owner | Pass |
| C-144 | Route smoke | team directory renders cleanly with an h1 | UI | Owner | Pass |
| C-145 | Route smoke | team profile renders cleanly with an h1 | UI | Owner | Pass |
| C-146 | Route smoke | profile renders cleanly with an h1 | UI | Owner | Pass |
| C-147 | Route smoke | issue by key renders cleanly with an h1 | UI | Owner | Pass |
| C-148 | Route smoke | issue by legacy id renders cleanly with an h1 | UI | Owner | Pass |
| C-149 | Route smoke | activity feed renders cleanly with an h1 | UI | Owner | Pass |
| C-150 | Route smoke | shared dashboards renders cleanly with an h1 | UI | Owner | Pass |
| C-151 | Route smoke | cross-project boards renders cleanly with an h1 | UI | Owner | Pass |
| C-152 | Route smoke | webhooks renders cleanly with an h1 | UI | Owner | Pass |
| C-153 | Route smoke | marketplace renders cleanly with an h1 | UI | Owner | Pass |
| C-154 | Route smoke | inbound email renders cleanly with an h1 | UI | Owner | Pass |
| C-155 | Route smoke | audit log renders cleanly with an h1 | UI | Owner | Pass |
| C-156 | Route smoke | BI export renders cleanly with an h1 | UI | Owner | Pass |
| C-157 | Route smoke | project wiki renders cleanly with an h1 | UI | Owner | Defect: no level-1 heading until a page is selected; the placeholder title "Project Wiki" is an <h2> (src/pages/WikiPage/WikiPage.jsx:273) |
| C-158 | Route smoke | automation renders cleanly with an h1 | UI | Owner | Pass |
| C-159 | Route smoke | project automation renders cleanly with an h1 | UI | Owner | Pass |
| C-160 | Route smoke | releases renders cleanly with an h1 | UI | Owner | Pass |
| C-161 | Route smoke | project releases renders cleanly with an h1 | UI | Owner | Pass |
| C-162 | Route smoke | queues renders cleanly with an h1 | UI | Owner | Pass |
| C-163 | Route smoke | project queues renders cleanly with an h1 | UI | Owner | Pass |
| C-164 | Route smoke | incidents renders cleanly with an h1 | UI | Owner | Pass |
| C-165 | Route smoke | goals renders cleanly with an h1 | UI | Owner | Pass |
| C-166 | Route smoke | plugins renders cleanly with an h1 | UI | Owner | Pass |
| C-167 | Route smoke | project goals renders cleanly with an h1 | UI | Owner | Pass |
| C-168 | Route smoke | assets renders cleanly with an h1 | UI | Owner | Pass |
| C-169 | Route smoke | portal renders cleanly with an h1 | UI | Owner | Pass |
| C-170 | Route smoke | wiki home renders cleanly with an h1 | UI | Owner | Pass |
| C-171 | Route smoke | wiki create page renders cleanly with an h1 | UI | Owner | Pass |
| C-172 | Route smoke | wiki page viewer renders cleanly with an h1 | UI | Owner + Viewer | Pass |
| C-173 | Route smoke | wiki recent renders cleanly with an h1 | UI | Owner + Member | Pass |
| C-174 | Route smoke | wiki starred renders cleanly with an h1 | UI | Owner + Member | Pass |
| C-175 | Route smoke | wiki search renders cleanly with an h1 | UI | Owner | Pass |
| C-176 | Route smoke | wiki apps renders cleanly with an h1 | UI | Owner | Defect: /wiki/apps renders only an EmptyState (<h3>) and has no <h1> (src/pages/WikiHomePage/WikiAppsPage.jsx:20) |
| C-177 | Route smoke | spaces directory renders cleanly with an h1 | UI | Owner | Pass |
| C-178 | Route smoke | space view renders cleanly with an h1 | UI | Owner | Pass |
| C-179 | Route smoke | an unknown URL shows the 404 page | UI | Owner | Pass |
| C-180 | Route smoke | legacy /teams-directory redirects to /teams | UI | Owner | Pass |
| C-181 | Route smoke | legacy /workflows redirects to /list | UI | Owner | Pass |
| C-182 | Route smoke | /wiki redirects to /wiki/home | UI | Owner | Pass |
| C-183 | Route smoke | /members redirects a member away | UI | Member | Pass |
| C-184 | Route smoke | /users redirects a member away | UI | Member | Pass |
| C-185 | Route smoke | webhooks renders for a member without errors, with an h1 | UI | Member | Pass |
| C-186 | Route smoke | audit log renders for a member without errors, with an h1 | UI | Member | Defect: non-admin "Admins only" branch has no <h1> (src/pages/AuditLogPage/AuditLogPage.jsx:77) |
| C-187 | Route smoke | BI export renders for a member without errors, with an h1 | UI | Member | Defect: non-admin "Admins only" branch has no <h1> (src/pages/BiExportPage/BiExportPage.jsx:52) |
| C-188 | Route smoke | inbound email renders for a member without errors, with an h1 | UI | Member | Pass |
| C-189 | Route smoke | automation renders for a member without errors, with an h1 | UI | Member | Pass |
| C-190 | Route smoke | workflow editor renders for a member without errors, with an h1 | UI | Member | Pass |
| C-191 | Route smoke | /members redirects a viewer away | UI | Viewer | Pass |
| C-192 | Route smoke | /users redirects a viewer away | UI | Viewer | Pass |
| C-193 | Route smoke | webhooks renders for a viewer without errors, with an h1 | UI | Viewer | Pass |
| C-194 | Route smoke | audit log renders for a viewer without errors, with an h1 | UI | Viewer | Defect: non-admin "Admins only" branch has no <h1> (src/pages/AuditLogPage/AuditLogPage.jsx:77) |
| C-195 | Route smoke | BI export renders for a viewer without errors, with an h1 | UI | Viewer | Defect: non-admin "Admins only" branch has no <h1> (src/pages/BiExportPage/BiExportPage.jsx:52) |
| C-196 | Route smoke | inbound email renders for a viewer without errors, with an h1 | UI | Viewer | Pass |
| C-197 | Route smoke | automation renders for a viewer without errors, with an h1 | UI | Viewer | Pass |
| C-198 | Route smoke | workflow editor renders for a viewer without errors, with an h1 | UI | Viewer | Pass |
