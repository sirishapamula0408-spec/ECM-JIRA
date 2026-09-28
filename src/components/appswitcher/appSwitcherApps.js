import { JiraLiteAppIcon, ConfluenceLiteAppIcon } from './AppSwitcherIcons'

/*
 * JL-151 — the app switcher's one source of truth.
 *
 * Adding a product is one entry here plus its tile icon; the panel is rendered
 * from this array, never from hand-written rows. Kept in a plain .js module
 * rather than beside <AppSwitcher> because a module that exports a component
 * may export nothing else (react-refresh/only-export-components is an error in
 * this repo).
 *
 * Fields:
 *   id       stable key, also used by tests and by resolveActiveAppId()
 *   name     the visible row label
 *   icon     a component rendering the 32x32 tile (see AppSwitcherIcons.jsx)
 *   route    where the row navigates, via a normal client-side route change
 *   enabled  false parks an entry without deleting it (it is not rendered)
 *   requires a capability name from usePermissions(), or null for "everyone".
 *            An app the user fails this check is ABSENT from the panel — not
 *            greyed out. A disabled row advertises a product the user cannot
 *            have, which is the thing an entitlement list exists to avoid.
 *   match    RegExp deciding whether the current pathname is inside this app
 *   isDefault  the app claimed by any pathname no other app matches
 */

/**
 * Every wiki write route on the server is `requireRole('Member')`
 * (server/routes/wiki.js), and `canCreateIssue` is the frontend mirror of that
 * same Member+ rank. So Confluence Lite is offered to people who can actually
 * author in it; a Viewer keeps read access to any project wiki through the
 * project's own Wiki tab, which is unchanged.
 */
const WIKI_CAPABILITY = 'canCreateIssue'

export const APP_SWITCHER_APPS = [
  {
    id: 'jira-lite',
    name: 'JIRA Lite',
    icon: JiraLiteAppIcon,
    route: '/',
    enabled: true,
    requires: null,
    isDefault: true,
    // JL-153 — what the shared top bar shows while this product is active.
    productName: 'ECM JIRA LITE',
    homePath: '/',
    searchPlaceholder: 'Search issues or JQL (e.g. status = Done AND priority = High)',
    searchLabel: 'Search issues',
    searchKind: 'issues',
    createLabel: 'Create',
    // Summary / Backlog / Reports / List are an ISSUE-context navigation.
    // They belong to this product and must not render in another one.
    showContextTabs: true,
  },
  {
    id: 'confluence-lite',
    name: 'Confluence Lite',
    icon: ConfluenceLiteAppIcon,
    route: '/wiki/home',
    enabled: true,
    requires: WIKI_CAPABILITY,
    // JL-153 — the same slots, answered differently.
    productName: 'Confluence Lite',
    homePath: '/wiki/home',
    searchPlaceholder: 'Search pages',
    searchLabel: 'Search pages',
    searchKind: 'pages',
    createLabel: 'Create',
    // Jira's Create opens a modal owned by App.jsx. The wiki's is a real
    // address instead, so it is deep-linkable and needs no callback threaded
    // up past the layout that owns the page.
    createPath: '/wiki/new',
    showContextTabs: false,
    // /wiki, and the per-project wiki the Wiki tab links to.
    match: /^\/wiki(\/|$)|^\/projects\/[^/]+\/wiki(\/|$)/,
  },
]

/**
 * The apps this user may see, in declaration order.
 *
 * @param {object} permissions result of usePermissions()
 * @param {Array}  [apps]      override, for tests
 */
export function visibleApps(permissions, apps = APP_SWITCHER_APPS) {
  return apps.filter(
    (app) => app.enabled !== false && (!app.requires || Boolean(permissions?.[app.requires])),
  )
}

/**
 * Which app the given pathname belongs to. The first app whose `match` hits
 * wins; anything unmatched falls to the app flagged `isDefault` (JIRA Lite —
 * the tracker owns every route that is not somebody else's).
 *
 * Returns null when the default app is filtered out for this user, so the
 * caller marks nothing rather than marking the wrong row.
 */
export function resolveActiveAppId(pathname, apps = APP_SWITCHER_APPS) {
  const path = typeof pathname === 'string' && pathname ? pathname : '/'
  const matched = apps.find((app) => app.match instanceof RegExp && app.match.test(path))
  if (matched) return matched.id
  const fallback = apps.find((app) => app.isDefault)
  return fallback ? fallback.id : null
}

/**
 * JL-153 — the product surface a pathname belongs to.
 *
 * ONE registry, read by both the app switcher and RootLayout. The alternative
 * was a second list of path prefixes in the layout code, and two lists
 * describing the same products is how ProjectTopPanel's HIDDEN_ROUTES drifted
 * from reality — every new route became a route somebody had to remember to
 * add to a list living somewhere else.
 *
 * Permission filtering is deliberately NOT applied here. Which product a URL
 * belongs to is a fact about the URL; whether this user may open it is a
 * separate question the route guards answer. Filtering here would resolve a
 * forbidden /wiki path to the Jira product and wrap it in Jira chrome.
 */
export function productForPath(pathname) {
  const id = resolveActiveAppId(pathname, APP_SWITCHER_APPS)
  return APP_SWITCHER_APPS.find((app) => app.id === id) || null
}
