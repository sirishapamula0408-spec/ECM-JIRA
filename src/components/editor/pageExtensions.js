import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { Image } from '@tiptap/extension-image'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { TextAlign } from '@tiptap/extension-text-align'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details'
import { Mention } from '@tiptap/extension-mention'
import { Placeholder } from '@tiptap/extensions'
import { InfoPanel, Layout, LayoutColumn, TableOfContents } from './extensions/pageBlocks'
import { createSuggestionExtension } from './suggestionBridge'
import { filterElements } from './pageCommands'

/*
 * JL-187 (fosasoft) — every extension the Confluence-style page editor uses,
 * in one list, so the editor and the tests build exactly the same schema.
 *
 * The issue-description editor (TipTapEditor) is deliberately untouched: it
 * is a short field and keeps its own smaller set.
 *
 * Without the bridges (tests, or a read-only render) the "/" menu and
 * @mentions are left out; the schema for everything else is identical.
 */
export function buildPageExtensions({
  slashBridge, mentionBridge, findMembers, onElement, onLinkShortcut,
} = {}) {
  const extensions = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true },
    }),
    // Resizing writes widths into a <colgroup> the sanitiser drops (JL-186),
    // so a resize could never be saved.
    TableKit.configure({ table: { resizable: false } }),
    Image.configure({ inline: false, allowBase64: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right'] }),
    TextStyle,
    Color,
    Details.configure({ persist: true, HTMLAttributes: { class: 'page-expand' } }),
    DetailsSummary,
    DetailsContent,
    InfoPanel,
    Layout,
    LayoutColumn,
    TableOfContents,
    Placeholder.configure({
      // Only the empty page shows the hint; an empty line mid-page stays quiet.
      placeholder: ({ editor }) => (editor.isEmpty ? 'Type / to insert elements' : ''),
    }),
  ]

  if (onLinkShortcut) {
    extensions.push(Extension.create({
      name: 'pageLinkShortcut',
      addKeyboardShortcuts: () => ({
        'Mod-k': () => { onLinkShortcut(); return true },
      }),
    }))
  }

  if (slashBridge) {
    extensions.push(createSuggestionExtension({
      name: 'slashCommand',
      char: '/',
      bridge: slashBridge,
      items: (query) => filterElements(query),
      onSelect: (editor, element) => onElement?.(editor, element),
    }))
  }

  if (mentionBridge) {
    extensions.push(Mention.configure({
      HTMLAttributes: { class: 'mention' },
      suggestion: {
        char: '@',
        items: ({ query }) => (findMembers ? findMembers(query) : []),
        render: mentionBridge.render,
      },
    }))
  } else {
    // Still parse stored mentions, so a page round-trips without the picker.
    extensions.push(Mention.configure({ HTMLAttributes: { class: 'mention' } }))
  }

  return extensions
}
