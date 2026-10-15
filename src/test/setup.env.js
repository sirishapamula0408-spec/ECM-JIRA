// JL-377: environment-only test setup, shared by the client (jsdom) and server
// (node) Vitest projects. Keep this free of DOM-dependent imports — the server
// project loads it in a plain node environment.

// JL-90: server/config.js no longer provides a fallback JWT secret. Test
// suites that sign/verify real JWTs (authGuard, mfa, ...) need a value, so
// provide one for the test environment unless the runner already set it.
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret'
}

// JL-200: tests must never reach the development database. server/config.js
// reads DATABASE_URL (falling back to the dev `jira_lite` database), so any
// suite using the real db.js — auth.test.js did — wrote into dev data: one
// real authtest_<timestamp> login per run, 251 of them locally. In CI that
// database does not exist, so the suite failed there instead. Point it at the
// test database — the one CI creates and integration suites already use.
// Set unconditionally: a DATABASE_URL left in the shell or .env is exactly
// the value this must not inherit. (dotenv never overrides an existing var.)
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://jira_lite:jira_lite_dev@localhost:5432/jira_lite_test'
