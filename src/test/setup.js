import '@testing-library/jest-dom'

// JL-90: server/config.js no longer provides a fallback JWT secret. Test
// suites that sign/verify real JWTs (authGuard, mfa, ...) need a value, so
// provide one for the test environment unless the runner already set it.
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret'
}
