/*
 * JL-187 (fosasoft) — building a page's table of contents at view time.
 *
 * Kept apart from the editor's TipTap blocks (components/editor/extensions/
 * pageBlocks.js) on purpose: the page VIEW needs this, and importing it from
 * there would pull TipTap into the main bundle for every reader.
 */

/** A URL fragment for a heading: lowercase words joined by hyphens. */
export function headingSlug(text, used) {
  const base = String(text).toLowerCase().trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-') || 'section'
  let slug = base
  for (let n = 2; used.has(slug); n += 1) slug = `${base}-${n}`
  used.add(slug)
  return slug
}

/**
 * Fill every table-of-contents marker under `root` with links to the
 * headings that follow it on the page, giving each heading an id to link to.
 * Runs on the RENDERED page, after sanitizeHtml, and builds nodes with
 * textContent, so no stored text is ever interpreted as markup.
 */
export function fillTablesOfContents(root) {
  if (!root) return
  const markers = root.querySelectorAll('div[data-type="toc"]')
  if (!markers.length) return
  const used = new Set()
  const headings = [...root.querySelectorAll('h1, h2, h3')]
  for (const heading of headings) {
    if (!heading.id) heading.id = headingSlug(heading.textContent, used)
  }
  for (const marker of markers) {
    marker.replaceChildren()
    const title = document.createElement('p')
    title.className = 'page-toc__title'
    title.textContent = 'Contents'
    marker.append(title)
    if (!headings.length) {
      const empty = document.createElement('p')
      empty.className = 'page-toc__empty'
      empty.textContent = 'This page has no headings yet.'
      marker.append(empty)
      continue
    }
    const list = document.createElement('ul')
    for (const heading of headings) {
      const item = document.createElement('li')
      item.className = `page-toc__item page-toc__item--${heading.tagName.toLowerCase()}`
      const link = document.createElement('a')
      link.href = `#${heading.id}`
      link.textContent = heading.textContent
      item.append(link)
      list.append(item)
    }
    marker.append(list)
  }
}
