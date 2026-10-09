/**
 * JL-186 (fosasoft) — table <colgroup> markup must never become page text.
 *
 * TipTap writes every table as `<table><colgroup><col style=…>…</colgroup>`.
 * sanitizeHtml used to escape the colgroup instead of dropping it, so saved
 * Confluence Lite pages showed `<colgroup><col style="min-width: 25px;">…`
 * above every table. These tests drive the real editor with the same
 * extensions the page editor uses (StarterKit + TableKit), through the same
 * sanitizer the save path uses, so a regression in either shows up here.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { sanitizeHtml } from '../utils/sanitizeHtml'
import { stripColgroupText } from '../../scripts/strip-colgroup-text.mjs'

const editors = []
function makeEditor(content = '') {
  const editor = new Editor({
    extensions: [StarterKit, TableKit.configure({ table: { resizable: false } })],
    content,
  })
  editors.push(editor)
  return editor
}
afterEach(() => {
  while (editors.length) editors.pop().destroy()
})

/** What the page editor saves: TipTap's HTML through the sanitizer. */
const saved = (editor) => sanitizeHtml(editor.getHTML())

function pageWithTwoTables() {
  const editor = makeEditor('<h2>Status</h2><p></p>')
  editor.commands.focus('end')
  editor.commands.insertTable({ rows: 2, cols: 3, withHeaderRow: true })
  editor.commands.focus('end')
  editor.commands.insertContent('<h2>Options considered</h2>')
  editor.commands.focus('end')
  editor.commands.insertTable({ rows: 3, cols: 2, withHeaderRow: true })
  return editor
}

describe('sanitizeHtml drops colgroup and col (JL-186)', () => {
  const tiptapTable =
    '<table><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup>' +
    '<tbody><tr><th colspan="1" rowspan="1"><p>A</p></th><th><p>B</p></th></tr></tbody></table>'

  it('removes the colgroup instead of escaping it into text', () => {
    const out = sanitizeHtml(tiptapTable)
    expect(out).not.toMatch(/colgroup|<col\b|&lt;col/i)
    expect(out).toBe(
      '<table><tbody><tr><th colspan="1" rowspan="1"><p>A</p></th><th><p>B</p></th></tr></tbody></table>',
    )
  })

  it('still admits no style attribute', () => {
    expect(sanitizeHtml(tiptapTable)).not.toContain('style')
  })

  it('is idempotent', () => {
    const once = sanitizeHtml(tiptapTable)
    expect(sanitizeHtml(once)).toBe(once)
  })

  it('leaves other unknown tags escaped, as before', () => {
    expect(sanitizeHtml('<marquee>x</marquee>')).toBe('&lt;marquee&gt;x&lt;/marquee&gt;')
  })
})

describe('the page editor round trip with two tables (JL-186)', () => {
  it('TipTap really does emit a colgroup — the input this fix exists for', () => {
    expect(pageWithTwoTables().getHTML().match(/<colgroup>/g)).toHaveLength(2)
  })

  it('saves both tables with no colgroup text', () => {
    const html = saved(pageWithTwoTables())
    expect(html.match(/<table>/g)).toHaveLength(2)
    expect(html).not.toMatch(/colgroup|&lt;col/i)
  })

  it('reopen → edit a cell → save → reopen keeps the tables and adds no text', () => {
    const first = saved(pageWithTwoTables())

    // Reopen the saved page and type into the first header cell.
    const reopened = makeEditor(first)
    let cellPos = null
    reopened.state.doc.descendants((node, pos) => {
      if (cellPos === null && node.type.name === 'tableHeader') cellPos = pos + 2
    })
    reopened.chain().focus().setTextSelection(cellPos).insertContent('Edited').run()
    const second = saved(reopened)

    expect(second).toContain('Edited')
    expect(second.match(/<table>/g)).toHaveLength(2)
    expect(second).not.toMatch(/colgroup|&lt;col/i)

    // A further reopen-and-save without changes is stable.
    expect(saved(makeEditor(second))).toBe(second)
  })

  it('reopening a page keeps the table columns intact in the editor', () => {
    const reopened = makeEditor(saved(pageWithTwoTables()))
    const widths = []
    reopened.state.doc.descendants((node) => {
      if (node.type.name === 'tableRow') widths.push(node.childCount)
    })
    expect(widths).toEqual([3, 3, 2, 2, 2])
  })
})

describe('strip-colgroup-text clean-up (JL-186)', () => {
  const CG =
    '&lt;colgroup&gt;&lt;col style=&quot;min-width: 25px;&quot;&gt;&lt;col style=&quot;min-width: 25px;&quot;&gt;&lt;/colgroup&gt;'
  const table = (inner = '') => `<table>${inner}<tbody><tr><td><p>x</p></td></tr></tbody></table>`

  it('removes colgroup text stored inside a table', () => {
    expect(stripColgroupText(`<h2>Status</h2><p></p>${table(CG)}`)).toBe(`<h2>Status</h2><p></p>${table()}`)
  })

  it('removes a paragraph that holds nothing but colgroup text', () => {
    expect(stripColgroupText(`<p>Intro</p><p>${CG}${CG}</p>${table(CG)}`)).toBe(`<p>Intro</p>${table()}`)
  })

  it('handles literal quotes inside the escaped run', () => {
    const literal = '&lt;colgroup&gt;&lt;col style="min-width: 25px;"&gt;&lt;/colgroup&gt;'
    expect(stripColgroupText(table(literal))).toBe(table())
  })

  it('keeps the rest of a paragraph that also has real text', () => {
    expect(stripColgroupText(`<p>Keep ${CG}me</p>`)).toBe('<p>Keep me</p>')
  })

  it('leaves clean content untouched and is idempotent', () => {
    const clean = `<p>No tables here</p>${table()}`
    expect(stripColgroupText(clean)).toBe(clean)
    const once = stripColgroupText(`<p>${CG}</p>${table(CG)}`)
    expect(stripColgroupText(once)).toBe(once)
  })

  it('returns its input for empty content', () => {
    expect(stripColgroupText('')).toBe('')
    expect(stripColgroupText(null)).toBe(null)
  })
})
