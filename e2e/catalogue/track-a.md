# JL-157 Track A — Authentication, Administration, RBAC

Specs: `e2e/api/{auth,admin,rbac}.spec.mjs`, `e2e/ui/{auth,admin,rbac}.spec.mjs`, helpers in `e2e/support/track-a.mjs`.
"Defect" rows are `test.fail`-annotated: they assert the intended behaviour and stay green while the bug exists.

| ID | Area | Test case | Layer (API/UI) | Role | Result |
|----|------|-----------|----------------|------|--------|
| A-001 | Auth / signup | Signup happy path → 201, token, Viewer member | API | Anonymous | Pass |
| A-002 | Auth / signup | Malformed email rejected (400) | API | Anonymous | Pass |
| A-003 | Auth / signup | Password < 6 chars rejected (400) | API | Anonymous | Pass |
| A-004 | Auth / signup | Org password policy (min 8) enforced at signup | API | Anonymous | Pass |
| A-005 | Auth / JL-155 | Signup for an active account → 409 `account_exists` | API | Anonymous | Pass |
| A-006 | Auth / JL-155 | Mixed-case email does not create a duplicate; logs in to same account | API | Anonymous | Pass |
| A-007 | Auth / login | Login succeeds with correct credentials | API | Member | Pass |
| A-008 | Auth / login | Wrong password → 401 generic message | API | Viewer | Pass |
| A-009 | Auth / login | Unknown user → 401 same generic message | API | Anonymous | Pass |
| A-010 | Auth / login | Missing password → 400 | API | Member | Pass |
| A-011 | Auth / lockout | 5 failures lock the login (429 + Retry-After), even with the right password | API | Throwaway | Pass |
| A-012 | Auth / tokens | No token → 401 on protected endpoint | API | Anonymous | Pass |
| A-013 | Auth / tokens | Garbage and tampered JWT → 401 | API | Anonymous | Pass |
| A-014 | Auth / sessions | Revoked session's token → 401, revoking session untouched | API | Throwaway | Pass |
| A-015 | Auth / deactivation | Deactivated account cannot log in (403) | API | Throwaway | Pass |
| A-016 | Auth / deactivation | Token issued before deactivation stops working | API | Throwaway | Defect: deactivated user's JWT still accepted |
| A-017 | Auth / deletion | Token issued before member deletion stops working | API | Throwaway | Defect: deleted user's JWT still accepted (as Viewer) |
| A-018 | Auth / reset | Forgot-password returns token (SMTP off); reset works; old pw fails; token single-use | API | Throwaway | Pass |
| A-019 | Auth / reset | Forgot-password for unknown address → 200, no token, no enumeration | API | Anonymous | Pass |
| A-020 | Auth / reset | Reset rejects unknown token, weak password, missing token | API | Anonymous | Pass |
| A-021 | Auth / reset | A second reset request invalidates the first token | API | Throwaway | Pass |
| A-022 | Auth / invitations | Invite → public lookup → accept with password → signed-in Member; single use | API | Owner + invitee | Pass |
| A-023 | Auth / invitations | Accept without password grants role; signup completes the account | API | Owner + invitee | Pass |
| A-024 | Auth / invitations | Unknown token 404; revoked invitation cannot be accepted | API | Owner + Anonymous | Pass |
| A-025 | Auth / invitations | Inviting an existing member → 409 | API | Owner | Pass |
| A-026 | Auth / signup policy | invite_only refuses uninvited signup, allows invited (policy restored) | API | Owner + Anonymous | Pass |
| A-027 | Auth / signup policy | Invalid signup_policy value → 400 | API | Owner | Pass |
| A-028 | Auth / deny-list | Deleting a member blocks re-signup; re-inviting lifts the block | API | Owner + Anonymous | Pass |
| A-029 | Auth / JL-155 | Re-admitted address with never-used login re-registers (stale login replaced) | API | Owner + Anonymous | Pass |
| A-030 | Auth / JL-155 | Re-admitted address with used login is reactivated, keeps user id | API | Owner + Anonymous | Pass |
| A-031 | Auth / JL-155 | Signup for a suspended (deactivated) member → 403 not eligible | API | Owner + Anonymous | Pass |
| A-032 | Admin / members | Create member with password → Active, can log in | API | Admin | Pass |
| A-033 | Admin / members | Create member without password → Invited + real invitation + email log "skipped" | API | Admin | Pass |
| A-034 | Admin / members | Create validation: missing fields, bad email, Owner role, short pw, duplicate | API | Admin | Pass |
| A-035 | Admin / members | Role change applies, shows in /me and the user audit trail | API | Admin | Pass |
| A-036 | Admin / members | Role change rejects Owner / unknown role / unknown id | API | Admin | Pass |
| A-037 | Admin / Owner | Owner cannot be demoted, deactivated or deleted | API | Admin | Pass |
| A-038 | Admin / members | Deactivate blocks login, reactivate restores it, role preserved | API | Admin | Pass |
| A-039 | Admin / members | Delete removes member, deactivates login, audits; second delete 404 | API | Admin | Pass |
| A-040 | Admin / members | Bulk delete deletes targets, skips Owner and unknown ids; empty list 400 | API | Admin | Pass |
| A-041 | Admin / members | Member list search/role/status filters and pagination envelope | API | Admin | Pass |
| A-042 | Admin / members | Resend works for Invited (new token), refused for Active | API | Admin | Pass |
| A-043 | Admin / last-Admin | Deleting a second Admin is allowed while the Owner counts as admin | API | Admin | Pass |
| A-044 | Admin / teams | Team create → read → edit → delete | API | Admin, Member | Pass |
| A-045 | Admin / teams | Team validation: name required, bad mode, javascript: link rejected | API | Admin | Pass |
| A-046 | Admin / teams | Add member, promote, last-Lead guard (409), remove | API | Admin | Pass |
| A-047 | Admin / teams | Non-Lead cannot edit/delete/add others; self-join OPEN only | API | Member, Viewer | Pass |
| A-048 | Admin / workflow | Transition change persists; duplicate 409; bad status 400; removal persists | API | Admin | Pass |
| A-049 | Admin / workflow | Workflow diagram layout persists and resets | API | Admin, Member | Pass |
| A-050 | Admin / audit | Member actions in user audit trail; login + failed login in audit log | API | Admin | Pass |
| A-051 | Admin / audit | Audit hash chain verifies (`/api/audit-log/verify` ok) | API | Admin | Defect: verify always reports broken at seq 1 |
| A-052 | Admin / audit | Audit list filters/paginates; CSV export | API | Admin | Pass |
| A-053 | Admin / audit | Verify endpoint answers with a well-formed result | API | Admin | Pass |
| A-054 | RBAC / workspace | Member gets 403 on 21 admin-only endpoints | API | Member | Pass |
| A-055 | RBAC / workspace | Viewer gets 403 on 21 admin-only endpoints | API | Viewer | Pass |
| A-056 | RBAC / workspace | Admin reaches the admin endpoints | API | Admin | Pass |
| A-057 | RBAC / projects | Viewer cannot create a project (403); Member can | API | Viewer, Member | Pass |
| A-058 | RBAC / issues | Viewer cannot create issues (project-less or project) | API | Viewer | Pass |
| A-059 | RBAC / comments | Viewer cannot comment | API | Viewer | Pass |
| A-060 | RBAC / read | Viewer can read project/issue/comments they belong to | API | Viewer | Pass |
| A-061 | RBAC / project role | Workspace Member as project Viewer cannot edit/transition/comment/create/delete | API | Member | Pass |
| A-062 | RBAC / project role | Project Viewer cannot edit issues via bulk update | API | Member | Defect: bulk update bypasses project Viewer role |
| A-063 | RBAC / project role | Project Member role grants write access | API | Member | Pass |
| A-064 | RBAC / project read | Non-member cannot read project/issue; project hidden from list | API | Member | Pass |
| A-065 | RBAC / project admin | Project Viewer/Member cannot edit, manage members or delete project | API | Member, Viewer | Pass |
| A-066 | RBAC / bypass | Workspace Admin bypasses project roles | API | Admin | Pass |
| A-067 | RBAC / escalation | Member cannot raise own workspace role | API | Member | Pass |
| A-068 | RBAC / escalation | Viewer cannot issue invitations (e.g. an Admin invite) | API | Viewer | Pass |
| A-069 | Auth UI | Log in through the real form lands in the app | UI | Member | Pass |
| A-070 | Auth UI | Wrong password shows the error, stays on login | UI | Viewer | Pass |
| A-071 | Auth UI | Submit disabled until filled; invalid email flagged on blur | UI | Anonymous | Pass |
| A-072 | Auth UI | Sign Up tab switches to account creation and back | UI | Anonymous | Pass |
| A-073 | Auth UI | Sign up through the form creates a Viewer and signs in | UI | Anonymous | Pass |
| A-074 | Auth UI / JL-155 | Account-exists signup offers Log in / Reset password; Reset opens forgot flow prefilled | UI | Anonymous | Pass |
| A-075 | Auth UI / JL-155 | "Log in" action returns to the login form | UI | Anonymous | Pass |
| A-076 | Auth UI | Weak password at signup shows the policy error | UI | Anonymous | Pass |
| A-077 | Auth UI | Sign-up password hint matches the enforced policy | UI | Anonymous | Defect: hint says 6, policy enforces 8 |
| A-078 | Auth UI / reset | Forgot flow: email → token step → mismatch error → done → log in with new pw | UI | Throwaway | Pass |
| A-079 | Auth UI / reset | /reset-password?token= sets a new password | UI | Throwaway | Pass |
| A-080 | Auth UI / reset | /reset-password without a token explains the problem | UI | Anonymous | Pass |
| A-081 | Auth UI / invite | /accept-invite: choose password, land signed in as Member | UI | Invitee | Pass |
| A-082 | Auth UI / invite | /accept-invite with unknown token shows an error | UI | Anonymous | Pass |
| A-083 | Auth UI / logout | Log out from user menu returns to login and clears stored token | UI | Throwaway | Pass |
| A-084 | Admin UI / members | /members renders rows; Owner static; role dropdowns; Active pill | UI | Admin | Pass |
| A-085 | Admin UI / members | Inline role dropdown changes a role | UI | Admin | Pass |
| A-086 | Admin UI / members | Status pills green/yellow/red; default filter Active | UI | Admin | Pass |
| A-087 | Admin UI / members | Deactivate / Reactivate buttons toggle member and login | UI | Admin | Pass |
| A-088 | Admin UI / members | Invite panel creates a pending invitation | UI | Admin | Pass |
| A-089 | Admin UI / members | Invite confirmation does not claim delivery when no email was sent | UI | Admin | Defect: "Invitation sent successfully." with SMTP off |
| A-090 | Admin UI / members | Row delete asks for confirmation and removes the member | UI | Admin | Pass |
| A-091 | Admin UI / users | /users renders users, role dropdowns, status chip | UI | Admin | Pass |
| A-092 | Admin UI / users | Add user with temp password → Active account that can log in | UI | Admin | Pass |
| A-093 | Admin UI / users | Add user without password warns no email was sent | UI | Admin | Pass |
| A-094 | Admin UI / users | Deactivate via confirm dialog | UI | Admin | Pass |
| A-095 | Admin UI / teams | Create team from /teams and open its profile | UI | Admin | Pass |
| A-096 | Admin UI / teams | Edit team name from its profile | UI | Admin | Pass |
| A-097 | Admin UI / teams | Unknown team id shows "Team not found" | UI | Admin | Pass |
| A-098 | Admin UI / workflow | Workflow editor loads and opens a project | UI | Admin | Pass |
| A-099 | Admin UI / audit | "Verify integrity" reports the chain intact | UI | Admin | Defect: shows "Tampering detected" (same cause as A-051) |
| A-100 | Admin UI / routing | Admin deep-link to /members shows the member directory | UI | Admin | Defect: bounced to Dashboard (RequireRole loading race) |
| A-101 | Admin UI / routing | Admin deep-link to /users shows User Management | UI | Admin | Defect: bounced to Dashboard (same race) |
| A-102 | RBAC UI | Member does not see Members/Users sidebar items | UI | Member | Pass |
| A-103 | RBAC UI | Viewer does not see Members/Users sidebar items | UI | Viewer | Pass |
| A-104 | RBAC UI | Member redirected away from /members and /users | UI | Member | Pass |
| A-105 | RBAC UI | Viewer redirected away from /members and /users | UI | Viewer | Pass |
| A-106 | RBAC UI | Member sees "Admins only" on /audit-log | UI | Member | Pass |
| A-107 | RBAC UI | Viewer sees "Admins only" on /audit-log | UI | Viewer | Pass |
| A-108 | RBAC UI | Viewer is not offered "Create project" | UI | Viewer | Pass |
| A-109 | RBAC UI | Member is offered "Create project" | UI | Member | Pass |
| A-110 | RBAC UI | Admin sees and opens Members and Users | UI | Admin | Pass |
| A-111 | RBAC UI | Owner sees and opens Members and Users | UI | Owner | Pass |
| A-112 | RBAC UI | Admin sees the full audit log page | UI | Admin | Pass |
