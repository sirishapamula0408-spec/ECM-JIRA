import { describe, it, expect } from 'vitest'
import {
  htmlToPlainText,
  isEmptyDoc,
  looksLikeHtml,
  decodeEntities,
  sanitizeHtml,
} from '../utils/editorContent'

// JL-135 — pure helper tests. These MUST run without mounting TipTap.

describe('htmlToPlainText', () => {
  it('strips tags and returns text content', () => {
    expect(htmlToPlainText('<p>Hello <strong>world</strong></p>')).toBe('Hello world')
  })

  it('turns block closers and <br> into newlines', () => {
    expect(htmlToPlainText('<p>a</p><p>b</p>')).toBe('a\nb')
    expect(htmlToPlainText('line1<br>line2')).toBe('line1\nline2')
    expect(htmlToPlainText('line1<br/>line2')).toBe('line1\nline2')
  })

  it('flattens list items to separate lines', () => {
    expect(htmlToPlainText('<ul><li>one</li><li>two</li></ul>')).toBe('one\ntwo')
  })

  it('decodes common entities', () => {
    expect(htmlToPlainText('<p>a &amp; b &lt;c&gt;</p>')).toBe('a & b <c>')
  })

  it('drops script/style content', () => {
    expect(htmlToPlainText('<p>ok</p><script>alert(1)</script>')).toBe('ok')
  })

  it('handles null/undefined/empty gracefully', () => {
    expect(htmlToPlainText(null)).toBe('')
    expect(htmlToPlainText(undefined)).toBe('')
    expect(htmlToPlainText('')).toBe('')
  })

  it('collapses excess whitespace', () => {
    expect(htmlToPlainText('<p>a    b\t\tc</p>')).toBe('a b c')
  })
})

describe('isEmptyDoc', () => {
  it('is true for empty and TipTap-empty markup', () => {
    expect(isEmptyDoc('')).toBe(true)
    expect(isEmptyDoc('<p></p>')).toBe(true)
    expect(isEmptyDoc('<p><br></p>')).toBe(true)
    expect(isEmptyDoc('<p><br/></p>')).toBe(true)
    expect(isEmptyDoc('   ')).toBe(true)
    expect(isEmptyDoc('<p>&nbsp;</p>')).toBe(true)
    expect(isEmptyDoc(null)).toBe(true)
    expect(isEmptyDoc(undefined)).toBe(true)
  })

  it('is false for real content', () => {
    expect(isEmptyDoc('<p>Hi</p>')).toBe(false)
    expect(isEmptyDoc('<h1>Title</h1>')).toBe(false)
    expect(isEmptyDoc('plain text')).toBe(false)
    expect(isEmptyDoc('<ul><li>x</li></ul>')).toBe(false)
  })
})

describe('looksLikeHtml', () => {
  it('detects markup', () => {
    expect(looksLikeHtml('<p>hi</p>')).toBe(true)
    expect(looksLikeHtml('<br/>')).toBe(true)
  })
  it('is false for plain text / markdown', () => {
    expect(looksLikeHtml('just text')).toBe(false)
    expect(looksLikeHtml('**bold** markdown')).toBe(false)
    expect(looksLikeHtml('')).toBe(false)
  })
})

describe('decodeEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('a &amp; b')).toBe('a & b')
    expect(decodeEntities('&#65;&#66;')).toBe('AB')
    expect(decodeEntities('&#x41;')).toBe('A')
  })
})

describe('sanitizeHtml', () => {
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
})
