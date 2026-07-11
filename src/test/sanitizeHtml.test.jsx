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

  it('neutralizes obfuscated javascript: hrefs (whitespace/control chars)', () => {
    const out = sanitizeHtml('<a href=" java\tscript:alert(1)">click</a>')
    expect(out.toLowerCase()).not.toContain('javascript:')
  })

  it('neutralizes data: URIs in href', () => {
    const out = sanitizeHtml('<a href="data:text/html,<script>x</script>">y</a>')
    expect(out).not.toContain('data:')
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
})
