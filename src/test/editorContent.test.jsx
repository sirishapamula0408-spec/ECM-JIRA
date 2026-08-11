import { describe, it, expect } from 'vitest'
import * as editorContent from '../utils/editorContent'
import {
  htmlToPlainText,
  isEmptyDoc,
  looksLikeHtml,
  decodeEntities,
} from '../utils/editorContent'

// JL-135 — pure helper tests. These MUST run without mounting TipTap.
//
// JL-359 — the `sanitizeHtml` this module used to export has been deleted;
// there is one sanitizer in the codebase and it lives in utils/sanitizeHtml.
// Every assertion that used to live in the `sanitizeHtml` describe below was
// moved verbatim into src/test/sanitizeHtml.test.jsx (see the
// "ported from the deleted editorContent sanitizer" describe there).

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

// JL-359 — the consolidation is only real if the second sanitizer is actually
// gone. If someone re-adds one here, this fails and points at the one module
// that should be extended instead.
describe('no second sanitizer (JL-359)', () => {
  it('does not export sanitizeHtml — use utils/sanitizeHtml', () => {
    expect(editorContent.sanitizeHtml).toBeUndefined()
    expect(Object.keys(editorContent).sort()).toEqual([
      'decodeEntities',
      'htmlToPlainText',
      'isEmptyDoc',
      'looksLikeHtml',
    ])
  })
})
