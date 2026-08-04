import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'

// JL-344 — stored XSS regression tests for the Knowledge Base article viewer.
//
// KB articles are authored by one user and rendered to every other user through
// `dangerouslySetInnerHTML`, so anything renderMarkdown() emits executes in the
// reader's session. These tests drive the real page component (not a helper in
// isolation) so they cover the exact injection point.

const TAB = String.fromCharCode(9)

const article = { id: 1, title: 'Payload article', status: 'published', body: '' }

vi.mock('../api/kbApi', () => ({
  fetchKbCategories: vi.fn().mockResolvedValue([]),
  createKbCategory: vi.fn().mockResolvedValue({}),
  fetchKbArticles: vi.fn().mockResolvedValue([
    { id: 1, title: 'Payload article', status: 'published', views: 0 },
  ]),
  fetchKbArticle: vi.fn(() => Promise.resolve(article)),
  createKbArticle: vi.fn().mockResolvedValue({}),
  updateKbArticle: vi.fn().mockResolvedValue({}),
  deleteKbArticle: vi.fn().mockResolvedValue({}),
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    loaded: true,
    isAdmin: false,
    isOwner: false,
    canCreateIssue: false,
    canEditIssue: false,
  }),
}))

import { KnowledgeBasePage } from '../pages/KnowledgeBasePage/KnowledgeBasePage'

/** Render the page, open the single article, return its rendered body element. */
async function renderBody(body) {
  article.body = body
  render(<KnowledgeBasePage />)
  fireEvent.click(await screen.findByText('Payload article'))
  await waitFor(() => {
    expect(document.querySelector('.kb-article-body')).toBeTruthy()
  })
  return document.querySelector('.kb-article-body')
}

/** Every attribute name present anywhere inside the rendered article body. */
function allAttributeNames(el) {
  const names = []
  el.querySelectorAll('*').forEach((node) => {
    for (const attr of node.attributes) names.push(attr.name.toLowerCase())
  })
  return names
}

/**
 * A URL's scheme with every whitespace/control character removed — browsers
 * strip TAB/LF/CR from URLs before resolving them, so "java<TAB>script:" must
 * be treated as "javascript:".
 */
function normalizeUrl(value) {
  return Array.from(String(value))
    .filter((ch) => ch.charCodeAt(0) > 32)
    .join('')
    .toLowerCase()
}

/** Attribute values anywhere in the body that resolve to an executable URL. */
function executableUrlAttributes(el) {
  const bad = []
  el.querySelectorAll('*').forEach((node) => {
    for (const attr of node.attributes) {
      const v = normalizeUrl(attr.value)
      if (/^(javascript|data|vbscript):/.test(v)) bad.push(`${attr.name}=${attr.value}`)
    }
  })
  return bad
}

function expectNoExecutableMarkup(bodyEl) {
  // No event-handler attribute survived anywhere in the rendered article.
  expect(allAttributeNames(bodyEl).filter((n) => n.startsWith('on'))).toEqual([])
  // No attribute resolves to a javascript:/data:/vbscript: URL.
  expect(executableUrlAttributes(bodyEl)).toEqual([])
  // No element capable of running script or loading remote content.
  expect(bodyEl.querySelectorAll('script, img, iframe, svg, style').length).toBe(0)
}

beforeEach(() => {
  cleanup()
})

describe('KnowledgeBasePage stored XSS (JL-344)', () => {
  it('does not emit an event handler when a link URL breaks out of the href attribute', async () => {
    // The exact reported payload: the `"` closes href early, and the markdown
    // link regex ([^)]+) happily swallows it.
    const bodyEl = await renderBody('[click](https://x" onmouseover="alert(document.cookie))')

    const anchor = bodyEl.querySelector('a')
    expect(anchor).toBeTruthy() // the link still renders, just inertly
    expect(anchor.getAttribute('onmouseover')).toBeNull()
    // The anchor carries only the attributes the renderer intends — the
    // injected handler must not have become a real attribute. (Before the fix
    // this list was ['href', 'onmouseover', 'target', 'rel'].)
    expect(Array.from(anchor.attributes).map((a) => a.name)).toEqual([
      'href', 'target', 'rel',
    ])
    expectNoExecutableMarkup(bodyEl)
  })

  it('does not emit a javascript: href, even smuggled in via attribute breakout', async () => {
    const bodyEl = await renderBody('[click](https://x" href="javascript:alert(1))')

    const anchor = bodyEl.querySelector('a')
    // The href must still be the http(s) URL the link rule captured — the
    // smuggled second href must never become an attribute of its own.
    expect(normalizeUrl(anchor?.getAttribute('href')).startsWith('https://')).toBe(true)
    expect(Array.from(anchor.attributes).map((a) => a.name)).toEqual([
      'href', 'target', 'rel',
    ])
    expectNoExecutableMarkup(bodyEl)
  })

  it('does not emit an obfuscated (control-char) javascript: href', async () => {
    // Browsers strip TAB/LF/CR from URLs, so "java<TAB>script:" is executable
    // if a sanitizer only string-matches "javascript:".
    const bodyEl = await renderBody(`[click](https://x" href="java${TAB}script:alert(1))`)

    const anchor = bodyEl.querySelector('a')
    expect(normalizeUrl(anchor?.getAttribute('href')).startsWith('https://')).toBe(true)
    expectNoExecutableMarkup(bodyEl)
  })

  it('renders raw HTML in the article body as inert text (<img onerror>, <script>)', async () => {
    const bodyEl = await renderBody(
      '<img src=x onerror="alert(1)">\n<script>alert(document.cookie)</script>',
    )

    expectNoExecutableMarkup(bodyEl)
    // The <img> markup is visible as literal text rather than parsed as an element.
    expect(bodyEl.textContent).toContain('<img')
  })

  it('still renders legitimate markdown correctly', async () => {
    const bodyEl = await renderBody(
      '# Title\n## Sub\n### Small\n' +
      'Some **bold** and *italic* and `code()` text.\n' +
      '[docs](https://example.com/help?a=1&b=2)\n' +
      "[o](https://example.com/O'Brien)",
    )

    expect(bodyEl.querySelector('h1')?.textContent).toBe('Title')
    expect(bodyEl.querySelector('h2')?.textContent).toBe('Sub')
    expect(bodyEl.querySelector('h3')?.textContent).toBe('Small')
    expect(bodyEl.querySelector('strong')?.textContent).toBe('bold')
    expect(bodyEl.querySelector('em')?.textContent).toBe('italic')
    expect(bodyEl.querySelector('code')?.textContent).toBe('code()')
    expect(bodyEl.querySelectorAll('br').length).toBeGreaterThan(0)

    const link = bodyEl.querySelector('a')
    expect(link?.textContent).toBe('docs')
    // Query strings must survive intact — no double-escaped &amp;amp;
    expect(link?.getAttribute('href')).toBe('https://example.com/help?a=1&b=2')
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toContain('noopener')

    const apostropheLink = bodyEl.querySelectorAll('a')[1]
    expect(apostropheLink?.getAttribute('href')).toBe("https://example.com/O'Brien")
  })

  it('preserves quotes and ampersands in article prose as readable text', async () => {
    const bodyEl = await renderBody('She said "hello" & waved <not-a-tag>')

    expect(bodyEl.textContent).toContain('She said "hello" & waved <not-a-tag>')
    expectNoExecutableMarkup(bodyEl)
  })
})
