# Track B test-case catalogue (JL-157)

Projects, Issues, Planning (backlog/sprints) and Execution views (board, active sprint, list).
Specs: e2e/api/{projects,issues,planning}.spec.mjs, e2e/ui/{projects,issues,planning}.spec.mjs. Helpers: e2e/support/track-b.mjs.
A *Defect* row is a test annotated with test.fail(): it asserts the intended behaviour and currently fails because the application is wrong.

| ID | Area | Test case | Layer (API/UI) | Role | Result |
|----|------|-----------|----------------|------|--------|
| B-001 | Projects | create › owner creates a Scrum project and becomes its Lead | API | Owner | Pass |
| B-002 | Projects | create › owner creates a Kanban project | API | Owner | Pass |
| B-003 | Projects | create › a new project is seeded with the default workflow statuses | API | Owner | Pass |
| B-004 | Projects | create › missing name is rejected with 400 | API | Owner | Pass |
| B-005 | Projects | create › missing key is rejected with 400 | API | Owner | Pass |
| B-006 | Projects | create › missing lead is rejected with 400 | API | Owner | Pass |
| B-007 | Projects | create › name over 120 characters and key over 10 characters are rejected | API | Owner | Pass |
| B-008 | Projects | create › a duplicate project key is refused with a client error, not a 500 | API | Owner | Defect: duplicate project key returns 500 |
| B-009 | Projects | create › a workspace Viewer cannot create a project | API | Owner, Viewer | Pass |
| B-010 | Projects | read and list › GET /api/projects/:id returns the project; unknown id is 404 | API | Owner | Pass |
| B-011 | Projects | read and list › a Member lists only projects they belong to and cannot read others | API | Owner, Member | Pass |
| B-012 | Projects | read and list › archived projects drop out of the default list and return with includeArchived | API | Owner | Pass |
| B-013 | Projects | update and delete › a project Admin edits name and type | API | Owner, Admin | Pass |
| B-014 | Projects | update and delete › update enforces the name length cap | API | Owner | Pass |
| B-015 | Projects | update and delete › a project Member cannot edit or delete the project | API | Owner, Member | Pass |
| B-016 | Projects | update and delete › deleting a project removes it; an unknown id is 404 | API | Owner | Pass |
| B-017 | Projects | update and delete › deleting a project does not leave its issues readable by unrelated members | API | Owner, Member | Defect: project delete orphans issues, readable by any member |
| B-018 | Projects | project members and roles › add a member, change their project role, then remove them | API | Owner, Member | Pass |
| B-019 | Projects | project members and roles › an invalid project role on PATCH is rejected | API | Owner, Member | Pass |
| B-020 | Projects | project members and roles › the last project admin can be neither demoted nor removed | API | Owner, Member, Admin | Pass |
| B-021 | Projects | project members and roles › memberId is required when adding a project member | API | Owner, Member | Pass |
| B-022 | Projects | project members and roles › adding someone who is already a member is refused cleanly, not with a 500 | API | Owner, Member | Defect: duplicate project member returns 500 |
| B-023 | Projects | project members and roles › a project Member cannot manage project membership | API | Owner, Member | Pass |
| B-024 | Projects | project members and roles › a project Admin role elevates a workspace Viewer to edit project settings | API | Owner, Viewer, Member | Pass |
| B-025 | Projects | as owner › create a Kanban project through the modal; it appears in the list and the sidebar | UI | Owner | Pass |
| B-026 | Projects | as owner › the modal upper-cases the key and caps it at 10 characters | UI | Owner | Pass |
| B-027 | Projects | as owner › the Project lead defaults to the signed-in user so Create works without touching it | UI | Owner | Defect: lead default not a valid option; Create blocked |
| B-028 | Projects | as owner › clicking a project opens its Summary with the project's name | UI | Owner | Pass |
| B-029 | Projects | as owner › Settings saves a renamed project and a changed type | UI | Owner | Pass |
| B-030 | Projects | a user with no projects › is redirected from a project route to /projects and told they have none | UI | Owner | Pass |
| B-031 | Issues | create › creates a Epic with a project-scoped key | API | Owner | Pass |
| B-032 | Issues | create › creates a Story with a project-scoped key | API | Owner | Pass |
| B-033 | Issues | create › creates a Bug with a project-scoped key | API | Owner | Pass |
| B-034 | Issues | create › creates a Task with a project-scoped key | API | Owner | Pass |
| B-035 | Issues | create › keys are allocated sequentially within the project | API | Owner | Pass |
| B-036 | Issues | create › a Story can be attached to an Epic and appears as its child | API | Owner | Pass |
| B-037 | Issues | create › missing title is rejected with 400 | API | Owner | Pass |
| B-038 | Issues | create › missing description is rejected with 400 | API | Owner | Pass |
| B-039 | Issues | create › missing assignee is rejected with 400 | API | Owner | Pass |
| B-040 | Issues | create › invalid priority, status and type are each rejected | API | Owner | Pass |
| B-041 | Issues | create › title over 255 characters and negative story points are rejected | API | Owner | Pass |
| B-042 | Issues | create › a project Viewer cannot create issues; a project Member can | API | Owner, Viewer, Member | Pass |
| B-043 | Issues | create › an issue created outside Backlog without a sprint is not dropped into an unrelated sprint | API | Owner | Pass (JL-165 fixed) |
| B-044 | Issues | read and edit › the canonical key addresses an issue (any case); bad refs are 400/404 | API | Owner | Pass |
| B-045 | Issues | read and edit › edit title, priority, assignee and story points; the change is recorded in history | API | Owner | Pass |
| B-046 | Issues | read and edit › edit validation: empty title, bad priority, bad flag value | API | Owner | Pass |
| B-047 | Issues | read and edit › flag an issue as an impediment and clear it | API | Owner | Pass |
| B-048 | Issues | read and edit › a project Viewer can read but not edit; a non-member Member cannot read | API | Owner, Viewer, Member | Pass |
| B-049 | Issues | workflow transitions › allowed transitions follow the QA lifecycle | API | Owner | Pass |
| B-050 | Issues | workflow transitions › a transition the workflow forbids is refused with 409 | API | Owner | Pass |
| B-051 | Issues | workflow transitions › cancel is allowed from any active state; Done is terminal | API | Owner | Pass |
| B-052 | Issues | workflow transitions › an unknown status value is rejected with 400 | API | Owner | Pass |
| B-053 | Issues | sub-tasks › create a sub-task under a parent; it inherits the project and is listed with progress | API | Owner | Pass |
| B-054 | Issues | sub-tasks › a nested sub-task is refused with 400; a missing title too | API | Owner | Pass |
| B-055 | Issues | sub-tasks › a parent with an open sub-task cannot be closed (409) until the sub-task is done | API | Owner | Pass |
| B-056 | Issues | labels › create project labels, assign them to an issue and read them back | API | Owner | Pass |
| B-057 | Issues | labels › label validation: name required, bad colour, over 60 characters | API | Owner | Pass |
| B-058 | Issues | links › blocks link is visible from both sides with the inverse name | API | Owner | Pass |
| B-059 | Issues | links › duplicates and relates-to links; removing a link | API | Owner | Pass |
| B-060 | Issues | links › self-links, duplicate links (either direction) and unknown types are refused | API | Owner | Pass |
| B-061 | Issues | attachments › upload, list, download and delete a text attachment | API | Owner | Pass |
| B-062 | Issues | attachments › an executable is refused with 415 | API | Owner | Pass |
| B-063 | Issues | attachments › a file over 10 MB is refused with 413 | API | Owner | Pass |
| B-064 | Issues | attachments › a project Viewer cannot upload | API | Owner, Viewer | Pass |
| B-065 | Issues | comments, mentions and watchers › a comment with an @mention notifies the mentioned member | API | Owner, Member | Pass |
| B-066 | Issues | comments, mentions and watchers › empty and over-long comments are rejected; a Viewer cannot comment | API | Owner, Viewer | Pass |
| B-067 | Issues | comments, mentions and watchers › the creator auto-watches on create and a commenter auto-watches on comment | API | Owner | Pass |
| B-068 | Issues | comments, mentions and watchers › watchers are notified of new comments | API | Owner | Pass |
| B-069 | Issues | comments, mentions and watchers › watch and unwatch are idempotent | API | Owner | Pass |
| B-070 | Issues | comments, mentions and watchers › a non-member cannot list or join the watchers of a project's issue | API | Owner, Member | Defect: watcher routes have no project-access check |
| B-071 | Issues | time tracking › estimate "1d 4h" parses to 720 minutes; logging "45m" updates spent and remaining | API | Owner | Pass |
| B-072 | Issues | time tracking › deleting a worklog restores the remaining time | API | Owner | Pass |
| B-073 | Issues | time tracking › unparseable time is rejected | API | Owner | Pass |
| B-074 | Issues | custom fields › an admin defines a dropdown field and a member sets a value on an issue | API | Owner, Member, Admin | Pass |
| B-075 | Issues | custom fields › a workspace Member cannot define fields; bad definitions are rejected | API | Owner, Member | Pass |
| B-076 | Issues | custom fields › a number field rejects non-numeric values | API | Owner | Pass |
| B-077 | Issues | votes › vote, vote again (idempotent), read the count, unvote | API | Owner | Pass |
| B-078 | Issues | delete › deleting an issue cascades to its sub-tasks, comments, labels, links and worklogs | API | Owner | Pass |
| B-079 | Issues | delete › a project Viewer cannot delete an issue | API | Owner, Viewer | Pass |
| B-080 | Issues | delete › cloning an issue allocates a fresh key and copies its labels | API | Owner | Pass |
| B-081 | Issues | as owner › the top-bar Create button is enabled and opens the Create issue modal | UI | Owner | Defect: top-bar Create always disabled |
| B-082 | Issues | as owner › create a Bug through the Create issue modal (opened with the "c" shortcut) | UI | Owner | Pass |
| B-083 | Issues | as owner › /browse/KEY opens the issue page with its key and title | UI | Owner | Pass |
| B-084 | Issues | as owner › edit the priority inline and it persists | UI | Owner | Pass |
| B-085 | Issues | as owner › add a comment | UI | Owner | Pass |
| B-086 | Issues | as owner › add a new label from the Labels field | UI | Owner | Pass |
| B-087 | Issues | as owner › log work from the Work log tab | UI | Owner | Pass |
| B-088 | Issues | as a project Viewer › the issue page is read-only: no comment box, no Log work, no Delete | UI | Owner, Viewer | Pass |
| B-089 | Planning | sprints › create a sprint with a goal; name falls back when blank | API | Owner | Pass |
| B-090 | Planning | sprints › sprint name over 120 characters is rejected; a Member cannot create sprints | API | Owner, Member | Pass |
| B-091 | Planning | sprints › add issues to a sprint, start it, then complete it: unfinished work returns to the backlog | API | Owner | Pass |
| B-092 | Planning | sprints › only one active sprint per project unless parallel sprints are enabled | API | Owner | Pass |
| B-093 | Planning | sprints › an active sprint in one project does not block starting a sprint in another | API | Owner | Pass (JL-165 fixed) |
| B-094 | Planning | sprints › starting, completing or deleting an unknown sprint is 404 | API | Owner | Pass |
| B-095 | Planning | sprints › deleting a sprint returns its issues to the backlog | API | Owner | Pass |
| B-096 | Planning | sprints › a Member cannot start or complete a sprint | API | Owner, Member | Pass |
| B-097 | Planning | bulk change › dry run previews changes without writing | API | Owner | Pass |
| B-098 | Planning | bulk change › bulk status, priority and assignee apply to every selected issue | API | Owner | Pass |
| B-099 | Planning | bulk change › bulk move to a sprint and back to no sprint | API | Owner | Pass |
| B-100 | Planning | bulk change › bulk delete removes the issues | API | Owner | Pass |
| B-101 | Planning | bulk change › invalid values, unknown assignees and missing issues are reported per issue | API | Owner | Pass |
| B-102 | Planning | bulk change › a project Viewer cannot bulk-edit issues | API | Owner, Viewer | Pass |
| B-103 | Planning | bulk change › bulk status change respects the workflow like a single transition does | API | Owner | Defect: bulk status bypasses workflow |
| B-104 | Planning | export › CSV export has the header row and one line per issue | API | Owner | Pass |
| B-105 | Planning | export › JSON export carries the project and its issues | API | Owner | Pass |
| B-106 | Planning | export › a project Viewer can export; a non-member cannot | API | Owner, Viewer, Member | Pass |
| B-107 | Planning | import › dry run (the default) previews valid rows, reports invalid rows and alias warnings, writes nothing | API | Owner | Pass |
| B-108 | Planning | import › commit creates the valid rows with sequential keys and later issues continue the sequence | API | Owner | Pass |
| B-109 | Planning | import › empty or header-only CSV is rejected; a Viewer cannot import | API | Owner, Viewer | Pass |
| B-110 | Planning | import › a row naming a sprint that does not exist is reported as invalid, not a 500 | API | Owner | Pass (JL-172 fixed by JL-165) |
| B-111 | Planning | backlog and sprints › the Backlog lists the project's backlog issues | UI | Owner | Pass |
| B-112 | Planning | backlog and sprints › Create sprint moves the selected backlog issue into a new sprint | UI | Owner | Pass |
| B-113 | Planning / Execution | backlog and sprints › start a sprint: the Active sprints tab appears and shows the sprint board; complete it | UI | Owner | Pass |
| B-114 | Planning | backlog and sprints › a project's Backlog does not show another project's sprint | UI | Owner | Pass (JL-165 fixed) |
| B-115 | Planning | backlog and sprints › the bulk toolbar counts the selection and applies a priority change | UI | Owner | Pass |
| B-116 | Execution | board › columns render per status and the card sits in its status column | UI | Owner | Pass |
| B-117 | Execution | board › moving a card with its status menu persists the new status | UI | Owner | Pass |
| B-118 | Execution | board › dragging a card to another column persists the new status | UI | Owner | Pass |
| B-119 | Execution | board › a move the workflow forbids is not persisted | UI | Owner | Pass |
| B-120 | Execution | list view › renders the project issues and sorts by Priority both ways | UI | Owner | Pass |
| B-121 | Execution | list view › add and remove a column from the + menu | UI | Owner | Pass |
| B-122 | Execution | list view › an empty project list has no horizontal scrollbar at 1280px | UI | Owner | Pass |
| B-123 | Planning | sprints › JL-165: a sprint must name its project, and lists are scoped by it | API | Owner | Pass |
