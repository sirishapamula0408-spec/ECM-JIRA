// JL-157 — the one place the functional suite's environment is defined.
//
// The suite runs against its OWN server and database, never the dev database
// and never projects.fosasoft.com. Everything that could leave the machine is
// switched off here rather than trusted to the tests.

export const E2E_PORT = Number(process.env.E2E_PORT) || 4100
export const BASE_URL = `http://localhost:${E2E_PORT}`
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL
  || 'postgresql://jira_lite:jira_lite_dev@localhost:5432/jira_lite_e2e'

/** Environment for the server under test. */
export function serverEnv() {
  return {
    ...process.env,
    PORT: String(E2E_PORT),
    DATABASE_URL: E2E_DATABASE_URL,
    APP_URL: BASE_URL,
    SERVE_STATIC: '1',
    // .env configures a real SMTP relay. dotenv never overrides a variable that
    // is already set — even to '' — so these blank it for this process only,
    // and isSmtpConfigured() is false: invites and notifications go nowhere.
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    // The suite logs in far more often than a person; the defaults (60 auth
    // requests a minute) would turn into false failures.
    RATE_LIMIT_MAX: '100000',
    AUTH_RATE_LIMIT_MAX: '100000',
  }
}

// Test accounts. example.com is reserved (RFC 2606): nothing sent here arrives.
export const PASSWORD = 'E2e-Pass-1234!'
export const ACCOUNTS = {
  owner: { email: 'owner@e2e.example.com', name: 'Olivia Owner', role: 'Admin' },
  admin: { email: 'admin@e2e.example.com', name: 'Adam Admin', role: 'Admin' },
  member: { email: 'member@e2e.example.com', name: 'Mia Member', role: 'Member' },
  viewer: { email: 'viewer@e2e.example.com', name: 'Victor Viewer', role: 'Viewer' },
}

export const AUTH_DIR = 'e2e/.auth'
export const storageStatePath = (role) => `${AUTH_DIR}/${role}.json`
