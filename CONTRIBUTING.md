# Contributing to ECM JIRA Clone

This guide captures the **established, de-facto conventions** of this codebase so
new work stops drifting. It documents how things are *actually done here* today —
not aspirational rules. When in doubt, grep for an existing example and match it.

> Companion docs: `CLAUDE.md` (architecture overview) and `README.md` (setup).

---

## Table of contents

- [Workflow](#workflow)
- [Backend conventions](#backend-conventions)
- [API conventions](#api-conventions)
  - [Error shape](#error-shape)
  - [Status codes](#status-codes)
  - [Pagination](#pagination)
  - [Known deviations](#known-deviations-to-converge-over-time)
- [Frontend conventions](#frontend-conventions)
- [Testing](#testing)
- [Linting](#linting)

---

## Workflow

- **One ticket → one feature branch.** Branch off the integration branch, name it
  `feature/JL-<id>-<slug>` (e.g. `feature/JL-181-conventions-doc`).
- **Tests are the gate.** A change ships only when the backend unit suite is green:
  ```bash
  npx vitest run server/__tests__
  ```
  Behavior-preserving changes must keep the **same pass count** (allowing for the
  known JL-93 security-middleware flake, which is timing-sensitive).
- **Conventional commits.** `type(scope): summary` — e.g. `feat(worklogs): …`,
  `fix(integration): …`, `docs: …`, `test(integration): …`, `chore: …`.
- **Don't do mass response-shape rewrites.** Changing an existing endpoint's JSON
  body is a behavior change with real blast radius. Document the target shape and
  converge new code toward it instead (see [Known deviations](#known-deviations-to-converge-over-time)).

---

## Backend conventions

**SQL placeholders — always `?`.** Route SQL uses SQLite-style `?` placeholders.
`convertPlaceholders()` in `server/db.js` rewrites them to PostgreSQL `$1,$2,…`
transparently (it respects `?` inside single-quoted string literals). Never write
`$1` by hand in a route.

```js
const row = await get('SELECT id FROM issues WHERE project_id = ? AND key = ?', [projectId, key])
```

**Wrap every async handler in `asyncHandler`.** From
`server/middleware/errorHandler.js`. It forwards rejected promises to the global
`errorHandler`, which returns `500 { error: 'Internal server error' }`. Without it,
a thrown error hangs the request.

```js
import { asyncHandler } from '../middleware/errorHandler.js'
router.post('/things', asyncHandler(async (req, res) => { /* ... */ }))
```

**Authorization via middleware, not ad-hoc checks.** Use
`server/middleware/authorize.js`:
- `requireRole('Admin')` — enforces a minimum **workspace** role (Owner > Admin >
  Member > Viewer).
- `loadProjectRole` then `requireProjectRole('Admin')` — enforces a **project**
  role (Lead/Admin/Member/Viewer). Workspace Admin/Owner bypass project checks.

**Migrations are idempotent.** `initializeDatabase()` in `server/db.js` must be
safe to run repeatedly on an existing database:
- Tables: `CREATE TABLE IF NOT EXISTS …`.
- New columns on existing tables: guard with the `columnExists(table, column)`
  helper (or `ALTER TABLE … ADD COLUMN IF NOT EXISTS`) before/around the ALTER.
- Seed rows: `INSERT … ON CONFLICT DO NOTHING` (idempotent inserts, e.g. auto-watch).

**PostgreSQL literals.** Use `TRUE` / `FALSE` for booleans (not `0`/`1`), `NOW()`
for timestamps, and `::jsonb` for JSON casts.

**The `run()` RETURNING-id pitfall.** The `run()` wrapper auto-appends
`RETURNING id` to `INSERT` statements and returns `{ lastID, changes }`. This
breaks on tables that have **no `id` column** (e.g. `issue_labels` with a composite
PK). For those, add an explicit `RETURNING <col>` yourself so the wrapper detects
it and doesn't inject `RETURNING id`:

```js
await run('INSERT INTO issue_labels (issue_id, label_id) VALUES (?, ?) RETURNING label_id', [i, l])
```

---

## API conventions

### Error shape

The canonical error body is a JSON object with a single human-readable `error`
string. The frontend depends on this: `src/api/client.js` reads `payload?.error`
as the thrown `Error`'s message, and attaches the whole body as `error.data`.

```jsonc
// 4xx / 5xx
{ "error": "Issue not found" }
```

For **field-level validation** failures, add an `errors` array alongside `error`:

```jsonc
{ "error": "Validation failed", "errors": ["title is required", "priority is invalid"] }
```

Prefer the shared helper `server/utils/httpError.js` for new/edited error
responses — it is byte-identical to the inline form and keeps the shape from
drifting:

```js
import { sendError } from '../utils/httpError.js'

if (!name) return sendError(res, 400, 'Label name is required')
// → res.status(400).json({ error: 'Label name is required' })

return sendError(res, 400, 'Validation failed', { errors })
// → res.status(400).json({ error: 'Validation failed', errors: [...] })
```

Do **not** introduce `{ message: … }`, bare strings, or `{ success: false, error }`
for errors in new code.

### Status codes

| Code | Use for |
|------|---------|
| **200** | Successful read, **update**, or delete (see below) |
| **201** | Resource **created** (`POST` that inserts a row) — set `Location`/return the new row where practical |
| **400** | Validation / bad input (malformed body, missing required field) |
| **401** | Unauthenticated (missing/invalid token) — handled by `authGuard` |
| **403** | Authenticated but not authorized (`requireRole` / `requireProjectRole`) |
| **404** | Resource not found |
| **409** | Conflict (duplicate, or an invariant would be violated — e.g. closing a parent with open sub-tasks, last-Admin protection) |

**Delete responses — recommended: `200 { success: true }`.** This is the dominant
existing convention (used by the large majority of DELETE endpoints). Prefer it for
new deletes for consistency. `204 No Content` is acceptable and RESTfully correct,
but is the minority here — don't convert existing `200 { success: true }` endpoints
to `204` (that's a breaking shape change for any client reading the body).

### Pagination

Reuse the shared helper `server/utils/pagination.js` — do not hand-roll limit/offset
parsing.

- `parsePagination(req.query, { defaultLimit, maxLimit })` returns clamped,
  bind-safe `{ limit, offset }` integers. Accepts `limit`, `offset`, and a
  convenience 1-based `page` (offset wins over page).
- `isPaginationRequested(req.query)` is true only when `limit`/`offset`/`page` is
  present — use it to keep the **legacy unbounded array response** when no paging
  param is supplied (opt-in pagination), so you don't break existing callers.
- Expose totals via **response headers**, keeping the body a plain array:
  `X-Total-Count`, `X-Limit`, `X-Offset`.

Reference implementation: `GET /api/issues` in `server/routes/issues.js`.

```js
import parsePagination, { isPaginationRequested } from '../utils/pagination.js'

if (isPaginationRequested(req.query)) {
  const { limit, offset } = parsePagination(req.query)
  const total = Number((await get(countSql, params))?.total) || 0
  const rows = await all(`${sql} LIMIT ? OFFSET ?`, [...params, limit, offset])
  res.set('X-Total-Count', String(total))
  res.set('X-Limit', String(limit))
  res.set('X-Offset', String(offset))
  return res.json(rows)
}
res.json(await all(sql, params)) // legacy unbounded shape
```

### Known deviations (to converge over time)

The codebase predates these being written down, so some drift exists. **Do not do a
mass rewrite** — just don't add *new* deviations, and prefer the canonical form when
you're already editing a handler:

- **Delete bodies** vary: mostly `200 { success: true }`, but also `{ ok: true }`,
  richer `{ ok: true, deleted: … }`, and a few `204`. Canonical target:
  `200 { success: true }`.
- **List/pagination shapes** vary (bare arrays, `{ items, total }`, header-based,
  cursor-based `{ …, nextCursor, hasMore }` for activity feeds). Canonical target
  for new offset lists: **header-based** via `pagination.js`. Cursor pagination is
  a legitimate separate pattern for infinite-scroll feeds — keep it where it exists.
- A small number of endpoints return errors as `{ success: false, error }`; new
  code should use plain `{ error }` via `sendError`.

---

## Frontend conventions

- **MUI-first.** New UI uses Material UI v6 components (buttons, inputs, dialogs,
  tables, avatars, chips, alerts). Global theme tokens live in
  `src/theme/muiTheme.js`; existing CSS layout classes (`.workspace`, `.sidebar`,
  `.topbar`, `.page`) remain for the responsive grid.
- **Co-locate page CSS** with its JSX in `src/pages/<PageName>/`.
- **API access goes through `src/api/client.js`.** `api(path, options)` auto-injects
  the JWT Bearer token from local/session storage and parses JSON. It does **not**
  auto-stringify — pass `body: JSON.stringify(...)` yourself. On a non-OK response it
  throws an `Error` with `error.status` and `error.data` (the parsed JSON body)
  attached, so callers can inspect fields like `mfaRequired`. Domain modules
  (`issueApi.js`, `sprintApi.js`, `labelApi.js`, …) wrap `api()`. Binary/large
  downloads (CSV/JSON export, attachment download) use a raw `fetch` with the Bearer
  header because `api()` always parses JSON.
- **State** is React Context (see the nested providers in `App.jsx`). Reuse the
  existing contexts rather than adding new global stores.
- Reuse shared primitives like `src/components/common/EmptyState.jsx` for "no data"
  states instead of ad-hoc markup.

---

## Testing

Framework: **Vitest** (`globals: true`, setup in `src/test/setup.js`). Config lives
in `vite.config.js`.

**Two backend test styles — pick by what you're testing:**

- **Unit / route-handler tests → `server/__tests__/`.** These **mock the database**
  with `vi.mock('../db.js')` and exercise routes via `supertest` against a tiny
  Express app that stubs auth/role middleware. Fast, no DB required. See
  `collaboration-modules.test.js` for the canonical `createApp` + mocked
  `run/all/get` pattern. Pure helpers (e.g. `httpError.js`, `pagination.js`,
  `validate.js`) get a plain unit test here.
- **Integration / schema tests → `server/test/`.** These run against **real
  PostgreSQL** using `createTestDb()`, which provisions a unique isolated schema
  (`test_<hex>`) per suite so suites run in parallel without collisions; `cleanTestDb()`
  drops it afterward. Requires `TEST_DATABASE_URL` (defaults to the local
  `jira_lite_test` DB).

**Node builtins in unit tests.** A suite that imports backend code using `node:`
builtins at module load (e.g. `attachments.js` → `fs`) must put
`// @vitest-environment node` at the top of the file — the repo default is `jsdom`,
which browser-externalizes `node:` builtins.

**Run a single suite / test:**
```bash
npx vitest run server/__tests__/http-error-JL181.test.js   # one file
npx vitest run --grep "sendError"                          # by test name
npx vitest run server/__tests__                             # whole backend unit gate
```

Frontend component tests live in `src/test/` (`@testing-library/react`, jsdom).

---

## Linting

ESLint uses **flat config** (`eslint.config.js`) with separate blocks for frontend
(`src/**/*.{js,jsx}` — React hooks/refresh plugins) and backend (`server/**/*.js` —
Node globals only). Run:

```bash
npm run lint
```

If lint tooling misbehaves after a dependency change, run a clean install
(`npm ci`) to rebuild `node_modules` from the lockfile before investigating — a
mismatched/duplicated `acorn-jsx` in a partially-installed tree is a known cause of
spurious parser errors. (Note: in worktrees where `node_modules` is a junction, do
**not** `npm ci` — it operates on the shared install.)
