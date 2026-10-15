/**
 * JL-201 — where a user lands right after logging in (or signing up).
 *
 * Every role lands on the Projects list. The rule applies only to a login
 * started from the app's home (or the Dashboard): the login form is shown at
 * whatever address the visitor opened, so a login that began on a specific
 * page — "View in ECM-JIRA" from a notification email opens an issue's
 * address — returns to that page instead. Those links must keep working.
 *
 * Returns the path to go to, or null to stay on the requested page.
 */
export const POST_LOGIN_LANDING = '/projects'

const HOME_PATHS = new Set(['', '/', '/dashboard'])

export function postLoginLanding(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '')
  return HOME_PATHS.has(path) ? POST_LOGIN_LANDING : null
}
