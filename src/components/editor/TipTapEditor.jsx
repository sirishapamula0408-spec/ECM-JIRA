import { useEffect, useRef, useState, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
// JL-98/JL-101: opt-in extensions for Confluence Lite page content.
import { TableKit } from '@tiptap/extension-table'
import { Image } from '@tiptap/extension-image'
// JL-359: sanitizeHtml now comes from utils/sanitizeHtml — the single
// sanitizer in the codebase. editorContent keeps only the pure text helpers.
import { isEmptyDoc } from '../../utils/editorContent'
import { sanitizeHtml } from '../../utils/sanitizeHtml'
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

/**
 * @param {object}  props
 * @param {boolean} [props.tables]  JL-98 — table editing (Confluence Lite)
 * @param {boolean} [props.images]  JL-101 — inline images (Confluence Lite)
 *
 * `tables` and `images` default to OFF so IssueDetailPage, the only consumer
 * before JL-98/JL-101, keeps exactly the editor it had. Opting in per consumer
 * rather than enabling everywhere: an issue description is a short field where
 * a table grid would be noise, and the two products can diverge without a
 * second editor component existing.
 */
export function TipTapEditor({
  value = '', onChange, placeholder = 'Write something…', autoFocus = false,
  tables = false, images = false,
  onPickLink, onUploadImage,
}) {
  const [, forceRender] = useState(0)
  const [slashOpen, setSlashOpen] = useState(false)
  const slashRef = useRef(false)
  // JL-101: the real control is the toolbar button; this only opens the picker.
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true },
      }),
      // JL-98: TableKit bundles Table + Row + Cell + Header, so the four nodes
      // cannot be wired up inconsistently. `resizable` is off — column widths
      // are written as inline styles on a <colgroup>, and sanitizeHtml drops
      // both `style` and `colgroup`, so a resize would silently not persist.
      ...(tables ? [TableKit.configure({ table: { resizable: false } })] : []),
      // JL-101: `inline: false` keeps an image its own block node, which is
      // what the sanitiser's allow-list shape expects.
      ...(images ? [Image.configure({ inline: false, allowBase64: false })] : []),
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

  async function handleFile(event) {
    const file = event.target.files?.[0]
    // Reset immediately so the SAME file can be picked twice in a row.
    event.target.value = ''
    if (!file || !onUploadImage) return
    setUploading(true)
    setUploadError('')
    try {
      const src = await onUploadImage(file)
      if (src) editor.chain().focus().setImage({ src, alt: file.name }).run()
    } catch (err) {
      /*
       * The server's message names the real limit and the real allow-list,
       * so it is shown as-is rather than restated here where the two could
       * drift apart.
       */
      setUploadError(err?.message || 'Could not upload that image.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="tte-container">
      {onUploadImage && (
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="tte-file"
          tabIndex={-1}
          aria-hidden="true"
          onChange={handleFile}
        />
      )}
      {uploadError && <p className="tte-upload-error" role="alert">{uploadError}</p>}
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
        {/* JL-99: a consumer can supply a real picker (search by title).
            Without one this falls back to the prompt, which is what the issue
            description editor still uses — an issue has no page to search. */}
        <ToolbarButton
          title="Link"
          active={editor.isActive('link')}
          onClick={async () => {
            if (!onPickLink) { setLink(editor); return }
            const current = editor.getAttributes('link').href || ''
            const href = await onPickLink(current)
            // undefined means cancelled; '' means "remove the link", which is
            // a deliberate choice and not the same thing.
            if (href === undefined || href === null) return
            if (href === '') {
              editor.chain().focus().extendMarkRange('link').unsetLink().run()
              return
            }
            editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
          }}
        >
          🔗
        </ToolbarButton>

        {/* JL-98/JL-101: only rendered for consumers that opted in, so the
            issue-description toolbar is unchanged. The row/column controls
            appear only with the caret inside a table — a table command fired
            outside one is a no-op, and a permanently dead button is worse
            than no button. */}
        {images && (
          <>
            <span className="tte-sep" />
            {/* JL-101: with an uploader, this attaches a real file and
                inserts the stored URL. Without one it falls back to asking
                for a URL, which is all Phase 4 could do. */}
            <ToolbarButton
              title={onUploadImage ? 'Upload an image' : 'Insert image by URL'}
              disabled={uploading}
              onClick={() => {
                if (!onUploadImage) { setImage(editor); return }
                fileRef.current?.click()
              }}
            >
              {uploading ? '…' : '🖼'}
            </ToolbarButton>
          </>
        )}
        {tables && (
          <>
            <span className="tte-sep" />
            <ToolbarButton
              title="Insert table"
              onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
            >
              ▦
            </ToolbarButton>
            {editor.isActive('table') && (
              <>
                <ToolbarButton title="Add row below" onClick={() => editor.chain().focus().addRowAfter().run()}>+Row</ToolbarButton>
                <ToolbarButton title="Add column after" onClick={() => editor.chain().focus().addColumnAfter().run()}>+Col</ToolbarButton>
                <ToolbarButton title="Delete row" onClick={() => editor.chain().focus().deleteRow().run()}>−Row</ToolbarButton>
                <ToolbarButton title="Delete column" onClick={() => editor.chain().focus().deleteColumn().run()}>−Col</ToolbarButton>
                <ToolbarButton title="Delete table" onClick={() => editor.chain().focus().deleteTable().run()}>⌫▦</ToolbarButton>
              </>
            )}
          </>
        )}
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

/*
 * JL-101 — insert an image by URL.
 *
 * URL rather than file upload, deliberately. sanitizeHtml allows only http:,
 * https: and relative URLs in a `src` (JL-368), so a pasted base64 data: URI
 * would be stripped on save and the image would vanish — the usual way an
 * <img> becomes script execution is exactly such a data: URI carrying an SVG.
 * Upload-backed images arrive with attachments (JL-71/JL-120), whose endpoint
 * returns a relative URL that passes this check unchanged.
 */
function setImage(editor) {
  const url = typeof window !== 'undefined' && window.prompt
    ? window.prompt('Image URL (https:// or a relative path)')
    : null
  if (!url) return
  const alt = typeof window !== 'undefined' && window.prompt
    ? window.prompt('Describe the image (for screen readers)', '')
    : ''
  editor.chain().focus().setImage({ src: url, alt: alt || undefined }).run()
}

function setLink(editor) {
  const prev = editor.getAttributes('link').href || ''

  const url = typeof window !== 'undefined' && window.prompt ? window.prompt('Enter URL', prev) : prev
  if (url === null) return
  if (url === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
}

export default TipTapEditor
