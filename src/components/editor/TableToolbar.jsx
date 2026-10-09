import Tooltip from '@mui/material/Tooltip'

/*
 * JL-188 (fosasoft) — the contextual toolbar for a table, as in Confluence.
 *
 * Shown just above the table while the caret is inside it, so inserting and
 * deleting rows and columns, and deleting the whole table, happen where the
 * table is. Before this the same commands sat in the main toolbar's table
 * menu, which nothing on the page pointed to.
 *
 * Positioned against .pe-body rather than the viewport: the table and the
 * body scroll together, so the offset between them never changes and the bar
 * needs no scroll listener. It is recomputed on every transaction, which is
 * when the table can move.
 */

const ACTIONS = [
  { key: 'rowAbove', label: 'Row above', title: 'Insert row above', run: (c) => c.addRowBefore() },
  { key: 'rowBelow', label: 'Row below', title: 'Insert row below', run: (c) => c.addRowAfter() },
  { key: 'colLeft', label: 'Column left', title: 'Insert column to the left', run: (c) => c.addColumnBefore() },
  { key: 'colRight', label: 'Column right', title: 'Insert column to the right', run: (c) => c.addColumnAfter() },
  { sep: true, key: 's1' },
  { key: 'delRow', label: 'Delete row', title: 'Delete this row', run: (c) => c.deleteRow() },
  { key: 'delCol', label: 'Delete column', title: 'Delete this column', run: (c) => c.deleteColumn() },
  { sep: true, key: 's2' },
  { key: 'header', label: 'Header row', title: 'Turn the first row into headers, or back', toggle: true, run: (c) => c.toggleHeaderRow() },
  { sep: true, key: 's3' },
  { key: 'delTable', label: 'Delete table', title: 'Delete the whole table', danger: true, run: (c) => c.deleteTable() },
]

/** The table node around the selection: its position and its DOM element. */
function currentTable(editor) {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name === 'table') {
      const pos = $from.before(depth)
      return { node, dom: editor.view.nodeDOM(pos) }
    }
  }
  return null
}

// Room needed above the table for a one-line bar; on a narrow screen the bar
// wraps, which is why it is anchored by its BOTTOM edge (translateY(-100%))
// rather than placed at a top computed from a guessed height.
const MIN_ROOM_ABOVE = 40
const GAP = 6

export function TableToolbar({ editor }) {
  if (!editor || editor.isDestroyed || !editor.view?.dom || !editor.isActive('table')) return null
  // Only while someone is editing: a page whose last block is a table opens
  // with the caret in it, and a toolbar nobody asked for would cover the text.
  // The bar's own buttons keep focus in the editor (mousedown is prevented).
  if (!editor.isFocused) return null
  const table = currentTable(editor)
  const body = editor.view.dom.closest('.pe-body')
  if (!table?.dom?.getBoundingClientRect || !body) return null

  const rect = table.dom.getBoundingClientRect()
  const bodyRect = body.getBoundingClientRect()
  const tableTop = rect.top - bodyRect.top
  // Not enough room above (the table is the first thing on the page): go below.
  const placeAbove = tableTop >= MIN_ROOM_ABOVE
  const style = placeAbove
    ? { top: tableTop - GAP, transform: 'translateY(-100%)' }
    : { top: rect.bottom - bodyRect.top + GAP }
  style.left = Math.max(0, rect.left - bodyRect.left)

  const firstRow = table.node.firstChild
  const hasHeaderRow = Boolean(firstRow?.childCount) &&
    [...Array(firstRow.childCount).keys()].every((i) => firstRow.child(i).type.name === 'tableHeader')

  return (
    <div className="pe-table-tb" role="toolbar" aria-label="Table" style={style}>
      {ACTIONS.map((action) => (action.sep
        ? <span key={action.key} className="pe-table-tb__sep" aria-hidden="true" />
        : (
          <Tooltip key={action.key} title={action.title} arrow disableInteractive>
            <button
              type="button"
              className={`pe-table-tb__btn${action.danger ? ' pe-table-tb__btn--danger' : ''}${action.toggle && hasHeaderRow ? ' pe-table-tb__btn--on' : ''}`}
              aria-label={action.title}
              aria-pressed={action.toggle ? hasHeaderRow : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => action.run(editor.chain().focus()).run()}
            >
              {action.label}
            </button>
          </Tooltip>
        )))}
    </div>
  )
}

export default TableToolbar
