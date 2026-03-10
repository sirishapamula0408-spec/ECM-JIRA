import { useRef, useState, useCallback } from 'react'
import './RichTextEditor.css'

const TOOLBAR_ACTIONS = [
  { key: 'bold', icon: 'B', title: 'Bold', prefix: '**', suffix: '**', placeholder: 'bold text' },
  { key: 'italic', icon: 'I', title: 'Italic', prefix: '_', suffix: '_', placeholder: 'italic text', className: 'rte-btn-italic' },
  { key: 'strike', icon: 'S', title: 'Strikethrough', prefix: '~~', suffix: '~~', placeholder: 'strikethrough', className: 'rte-btn-strike' },
  { key: 'sep1', separator: true },
  { key: 'h1', icon: 'H1', title: 'Heading 1', prefix: '# ', suffix: '', placeholder: 'Heading', line: true },
  { key: 'h2', icon: 'H2', title: 'Heading 2', prefix: '## ', suffix: '', placeholder: 'Heading', line: true },
  { key: 'sep2', separator: true },
  { key: 'ul', icon: '•', title: 'Bullet list', prefix: '- ', suffix: '', placeholder: 'List item', line: true },
  { key: 'ol', icon: '1.', title: 'Numbered list', prefix: '1. ', suffix: '', placeholder: 'List item', line: true },
  { key: 'sep3', separator: true },
  { key: 'code', icon: '<>', title: 'Inline code', prefix: '`', suffix: '`', placeholder: 'code' },
  { key: 'codeblock', icon: '{}', title: 'Code block', prefix: '```\n', suffix: '\n```', placeholder: 'code block' },
  { key: 'quote', icon: '"', title: 'Quote', prefix: '> ', suffix: '', placeholder: 'quote', line: true },
  { key: 'sep4', separator: true },
  { key: 'link', icon: '🔗', title: 'Link', special: 'link' },
]

export function RichTextEditor({ value, onChange, placeholder, rows = 6, required }) {
  const textareaRef = useRef(null)
  const [showPreview, setShowPreview] = useState(false)

  const applyFormat = useCallback((action) => {
    const ta = textareaRef.current
    if (!ta) return

    const start = ta.selectionStart
    const end = ta.selectionEnd
    const text = value || ''
    const selected = text.slice(start, end)

    let before = text.slice(0, start)
    let after = text.slice(end)
    let newText
    let cursorPos

    if (action.special === 'link') {
      const url = selected.startsWith('http') ? selected : 'https://'
      const label = selected.startsWith('http') ? 'link text' : (selected || 'link text')
      const insert = `[${label}](${url})`
      newText = before + insert + after
      cursorPos = start + insert.length
    } else if (action.line) {
      // Line-level formatting: ensure we're at the start of a line
      if (start > 0 && before[before.length - 1] !== '\n') {
        before += '\n'
      }
      const content = selected || action.placeholder
      newText = before + action.prefix + content + action.suffix + after
      cursorPos = before.length + action.prefix.length + content.length + action.suffix.length
    } else {
      const content = selected || action.placeholder
      newText = before + action.prefix + content + action.suffix + after
      if (selected) {
        cursorPos = start + action.prefix.length + content.length + action.suffix.length
      } else {
        // Select the placeholder so user can type over it
        cursorPos = start + action.prefix.length + content.length
      }
    }

    onChange(newText)

    // Restore focus and selection after React re-render
    requestAnimationFrame(() => {
      ta.focus()
      if (!selected && !action.special) {
        const selectStart = newText.indexOf(action.placeholder || '', start)
        if (selectStart >= 0) {
          ta.setSelectionRange(selectStart, selectStart + (action.placeholder || '').length)
        }
      } else {
        ta.setSelectionRange(cursorPos, cursorPos)
      }
    })
  }, [value, onChange])

  const renderMarkdown = useCallback((md) => {
    if (!md) return ''
    let html = md
      // Code blocks (must be before inline code)
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Headings
      .replace(/^## (.+)$/gm, '<strong style="font-size:1.1em">$1</strong>')
      .replace(/^# (.+)$/gm, '<strong style="font-size:1.25em">$1</strong>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/_(.+?)_/g, '<em>$1</em>')
      // Strikethrough
      .replace(/~~(.+?)~~/g, '<del>$1</del>')
      // Blockquote
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      // Unordered lists
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      // Ordered lists
      .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
      // Line breaks
      .replace(/\n/g, '<br/>')
    return html
  }, [])

  return (
    <div className="rte-container">
      <div className="rte-toolbar">
        <div className="rte-toolbar-actions">
          {TOOLBAR_ACTIONS.map((action) =>
            action.separator ? (
              <span key={action.key} className="rte-separator" />
            ) : (
              <button
                key={action.key}
                type="button"
                className={`rte-btn ${action.className || ''}`}
                title={action.title}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyFormat(action)}
              >
                {action.icon}
              </button>
            )
          )}
        </div>
        <button
          type="button"
          className={`rte-preview-toggle ${showPreview ? 'rte-preview-toggle--active' : ''}`}
          onClick={() => setShowPreview((v) => !v)}
          title={showPreview ? 'Edit' : 'Preview'}
        >
          {showPreview ? 'Edit' : 'Preview'}
        </button>
      </div>

      {showPreview ? (
        <div
          className="rte-preview"
          style={{ minHeight: `${rows * 1.5}em` }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(value) || '<span class="rte-preview-empty">Nothing to preview</span>' }}
        />
      ) : (
        <textarea
          ref={textareaRef}
          required={required}
          rows={rows}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="rte-textarea"
        />
      )}
    </div>
  )
}
