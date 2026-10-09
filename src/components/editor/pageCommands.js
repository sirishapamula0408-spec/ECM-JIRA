/*
 * JL-187 (fosasoft) — the page editor's insertable elements, defined once.
 *
 * The "/" menu, the toolbar's "+" menu and the quick-insert panel all read
 * this list, so an element added here appears in all three and a label cannot
 * differ between them.
 *
 * `run(editor, ctx)` — ctx carries what an element needs from the page:
 * `pickImage()` opens the upload picker (an image needs a saved page).
 */
export const PAGE_ELEMENTS = [
  { key: 'h1', label: 'Heading 1', hint: 'Large section heading', keywords: 'title h1',
    run: (e) => e.chain().focus().setNode('heading', { level: 1 }).run() },
  { key: 'h2', label: 'Heading 2', hint: 'Medium section heading', keywords: 'subtitle h2',
    run: (e) => e.chain().focus().setNode('heading', { level: 2 }).run() },
  { key: 'h3', label: 'Heading 3', hint: 'Small section heading', keywords: 'h3',
    run: (e) => e.chain().focus().setNode('heading', { level: 3 }).run() },
  { key: 'bullet', label: 'Bullet list', hint: 'A simple bulleted list', keywords: 'ul unordered',
    run: (e) => e.chain().focus().toggleBulletList().run() },
  { key: 'numbered', label: 'Numbered list', hint: 'A list with numbering', keywords: 'ol ordered',
    run: (e) => e.chain().focus().toggleOrderedList().run() },
  { key: 'task', label: 'Task list', hint: 'Track tasks with checkboxes', keywords: 'todo checkbox action',
    run: (e) => e.chain().focus().toggleTaskList().run() },
  { key: 'table', label: 'Table', hint: 'Insert a 3 × 3 table', keywords: 'grid',
    run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { key: 'info', label: 'Info panel', hint: 'Highlight information in a coloured panel', keywords: 'note callout warning',
    run: (e) => e.chain().focus().insertInfoPanel('info').run() },
  { key: 'code', label: 'Code block', hint: 'Display code', keywords: 'snippet pre',
    run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { key: 'quote', label: 'Quote', hint: 'Capture a quote', keywords: 'blockquote',
    run: (e) => e.chain().focus().toggleBlockquote().run() },
  { key: 'divider', label: 'Divider', hint: 'Separate content with a line', keywords: 'hr rule line',
    run: (e) => e.chain().focus().setHorizontalRule().run() },
  { key: 'image', label: 'Image', hint: 'Upload an image', keywords: 'picture photo',
    run: (_e, ctx) => ctx?.pickImage?.() },
  { key: 'toc', label: 'Table of contents', hint: 'List the headings on this page', keywords: 'toc contents',
    run: (e) => e.chain().focus().insertTableOfContents().run() },
  { key: 'expand', label: 'Expand', hint: 'A section readers can open and close', keywords: 'collapse details toggle',
    run: (e) => e.chain().focus().setDetails().run() },
  { key: 'layout', label: 'Layout', hint: 'Two columns side by side', keywords: 'columns',
    run: (e) => e.chain().focus().insertLayout().run() },
]

/** Elements whose label, key or keywords contain `query`, best match first. */
export function filterElements(query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return PAGE_ELEMENTS
  const starts = []
  const contains = []
  for (const el of PAGE_ELEMENTS) {
    const label = el.label.toLowerCase()
    if (label.startsWith(q)) starts.push(el)
    else if (`${label} ${el.key} ${el.keywords}`.includes(q)) contains.push(el)
  }
  return [...starts, ...contains]
}
