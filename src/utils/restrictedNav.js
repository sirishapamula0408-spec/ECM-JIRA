/**
 * JL-196 — the navigation a workspace Member or Viewer gets when they are not
 * Admin or Lead of any project (usePermissions().hasRestrictedNav).
 *
 * They see only Dashboard and Projects in the left panel, and every other
 * page redirects to the Dashboard. Inside Projects they keep everything for
 * their own projects — the server already scopes that data to membership
 * (JL-193) — and they can open issues and their profile.
 *
 * Both the Sidebar and the route guard in JiraLayout read from here, so the
 * links a user is shown and the pages they may open cannot drift apart.
 */

// Left-panel labels kept for a restricted user (Sidebar item labels).
export const RESTRICTED_NAV_LABELS = ['Projects', 'Dashboards']

const ALLOWED_PATHS = [
  /^\/$/,
  /^\/dashboard\/?$/,
  /^\/projects\/?$/,
  /^\/projects\/[^/]+(\/.*)?$/, // a project and all of its tabs
  /^\/(issues|browse)\/[^/]+\/?$/, // issue detail, linked from the dashboard
  /^\/profile\/?$/, // the avatar menu, not the left panel
]

export function isPathAllowedForRestrictedNav(pathname) {
  return ALLOWED_PATHS.some((re) => re.test(String(pathname || '')))
}
