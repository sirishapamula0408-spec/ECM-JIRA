/**
 * JL-187 (fosasoft) — what the Confluence-style editor writes must survive
 * sanitizeHtml unchanged, and nothing more than that may.
 *
 * Drives the REAL TipTap editor with the page editor's own extension list
 * (buildPageExtensions), so a block added to the editor without a matching
 * sanitizer rule fails here rather than vanishing silently on save.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { sanitizeHtml } from '../utils/sanitizeHtml'
import { buildPageExtensions } from '../components/editor/pageExtensions'
import { PAGE_ELEMENTS, filterElements } from '../components/editor/pageCommands'
import { BUILT_IN_TEMPLATES } from '../components/editor/pageTemplates'
import { headingSlug } from '../utils/tableOfContents'

const editors = []
function makeEditor(content = '') {
  const editor = new Editor({ extensions: buildPageExtensions(), content })
  editors.push(editor)
  return editor
}
afterEach(() => { while (editors.length) editors.pop().destroy() })

/** Save, then reopen and save again: a stable page reads the same both times. */
function roundTrip(editor) {
  const first = sanitizeHtml(editor.getHTML())
  const second = sanitizeHtml(makeEditor(first).getHTML())
  return { first, second }
}

describe('sanitizeHtml — the JL-187 additions', () => {
  it('keeps text-align and colour, and nothing else from a style attribute', () => {
    const out = sanitizeHtml('<p style="text-align: center; position: fixed; background: url(x)">a</p>')
    expect(out).toBe('<p style="text-align: center">a</p>')
    expect(sanitizeHtml('<span style="color: #c9372c">r</span>')).toBe('<span style="color: #c9372c">r</span>')
    expect(sanitizeHtml('<span style="color: rgb(1, 2, 3)">r</span>')).toBe('<span style="color: rgb(1, 2, 3)">r</span>')
  })

  it('drops a colour that is not a plain hex or rgb() value', () => {
    for (const bad of ['expression(alert(1))', 'url(javascript:x)', 'red;background:url(x)', 'var(--x)']) {
      expect(sanitizeHtml(`<span style="color: ${bad}">x</span>`)).toBe('<span>x</span>')
    }
  })

  it('still admits no style on an image or a link', () => {
    expect(sanitizeHtml('<img src="/a.png" style="color:#fff">')).not.toContain('style')
    expect(sanitizeHtml('<a href="/x" style="color:#fff">x</a>')).not.toContain('style')
  })

  it('admits a checkbox and nothing else as an input', () => {
    expect(sanitizeHtml('<input type="checkbox" checked>')).toBe('<input type="checkbox" checked/>')
    expect(sanitizeHtml('<input type="text" value="password">')).toBe('')
    expect(sanitizeHtml('<input>')).toBe('')
    expect(sanitizeHtml('<input type="checkbox" onclick="x()">')).toBe('<input type="checkbox"/>')
  })

  it('keeps the data-* attributes the editor blocks are told apart by', () => {
    const html = '<div data-type="panel" data-panel-type="warning"><p>x</p></div>'
    expect(sanitizeHtml(html)).toBe(html)
    expect(sanitizeHtml('<span data-type="mention" data-id="a@x.com" data-label="Ann">@Ann</span>'))
      .toBe('<span data-type="mention" data-id="a@x.com" data-label="Ann">@Ann</span>')
  })

  it('keeps details/summary for an expand section', () => {
    const html = '<details open><summary>More</summary><div data-type="detailsContent"><p>x</p></div></details>'
    expect(sanitizeHtml(html)).toBe(html)
  })

  it('does not admit arbitrary data-* attributes', () => {
    expect(sanitizeHtml('<div data-evil="1">x</div>')).toBe('<div>x</div>')
  })
})

describe('the page editor’s blocks survive a save and a reopen', () => {
  // [build, markers the saved HTML must still carry]
  const cases = {
    'task list': [(e) => e.chain().focus().toggleTaskList().insertContent('Ship it').run(),
      ['data-type="taskList"', 'data-type="taskItem"', '<input type="checkbox"', 'Ship it']],
    alignment: [(e) => e.chain().focus().insertContent('Centred').setTextAlign('center').run(),
      ['style="text-align: center"', 'Centred']],
    colour: [(e) => e.chain().focus().insertContent('Red').selectAll().setColor('#c9372c').run(),
      ['<span style="color: rgb(201, 55, 44)">Red</span>']],
    underline: [(e) => e.chain().focus().insertContent('U').selectAll().toggleUnderline().run(), ['<u>U</u>']],
    'info panel': [(e) => e.chain().focus().insertInfoPanel('warning').insertContent('Careful').run(),
      ['data-type="panel"', 'data-panel-type="warning"', 'Careful']],
    layout: [(e) => e.chain().focus().insertLayout().run(), ['data-type="layout"', 'data-type="layout-column"']],
    'table of contents': [(e) => e.chain().focus().insertTableOfContents().run(), ['data-type="toc"']],
    expand: [(e) => e.chain().focus().insertContent('Body').setDetails().run(),
      ['<details', '<summary', 'data-type="detailsContent"', 'Body']],
    table: [(e) => e.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run(),
      ['<table>', '<th colspan="1" rowspan="1">']],
  }

  /*
   * Not byte-identical to TipTap's own output, and not meant to be: the
   * sanitiser writes void tags as <input/>, drops a style's trailing ";",
   * and removes the min-width TipTap puts on a table (JL-186). What must
   * hold is that every block's markers survive, nothing turns into escaped
   * text, and a second save changes nothing.
   */
  for (const [name, [build, markers]] of Object.entries(cases)) {
    it(`${name}: survives saving, and a reopen-and-save changes nothing`, () => {
      const editor = makeEditor()
      build(editor)
      const { first, second } = roundTrip(editor)
      for (const marker of markers) expect(first).toContain(marker)
      expect(first).not.toMatch(/&lt;/)
      expect(second).toBe(first)
    })
  }

  it('a stored mention reopens as a mention', () => {
    const html = '<p>Hi <span data-type="mention" class="mention" data-id="a@x.com" data-label="Ann">@Ann</span></p>'
    const out = sanitizeHtml(makeEditor(html).getHTML())
    expect(out).toContain('data-type="mention"')
    expect(out).toContain('data-id="a@x.com"')
  })
})

describe('the shared element list', () => {
  it('offers every element the spec names in the "/" menu', () => {
    const labels = PAGE_ELEMENTS.map((e) => e.label)
    for (const wanted of ['Heading 1', 'Heading 2', 'Heading 3', 'Bullet list', 'Numbered list', 'Task list',
      'Table', 'Info panel', 'Code block', 'Quote', 'Divider', 'Image', 'Table of contents', 'Expand', 'Layout']) {
      expect(labels).toContain(wanted)
    }
  })

  it('filters by label first, then by keyword', () => {
    expect(filterElements('head').map((e) => e.key)).toEqual(['h1', 'h2', 'h3'])
    expect(filterElements('todo').map((e) => e.key)).toEqual(['task'])
    expect(filterElements('zzz')).toEqual([])
    expect(filterElements('')).toHaveLength(PAGE_ELEMENTS.length)
  })

  it('every element runs against a real editor without throwing', () => {
    for (const element of PAGE_ELEMENTS) {
      const editor = makeEditor('<p>x</p>')
      expect(() => element.run(editor, { pickImage: () => {} })).not.toThrow()
    }
  })
})

describe('built-in templates', () => {
  it.each(BUILT_IN_TEMPLATES.map((t) => [t.name, t.body]))('%s is already in saved form', (_name, body) => {
    expect(sanitizeHtml(body)).toBe(body)
    const reopened = sanitizeHtml(makeEditor(body).getHTML())
    expect(reopened).not.toMatch(/&lt;/)
    expect(reopened).toMatch(/<h2>|<table>/)
  })
})

describe('headingSlug', () => {
  it('makes unique, readable fragments', () => {
    const used = new Set()
    expect(headingSlug('Before you begin', used)).toBe('before-you-begin')
    expect(headingSlug('Before you begin', used)).toBe('before-you-begin-2')
    expect(headingSlug('!!!', used)).toBe('section')
  })
})
