import { describe, it, expect } from 'vitest'
import { sanitizeHtml } from '../utils/sanitizeHtml'

describe('sanitizeHtml (JL-91)', () => {
  it('strips <script> tags and their contents', () => {
    const out = sanitizeHtml('<b>hi</b><script>alert(1)</script>')
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toContain('alert(1)')
    expect(out).toContain('<b>hi</b>')
  })

  it('strips <style> and <iframe> elements entirely', () => {
    expect(sanitizeHtml('<style>body{}</style>ok')).toBe('ok')
    const iframe = sanitizeHtml('<iframe src="evil"></iframe>text')
    expect(iframe).not.toMatch(/<iframe/i)
    expect(iframe).toContain('text')
  })

  it('removes on* event-handler attributes', () => {
    const out = sanitizeHtml('<a href="https://x" onclick="steal()">x</a>')
    expect(out).not.toMatch(/onclick/i)
    expect(out).not.toContain('steal()')
    expect(out).toContain('href="https://x"')
  })

  it('escapes tags with only an event handler and no allow-listed use (img)', () => {
    const out = sanitizeHtml('<img src=x onerror=alert(1)>')
    // img is not on the allow-list → escaped as literal text, never executes
    expect(out).not.toMatch(/<img/i)
    expect(out).toContain('&lt;img')
  })

  it('neutralizes javascript: hrefs', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>')
    expect(out).not.toContain('javascript:')
    // tag kept, href dropped, text preserved
    expect(out).toContain('<a>click</a>')
  })

  // JL-358: this test used to assert only that the output did not contain the
  // literal substring "javascript:". That assertion was satisfied purely by the
  // TAB sitting in the middle of the scheme — the href survived untouched and
  // the link still executed, because browsers strip TAB/LF/CR from URLs before
  // resolving them. The test passed while the vulnerability was live.
  //
  // The correct assertion is on the *browser-normalized* URL: strip control
  // characters the way a browser does, then check no executable scheme remains.
  // We also assert the href attribute is dropped outright, which is what the
  // sanitizer actually does with an unsafe URL.

  /** A URL as a browser would see it: control characters removed, lowercased. */
  const asBrowserSees = (value) =>
    // eslint-disable-next-line no-control-regex
    String(value).replace(/[\u0000-\u001F\u007F]/g, '').toLowerCase()

  it('neutralizes obfuscated javascript: hrefs (whitespace/control chars)', () => {
    const out = sanitizeHtml('<a href=" java\tscript:alert(1)">click</a>')
    // href must be gone entirely — tag and text kept, URL dropped.
    expect(out).toBe('<a>click</a>')
    expect(out).not.toMatch(/href/i)
    // …and nothing that a browser would read as javascript: may remain.
    expect(asBrowserSees(out)).not.toContain('javascript:')
  })

  it.each([
    ['TAB', '\t'],
    ['newline', '\n'],
    ['carriage return', '\r'],
    ['NUL', '\u0000'],
    ['vertical tab', '\u000B'],
    ['form feed', '\u000C'],
  ])('neutralizes a javascript: href split by %s', (_label, ch) => {
    const out = sanitizeHtml(`<a href="java${ch}script:alert(1)">click</a>`)
    expect(out).toBe('<a>click</a>')
    expect(asBrowserSees(out)).not.toContain('javascript:')
  })

  it('neutralizes control-char obfuscated data: and vbscript: hrefs', () => {
    expect(asBrowserSees(sanitizeHtml('<a href="da\tta:text/plain,x">y</a>')))
      .not.toContain('data:')
    expect(asBrowserSees(sanitizeHtml('<a href="vb\nscript:msgbox(1)">y</a>')))
      .not.toContain('vbscript:')
  })

  it('still keeps legitimate URLs that merely contain hyphens or look odd', () => {
    // The normalization strips characters only to compare the scheme; it must
    // not cause safe URLs to be rejected.
    for (const url of [
      'https://example.com/my-page?a=1&b=2',
      'http://example.com',
      'mailto:someone@example.com',
      '/relative/path',
      '#anchor',
      'my-doc.html',
    ]) {
      expect(sanitizeHtml(`<a href="${url}">x</a>`)).toContain('href=')
    }
  })

  it('neutralizes data: URIs in href', () => {
    const out = sanitizeHtml('<a href="data:text/html,<script>x</script>">y</a>')
    expect(out).not.toContain('data:')
  })

  // JL-368: the URL check was a deny-list (javascript:/data:/vbscript:) while
  // the rest of the module allow-lists. Every unnamed scheme passed. `blob:`
  // is the one that mattered: a same-origin blob: URL of type text/html
  // executes script when navigated to, so it was a live stored-XSS vector that
  // the sanitizer waved through. These cases FAIL against the deny-list code.
  describe('URL scheme allow-list (JL-368)', () => {
    it.each([
      ['blob', 'blob:https://app.example.com/8f2e-1234'],
      ['file', 'file:///c:/windows/system32/'],
      ['about', 'about:blank'],
      ['tel', 'tel:+15550100'],
      ['ftp', 'ftp://files.example.com/x'],
    ])('drops a %s: href (not on the scheme allow-list)', (_label, url) => {
      const out = sanitizeHtml(`<a href="${url}">click</a>`)
      // The anchor and its text survive; only the URL is removed.
      expect(out).toBe('<a>click</a>')
      expect(out).not.toMatch(/href/i)
    })

    it('drops a blob: href even when control-char obfuscated', () => {
      // The JL-358 normalization runs first, so the allow-list sees "blob:".
      const out = sanitizeHtml('<a href="bl\tob:https://app/1">click</a>')
      expect(out).toBe('<a>click</a>')
    })

    it.each([
      ['https absolute', 'https://example.com/docs'],
      ['http absolute', 'http://example.com'],
      ['mailto', 'mailto:someone@example.com'],
      ['root-relative', '/projects/1/board'],
      ['in-page anchor', '#acceptance-criteria'],
      ['query-only', '?tab=history'],
      ['path-relative', 'my-doc.html'],
    ])('keeps a %s href', (_label, url) => {
      const out = sanitizeHtml(`<a href="${url}">x</a>`)
      expect(out).toContain(`href="${url}"`)
    })

    // A protocol-relative URL looks root-relative but resolves to a foreign
    // origin, so a naive startsWith('/') allow test would pass it. Backslash
    // variants matter too: for special schemes the URL parser maps `\` to `/`,
    // so all four of these resolve to https://evil.com.
    it.each([
      ['//evil.com/x'],
      ['\\\\evil.com/x'],
      ['/\\evil.com/x'],
      ['\\/evil.com/x'],
    ])('drops the protocol-relative href %s', (url) => {
      const out = sanitizeHtml(`<a href="${url}">click</a>`)
      expect(out).toBe('<a>click</a>')
    })

    it('still keeps a single leading slash or backslash (same-origin)', () => {
      expect(sanitizeHtml('<a href="/foo">x</a>')).toContain('href="/foo"')
    })

    it('does not mistake a colon inside a relative path for a scheme', () => {
      const out = sanitizeHtml('<a href="docs/ratio:1/page">x</a>')
      expect(out).toContain('href="docs/ratio:1/page"')
    })

    it('drops an empty href', () => {
      expect(sanitizeHtml('<a href="">x</a>')).toBe('<a>x</a>')
    })
  })

  it('keeps allowed tags and their text', () => {
    const input =
      '<p>Para</p><strong>bold</strong><em>it</em><ul><li>a</li></ul>' +
      '<h1>Head</h1><blockquote>q</blockquote><code>c</code><pre>p</pre><br/>'
    const out = sanitizeHtml(input)
    expect(out).toContain('<p>Para</p>')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<em>it</em>')
    expect(out).toContain('<li>a</li>')
    expect(out).toContain('<h1>Head</h1>')
    expect(out).toContain('<blockquote>q</blockquote>')
    expect(out).toContain('<code>c</code>')
  })

  it('keeps a safe href on anchors', () => {
    const out = sanitizeHtml('<a href="https://example.com" target="_blank" rel="noopener">e</a>')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener"')
  })

  it('escapes disallowed tags into literal text', () => {
    const out = sanitizeHtml('<div>hello</div>')
    expect(out).toBe('&lt;div&gt;hello&lt;/div&gt;')
  })

  it('does not treat plain "a < b" text as markup', () => {
    expect(sanitizeHtml('a < b and 2 > 1')).toBe('a < b and 2 > 1')
  })

  it('strips disallowed attributes (e.g. style) from allowed tags', () => {
    const out = sanitizeHtml('<strong style="font-size:2em">x</strong>')
    expect(out).toBe('<strong>x</strong>')
  })

  it('returns empty string for nullish input', () => {
    expect(sanitizeHtml(null)).toBe('')
    expect(sanitizeHtml(undefined)).toBe('')
    expect(sanitizeHtml('')).toBe('')
  })

  /**
   * Parse sanitized output the way a browser would and list every live event
   * handler attribute on it. Substring assertions cannot tell an inert
   * `&quot;onclick=&quot;` sitting inside an escaped attribute value from a
   * real handler; the DOM can. Returns e.g. ['a.onclick'].
   */
  const liveEventHandlers = (html) => {
    const host = document.createElement('div')
    host.innerHTML = html
    const found = []
    for (const el of host.querySelectorAll('*')) {
      for (const attr of el.attributes) {
        if (attr.name.toLowerCase().startsWith('on')) {
          found.push(`${el.tagName.toLowerCase()}.${attr.name.toLowerCase()}`)
        }
      }
    }
    return found
  }

  // ---------------------------------------------------------------------
  // JL-359 — consolidation of the two sanitizers.
  //
  // The codebase carried a second, DOM-based sanitizer in
  // utils/editorContent.js with a different allow-list and a weaker URL check.
  // It has been deleted and its consumers (IssueDetailPage, TipTapEditor)
  // migrated here. The blocks below are the acceptance evidence:
  //   1. every assertion from the deleted module's test suite, ported;
  //   2. the allow-list entries that only IT used (table, class, title);
  //   3. the anchor rel/target hardening that only IT did;
  //   4. explicit regressions for the two fixes THIS module carries
  //      (JL-344 attribute breakout, JL-368 URL allow-list), now proving the
  //      migrated call sites are covered by them too.
  // ---------------------------------------------------------------------

  describe('ported from the deleted editorContent sanitizer (JL-359)', () => {
    it('removes script tags', () => {
      const out = sanitizeHtml('<p>ok</p><script>alert(1)</script>')
      expect(out).not.toMatch(/script/i)
      expect(out).toMatch(/ok/)
    })

    it('strips inline event handlers', () => {
      const out = sanitizeHtml('<p onclick="evil()">hi</p>')
      expect(out).not.toMatch(/onclick/i)
      expect(out).toMatch(/hi/)
    })

    it('drops javascript: hrefs', () => {
      const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>')
      expect(out).not.toMatch(/javascript:/i)
    })

    it('keeps allowed formatting tags', () => {
      const out = sanitizeHtml('<p><strong>bold</strong> <em>it</em></p>')
      expect(out).toMatch(/<strong>/)
      expect(out).toMatch(/<em>/)
    })

    it('handles null/empty', () => {
      expect(sanitizeHtml(null)).toBe('')
      expect(sanitizeHtml('')).toBe('')
    })

    it('drops HTML comments, as the DOM sanitizer did by removing comment nodes', () => {
      expect(sanitizeHtml('<p>a</p><!-- secret -->')).toBe('<p>a</p>')
      // An unterminated comment ran to end-of-input in a browser too.
      expect(sanitizeHtml('<p>a</p><!-- dangling')).toBe('<p>a</p>')
    })
  })

  describe('unioned allow-list: entries inherited from the deleted sanitizer (JL-359)', () => {
    it('keeps table markup (IssueDetailPage renders stored/pasted tables)', () => {
      const out = sanitizeHtml(
        '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>C</td></tr></tbody></table>'
      )
      expect(out).toBe(
        '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>C</td></tr></tbody></table>'
      )
    })

    it('keeps class on any allowed tag (TipTap emits it on code blocks/lists)', () => {
      expect(sanitizeHtml('<pre><code class="language-js">x</code></pre>'))
        .toBe('<pre><code class="language-js">x</code></pre>')
      expect(sanitizeHtml('<p class="tte-para">x</p>')).toBe('<p class="tte-para">x</p>')
    })

    it('keeps title on anchors', () => {
      const out = sanitizeHtml('<a href="https://example.com" title="Docs">x</a>')
      expect(out).toContain('title="Docs"')
    })

    it('keeps hr, s and strike', () => {
      expect(sanitizeHtml('<hr>')).toBe('<hr/>')
      expect(sanitizeHtml('<s>a</s><strike>b</strike>')).toBe('<s>a</s><strike>b</strike>')
    })

    it('still escapes a class-bearing tag that is NOT allow-listed', () => {
      // `class` being global must not smuggle in the element carrying it.
      expect(sanitizeHtml('<div class="x">hi</div>')).toBe('&lt;div class=&quot;x&quot;&gt;hi&lt;/div&gt;')
    })

    it('escapes a class attribute value so it cannot break out of the quotes', () => {
      const out = sanitizeHtml('<p class=\'a" onmouseover="alert(1)\'>x</p>')
      // The handler text survives *inside* the escaped class value, which is
      // inert. What matters is that no element ends up with a live handler, so
      // assert on the parsed DOM rather than on the string.
      expect(liveEventHandlers(out)).toEqual([])
      expect(out).toContain('&quot;')
    })
  })

  // The deleted DOM sanitizer stamped rel="noopener noreferrer" and defaulted
  // target="_blank" on every anchor keeping an href. Losing that on migration
  // would reopen reverse-tabnabbing (window.opener) for IssueDetailPage
  // content, so the invariant is reproduced and asserted here.
  describe('anchor rel/target hardening (JL-359)', () => {
    it('adds target and rel to a bare anchor', () => {
      expect(sanitizeHtml('<a href="https://example.com">x</a>'))
        .toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>')
    })

    it('tops up an author rel that lacks noopener', () => {
      const out = sanitizeHtml('<a href="https://example.com" target="_blank" rel="nofollow">x</a>')
      expect(out).toContain('rel="nofollow noopener"')
    })

    it('leaves an author rel that already has noopener untouched', () => {
      const out = sanitizeHtml('<a href="https://x" target="_blank" rel="noopener noreferrer">x</a>')
      expect(out).toContain('rel="noopener noreferrer"')
    })

    it('never emits an anchor that keeps a URL without noopener', () => {
      for (const input of [
        '<a href="https://example.com">x</a>',
        '<a href="/projects/1">x</a>',
        '<a href="https://x" rel="">x</a>',
        '<a href="https://x" rel="nofollow">x</a>',
        '<a href="https://x" target="_self">x</a>',
      ]) {
        expect(sanitizeHtml(input)).toMatch(/rel="[^"]*\bnoopener\b[^"]*"/)
      }
    })

    it('does not add target/rel when the URL was rejected', () => {
      expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>')
      expect(sanitizeHtml('<a href="blob:https://app/1">x</a>')).toBe('<a>x</a>')
    })

    // Collecting attributes into a Map (needed so hardening can inspect what
    // survived) means a repeated attribute collapses to one. Assert the
    // survivor is always a scheme-checked value, in either order — a duplicate
    // href is a classic way to slip a second, unchecked URL past a sanitizer
    // that emits every attribute it sees.
    it('collapses a duplicated href and keeps only the safe value', () => {
      expect(sanitizeHtml('<a href="https://ok" href="javascript:alert(1)">x</a>'))
        .toBe('<a href="https://ok" target="_blank" rel="noopener noreferrer">x</a>')
      expect(sanitizeHtml('<a href="javascript:alert(1)" href="https://ok">x</a>'))
        .toBe('<a href="https://ok" target="_blank" rel="noopener noreferrer">x</a>')
    })
  })

  // JL-344 was a stored XSS in the Knowledge Base: an article body of
  // `[click](https://x" onmouseover="alert(document.cookie))` closed the href
  // early and emitted a live event handler. KnowledgeBasePage escapes `"` at
  // the source now, and this sanitizer is the second line of defence. These
  // assert the sanitizer alone stops it — so the two call sites that do NOT
  // pre-escape (RichTextEditor, IssueDetailPage) are covered as well.
  describe('attribute breakout (JL-344 regression)', () => {
    it('drops the handler when a quote breaks out of the href', () => {
      const out = sanitizeHtml('<a href="https://x" onmouseover="alert(document.cookie)">click</a>')
      expect(out).not.toMatch(/onmouseover/i)
      expect(out).not.toContain('document.cookie')
      expect(out).toContain('href="https://x"')
    })

    it('re-escapes a quote smuggled inside a single-quoted href', () => {
      const out = sanitizeHtml('<a href=\'https://x" onmouseover="alert(1)\'>click</a>')
      // The quote is entity-escaped, so it cannot terminate the attribute and
      // the handler never becomes one — verified against the parsed DOM.
      expect(liveEventHandlers(out)).toEqual([])
      expect(out).toContain('&quot;')
    })

    it('drops on* handlers whatever their casing or spacing', () => {
      for (const input of [
        '<a href="https://x" OnClick="e()">c</a>',
        '<a href="https://x" onclick = "e()">c</a>',
        '<p ONMOUSEOVER="e()">c</p>',
      ]) {
        expect(liveEventHandlers(sanitizeHtml(input))).toEqual([])
      }
    })

    it('holds for the exact KB payload shape, unescaped', () => {
      // What renderMarkdown would emit if its source-level escaping regressed.
      const out = sanitizeHtml(
        '<a href="https://x" onmouseover="alert(document.cookie)" target="_blank" rel="noopener noreferrer">click</a>'
      )
      expect(out).not.toMatch(/on\w+=/i)
      expect(liveEventHandlers(out)).toEqual([])
    })
  })

  // JL-368 converted isSafeUrl from a deny-list to an allow-list. The deleted
  // sanitizer still had the old deny-list (javascript:/data:/vbscript: only),
  // so its consumers were exposed to blob:. Re-asserted here now that those
  // consumers are on this module.
  describe('URL allow-list still holds for the migrated call sites (JL-368)', () => {
    it.each([
      ['javascript', 'javascript:alert(1)'],
      ['blob', 'blob:https://app.example.com/8f2e-1234'],
      ['data', 'data:text/html;base64,PHN2Zy9vbmxvYWQ9YWxlcnQoMSk+'],
      ['vbscript', 'vbscript:msgbox(1)'],
      ['file', 'file:///etc/passwd'],
      ['about', 'about:blank'],
    ])('drops a %s: href', (_label, url) => {
      expect(sanitizeHtml(`<a href="${url}">click</a>`)).toBe('<a>click</a>')
    })

    // An unterminated quoted value ends the tag at the `>` *inside* the value,
    // so the attribute regex finds `href` with nothing parseable after it. On
    // main that emitted a valueless `href`, i.e. the one URL attribute that
    // reached the output without passing isSafeUrl. It was not exploitable (a
    // bare href is an empty URL) but it broke the invariant, so it is now
    // dropped outright.
    it('emits no href at all when the quoted value is unterminated', () => {
      const out = sanitizeHtml('<a href="data:text/html,<b>x</b>">click</a>')
      expect(out).not.toMatch(/href/i)
      expect(out).not.toContain('data:')
      const host = document.createElement('div')
      host.innerHTML = out
      for (const a of host.querySelectorAll('a')) {
        expect(a.hasAttribute('href')).toBe(false)
      }
    })

    it('keeps the URL shapes TipTap and the markdown renderers actually emit', () => {
      for (const url of [
        'https://example.com/docs',
        'http://example.com',
        'mailto:someone@example.com',
        '/projects/1/board',
        '#acceptance-criteria',
      ]) {
        expect(sanitizeHtml(`<a href="${url}">x</a>`)).toContain(`href="${url}"`)
      }
    })
  })

  // The consolidated flow sanitizes the SAME content twice: TipTapEditor
  // sanitizes the editor's HTML before it is saved, and IssueDetailPage
  // sanitizes the stored value again before rendering it. A non-idempotent
  // sanitizer would corrupt content on that round trip (classically by
  // re-escaping its own `&` into `&amp;` until entities pile up), so the
  // property is asserted rather than assumed.
  describe('idempotency (JL-359)', () => {
    it.each([
      ['plain markup', '<p>Plain</p>'],
      ['entities', '<p>a &amp; b &lt;c&gt; &quot;q&quot;</p>'],
      ['bare comparison text', 'a < b and 2 > 1'],
      ['escaped disallowed tag', '<div>unwrapped</div>'],
      ['escaped img payload', '<img src=x onerror=alert(1)>'],
      ['hardened anchor', '<p><a href="https://e.com">l</a></p>'],
      ['code block with entities', '<pre><code class="language-js">a &amp;&amp; b</code></pre>'],
      ['table', '<table><tbody><tr><td>c</td></tr></tbody></table>'],
      ['dropped script', '<p>ok</p><script>alert(1)</script>'],
      ['dropped url', '<a href="javascript:alert(1)">x</a>'],
      ['dropped handler', '<p onclick="e()">h</p>'],
      ['comment', '<!-- c --><p>x</p>'],
      ['void hr', '<hr>'],
    ])('sanitizing %s twice equals sanitizing it once', (_label, input) => {
      const once = sanitizeHtml(input)
      expect(sanitizeHtml(once)).toBe(once)
    })
  })
})
