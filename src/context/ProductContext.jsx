import { createContext, useContext } from 'react'

/*
 * JL-153 — which product surface the user is currently in.
 *
 * JIRA Lite and Confluence Lite share one top bar, and the parts of it that
 * DIFFER (brand, product name, search target, the Create action, whether the
 * Jira contextual tabs exist at all) are supplied by whichever product layout
 * is mounted.
 *
 * Driven by the route tree, never by string-matching the URL inside a
 * component. ProjectTopPanel used to decide via a HIDDEN_ROUTES allow-list of
 * pathnames, which is why it leaked onto /wiki the moment a new surface was
 * added: every new route is a route somebody has to remember to add to a list
 * somewhere else. A layout that declares its own product cannot forget.
 *
 * Repo convention (JL-407): this module holds the context object and the hook
 * and exports NO components — `react-refresh/only-export-components` is an
 * error here. The provider lives in ProductProvider.jsx.
 */

/*
 * The product's shape is DEFINED by the entries in
 * components/appswitcher/appSwitcherApps.js — productName, homePath,
 * searchPlaceholder, searchLabel, searchKind, createLabel, createPath,
 * showContextTabs.
 *
 * A PRODUCT_SHAPE constant used to be restated here as documentation. It was
 * referenced by nothing and had already drifted within a single ticket (it
 * still said "ECM Projects" after the registry moved to "ECM JIRA LITE"),
 * which is the same failure as ProjectTopPanel's HIDDEN_ROUTES: a second
 * description of something that lives elsewhere. Read the registry.
 */

export const ProductContext = createContext(null)

/**
 * The active product. Returns null outside any product layout, which is a
 * legitimate state (the login page, the accept-invite page) — callers must
 * cope rather than assume.
 */
export function useProduct() {
  return useContext(ProductContext)
}
