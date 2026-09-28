import { useEffect } from 'react'

/*
 * JL-101 — make <img> tags that point at an authenticated endpoint render.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 *
 * An uploaded image lives behind GET /api/wiki/:pageId/attachments/:id/download,
 * which requires a Bearer header. An <img src> cannot send one, so the browser
 * gets a 401 and shows a broken image.
 *
 * ── Why not a signed URL ────────────────────────────────────────────────────
 *
 * The obvious fix is a short-lived signed query parameter. It was rejected:
 * Phase 8 deliberately keeps attachment bytes behind a route that re-checks
 * the page's visibility on every request, precisely so no URL exists that
 * grants access on its own. A signed URL is a capability, and page content is
 * the most-copied text in the product — it would end up pasted into chat, and
 * would work there for whoever received it.
 *
 * ── What this does instead ──────────────────────────────────────────────────
 *
 * The stored content keeps the canonical relative URL, which is what makes it
 * portable and what the sanitiser's scheme allow-list already permits. At
 * RENDER time this fetches each image with the Bearer header and swaps in a
 * blob: URL. The blob is per-document and dies with the page view, so nothing
 * durable is handed out.
 *
 * `data-src` holds the original so a re-run does not re-fetch what it already
 * swapped, and so the canonical URL is never lost from the DOM.
 */

const TOKEN_KEY = 'jira_auth_token'
/** Only our own API is hydrated. An external https:// image already works. */
const AUTHED_PREFIX = '/api/wiki/'

function authHeader() {
  try {
    const token = window.localStorage.getItem(TOKEN_KEY) || window.sessionStorage.getItem(TOKEN_KEY)
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    // Storage throws outright in some contexts (private windows, blocked data).
    return {}
  }
}

/**
 * Hydrate authenticated <img> tags inside `ref`.
 *
 * @param {React.RefObject<HTMLElement>} ref  container to scan
 * @param {Array} deps  re-run when the rendered content changes
 */
export function useAuthedImages(ref, deps = []) {
  useEffect(() => {
    const root = ref?.current
    if (!root) return undefined

    let cancelled = false
    const created = []

    const targets = [...root.querySelectorAll('img')].filter((img) => {
      const raw = img.getAttribute('src') || ''
      // Already swapped, or not ours.
      return raw.startsWith(AUTHED_PREFIX)
    })

    for (const img of targets) {
      const src = img.getAttribute('src')
      // Keep the canonical URL on the element so it survives the swap.
      img.setAttribute('data-src', src)

      fetch(src, { headers: authHeader() })
        .then((res) => (res.ok ? res.blob() : null))
        .then((blob) => {
          if (cancelled || !blob) return
          const url = URL.createObjectURL(blob)
          created.push(url)
          img.setAttribute('src', url)
        })
        .catch(() => {
          /*
           * A failed image is left with its original src, which renders as
           * broken — correct, and visible. Silently removing it would hide
           * from the author that their image is gone.
           */
        })
    }

    return () => {
      cancelled = true
      // Revoking is what actually frees the bytes; without it they stay held
      // for the life of the document.
      for (const url of created) URL.revokeObjectURL(url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps])
}

export default useAuthedImages
