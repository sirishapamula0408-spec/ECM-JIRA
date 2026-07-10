import { describe, it, expect, vi } from 'vitest'
import { escapeHtml, buildIssuePrintHtml, openPrintWindow } from '../utils/printDocument'

describe('escapeHtml', () => {
  it('escapes HTML-significant characters', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    )
    expect(escapeHtml("a & b '</'")).toBe('a &amp; b &#39;&lt;/&#39;')
  })

  it('returns empty string for null/undefined', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})

describe('buildIssuePrintHtml', () => {
  const issue = {
    id: 7,
    key: 'PROJ-7',
    title: 'Fix the login bug',
    status: 'In Progress',
    assignee: 'Ada Lovelace',
    priority: 'High',
    issueType: 'Bug',
    description: 'Steps to reproduce.',
  }

  it('returns a complete HTML document string with inline styles', () => {
    const html = buildIssuePrintHtml(issue)
    expect(typeof html).toBe('string')
    expect(html).toContain('<html')
    expect(html).toContain('<style')
    expect(html).toContain('@media print')
  })

  it('includes the issue key, title and status', () => {
    const html = buildIssuePrintHtml(issue)
    expect(html).toContain('PROJ-7')
    expect(html).toContain('Fix the login bug')
    expect(html).toContain('In Progress')
    expect(html).toContain('Ada Lovelace')
    expect(html).toContain('High')
  })

  it('escapes a <script>/< in the title so there is no raw injection', () => {
    const html = buildIssuePrintHtml({
      ...issue,
      title: '<script>alert(1)</script>',
    })
    // Raw tag must not appear; escaped form must.
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('escapes < in the description', () => {
    const html = buildIssuePrintHtml({
      ...issue,
      description: 'a < b && c > d',
    })
    expect(html).toContain('a &lt; b &amp;&amp; c &gt; d')
    expect(html).not.toContain('a < b && c > d')
  })

  it('renders assigned labels as escaped chips', () => {
    const html = buildIssuePrintHtml(issue, {
      labels: [{ name: '<bad>', color: '#ff0000' }],
    })
    expect(html).toContain('&lt;bad&gt;')
    expect(html).not.toContain('<bad>')
  })

  it('does not throw for a null/empty issue', () => {
    const html = buildIssuePrintHtml(null)
    expect(html).toContain('<html')
    expect(html).toContain('(untitled)')
  })
})

describe('openPrintWindow', () => {
  it('uses the injected windowFactory, writes the html, and calls the injected print fn', () => {
    const write = vi.fn()
    const fakeWin = {
      document: { open: vi.fn(), write, close: vi.fn() },
      focus: vi.fn(),
    }
    const windowFactory = vi.fn(() => fakeWin)
    const print = vi.fn()

    const html = '<!doctype html><html><body>hi</body></html>'
    const result = openPrintWindow(html, { windowFactory, print })

    expect(windowFactory).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(html)
    expect(print).toHaveBeenCalledTimes(1)
    expect(print).toHaveBeenCalledWith(fakeWin)
    expect(result).toBe(fakeWin)
  })

  it('returns null gracefully when the factory returns null (popup blocked)', () => {
    const print = vi.fn()
    const result = openPrintWindow('<html></html>', {
      windowFactory: () => null,
      print,
    })
    expect(result).toBeNull()
    expect(print).not.toHaveBeenCalled()
  })
})
