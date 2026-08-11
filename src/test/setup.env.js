// JL-377: environment-only test setup, shared by the client (jsdom) and server
// (node) Vitest projects. Keep this free of DOM-dependent imports — the server
// project loads it in a plain node environment.

// JL-90: server/config.js no longer provides a fallback JWT secret. Test
// suites that sign/verify real JWTs (authGuard, mfa, ...) need a value, so
// provide one for the test environment unless the runner already set it.
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret'
}
