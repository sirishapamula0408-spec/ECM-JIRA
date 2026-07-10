import { useEffect, useRef, useState, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { sanitizeHtml, isEmptyDoc } from '../../utils/editorContent'
import './TipTapEditor.css'

// JL-135 — ADF-style WYSIWYG editor built on TipTap + StarterKit.
// Value in/out as sanitized HTML. onChange(html) fires on every edit.

const SLASH_COMMANDS = [
  { key: 'h1', label: 'Heading 1', hint: 'Big section heading', run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { key: 'h2', label: 'Heading 2', hint: 'Medium heading', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { key: 'h3', label: 'Heading 3', hint: 'Small heading', run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { key: 'ul', label: 'Bullet list', hint: 'Unordered list', run: (e) => e.chain().focus().toggleBulletList().run() },
  { key: 'ol', label: 'Numbered list', hint: 'Ordered list', run: (e) => e.chain().focus().toggleOrderedList().run() },
  { key: 'code', label: 'Code block', hint: 'Fenced code', run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { key: 'quote', label: 'Quote', hint: 'Blockquote', run: (e) => e.chain().focus().toggleBlockquote().run() },
  { key: 'hr', label: 'Divider', hint: 'Horizontal rule', run: (e) => e.chain().focus().setHorizontalRule().run() },
]

function ToolbarButton({ onClick, active, disabled, title, children }) {
  return (
    <button
      type="button"
      className={`tte-btn${active ? ' tte-btn--active' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={active || undefined}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function TipTapEditor({ value = '', onChange, placeholder = 'Write something…', autoFocus = false }) {
  const [, forceRender] = useState(0)
  const [slashOpen, setSlashOpen] = useState(false)
  const slashRef = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true },
      }),
    ],
    content: value || '',
    autofocus: autoFocus,
    editorProps: {
      attributes: { class: 'tte-content', 'aria-label': placeholder },
      handleKeyDown: (_view, event) => {
        if (event.key === '/') {
          // Open the slash menu on the next tick (after the char is inserted).
          slashRef.current = true
          setTimeout(() => {
            if (slashRef.current) setSlashOpen(true)
          }, 0)
        } else if (event.key === 'Escape') {
          setSlashOpen(false)
          slashRef.current = false
        } else if (slashOpen && (event.key === ' ' || event.key === 'Enter')) {
          setSlashOpen(false)
          slashRef.current = false
        }
        return false
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML()
      if (onChange) onChange(sanitizeHtml(html))
    },
    onSelectionUpdate: () => forceRender((n) => n + 1),
    onTransaction: () => forceRender((n) => n + 1),
  })

  // Keep external value in sync (e.g. reset after save) without clobbering typing.
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    const incoming = value || ''
    const bothEmpty = isEmptyDoc(current) && isEmptyDoc(incoming)
    if (!bothEmpty && sanitizeHtml(current) !== sanitizeHtml(incoming)) {
      editor.commands.setContent(incoming, { emitUpdate: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor])

  const runSlash = useCallback(
    (cmd) => {
      if (!editor) return
      // Remove the just-typed "/" trigger before running the command.
      editor.commands.deleteRange({ from: Math.max(0, editor.state.selection.from - 1), to: editor.state.selection.from })
      cmd.run(editor)
      setSlashOpen(false)
      slashRef.current = false
    },
    [editor]
  )

  if (!editor) {
    // Graceful degradation: fall back to a plain textarea if TipTap fails to init.
    return (
      <textarea
        className="tte-fallback"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange && onChange(e.target.value)}
      />
    )
  }

  const can = editor.can()

  return (
    <div className="tte-container">
      <div className="tte-toolbar" role="toolbar" aria-label="Text formatting">
        <ToolbarButton title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></ToolbarButton>
        <ToolbarButton title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></ToolbarButton>
        <ToolbarButton title="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></ToolbarButton>
        <ToolbarButton title="Inline code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>{'</>'}</ToolbarButton>
        <span className="tte-sep" />
        <ToolbarButton title="Heading 1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</ToolbarButton>
        <ToolbarButton title="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolbarButton>
        <ToolbarButton title="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolbarButton>
        <span className="tte-sep" />
        <ToolbarButton title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>•</ToolbarButton>
        <ToolbarButton title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</ToolbarButton>
        <ToolbarButton title="Blockquote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>&ldquo;</ToolbarButton>
        <ToolbarButton title="Code block" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>{'{}'}</ToolbarButton>
        <ToolbarButton title="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()}>―</ToolbarButton>
        <span className="tte-sep" />
        <ToolbarButton title="Link" active={editor.isActive('link')} onClick={() => setLink(editor)}>🔗</ToolbarButton>
        <span className="tte-sep" />
        <ToolbarButton title="Undo" disabled={!can.undo?.()} onClick={() => editor.chain().focus().undo().run()}>↶</ToolbarButton>
        <ToolbarButton title="Redo" disabled={!can.redo?.()} onClick={() => editor.chain().focus().redo().run()}>↷</ToolbarButton>
      </div>

      <div className="tte-body">
        <EditorContent editor={editor} />
        {slashOpen && (
          <div className="tte-slash-menu" role="menu" aria-label="Insert block">
            <div className="tte-slash-title">Insert</div>
            {SLASH_COMMANDS.map((cmd) => (
              <button
                key={cmd.key}
                type="button"
                role="menuitem"
                className="tte-slash-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runSlash(cmd)}
              >
                <span className="tte-slash-label">{cmd.label}</span>
                <span className="tte-slash-hint">{cmd.hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function setLink(editor) {
  const prev = editor.getAttributes('link').href || ''
  // eslint-disable-next-line no-alert
  const url = typeof window !== 'undefined' && window.prompt ? window.prompt('Enter URL', prev) : prev
  if (url === null) return
  if (url === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
}

export default TipTapEditor
