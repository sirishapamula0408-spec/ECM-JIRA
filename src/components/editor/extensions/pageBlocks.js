import { Node, mergeAttributes } from '@tiptap/core'

/*
 * JL-187 (fosasoft) — the Confluence-style blocks TipTap does not ship.
 *
 * Each block is a plain <div> told apart by `data-type`, which is exactly the
 * shape sanitizeHtml admits (`div` plus the inert `data-*` attributes), so
 * what the editor writes is what the page view renders, with no second format.
 */

export const PANEL_TYPES = ['info', 'note', 'success', 'warning', 'error']

/** An info panel: a tinted box around ordinary blocks. */
export const InfoPanel = Node.create({
  name: 'infoPanel',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      panelType: {
        default: 'info',
        parseHTML: (el) => {
          const value = el.getAttribute('data-panel-type')
          return PANEL_TYPES.includes(value) ? value : 'info'
        },
        renderHTML: (attrs) => ({ 'data-panel-type': attrs.panelType }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="panel"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'panel', class: 'page-panel' }), 0]
  },

  addCommands() {
    return {
      insertInfoPanel: (panelType = 'info') => ({ commands }) =>
        commands.insertContent({
          type: this.name,
          attrs: { panelType },
          content: [{ type: 'paragraph' }],
        }),
    }
  },
})

/** One column of a layout. Only ever a child of `layout`. */
export const LayoutColumn = Node.create({
  name: 'layoutColumn',
  content: 'block+',
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="layout-column"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'layout-column', class: 'page-layout__column' }), 0]
  },
})

/** A two-column layout section. */
export const Layout = Node.create({
  name: 'layout',
  group: 'block',
  content: 'layoutColumn{2}',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="layout"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'layout', class: 'page-layout' }), 0]
  },

  addCommands() {
    return {
      insertLayout: () => ({ commands }) =>
        commands.insertContent({
          type: this.name,
          content: [
            { type: 'layoutColumn', content: [{ type: 'paragraph' }] },
            { type: 'layoutColumn', content: [{ type: 'paragraph' }] },
          ],
        }),
    }
  },
})

/*
 * A table of contents. Stored as an empty marker, NOT as a list of links:
 * a copy of the headings saved into the page would go stale the moment a
 * heading changed. The page view fills it from the headings when it renders
 * (see utils/tableOfContents.js), and the editor shows a placeholder.
 */
export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-type="toc"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toc', class: 'page-toc' })]
  },

  addNodeView() {
    return () => {
      const dom = document.createElement('div')
      dom.className = 'page-toc page-toc--editing'
      dom.setAttribute('data-type', 'toc')
      dom.contentEditable = 'false'
      dom.textContent = 'Table of contents — built from this page’s headings when it is viewed'
      return { dom }
    }
  },

  addCommands() {
    return {
      insertTableOfContents: () => ({ commands }) => commands.insertContent({ type: this.name }),
    }
  },
})
