import { useState } from 'react'
import Tooltip from '@mui/material/Tooltip'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import ListItemText from '@mui/material/ListItemText'
import Popover from '@mui/material/Popover'
import FormatBoldIcon from '@mui/icons-material/FormatBold'
import FormatItalicIcon from '@mui/icons-material/FormatItalic'
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined'
import StrikethroughSIcon from '@mui/icons-material/StrikethroughS'
import CodeIcon from '@mui/icons-material/Code'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered'
import FormatAlignLeftIcon from '@mui/icons-material/FormatAlignLeft'
import FormatAlignCenterIcon from '@mui/icons-material/FormatAlignCenter'
import FormatAlignRightIcon from '@mui/icons-material/FormatAlignRight'
import FormatColorTextIcon from '@mui/icons-material/FormatColorText'
import CheckBoxOutlinedIcon from '@mui/icons-material/CheckBoxOutlined'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail'
import EmojiEmotionsOutlinedIcon from '@mui/icons-material/EmojiEmotionsOutlined'
import ViewColumnOutlinedIcon from '@mui/icons-material/ViewColumnOutlined'
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore'
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined'
import AddIcon from '@mui/icons-material/Add'
import LinkIcon from '@mui/icons-material/Link'
import UndoIcon from '@mui/icons-material/Undo'
import RedoIcon from '@mui/icons-material/Redo'
import HistoryIcon from '@mui/icons-material/History'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import PushPinIcon from '@mui/icons-material/PushPin'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import { PAGE_ELEMENTS } from './pageCommands'

/*
 * JL-187 (fosasoft) — the page editor's toolbar, laid out like Confluence's.
 *
 * Every control carries a tooltip naming its shortcut, reports its active
 * state through aria-pressed, and keeps the editor's selection (mousedown is
 * prevented so focus never leaves the text).
 */

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
const MOD = isMac ? '⌘' : 'Ctrl'

const TEXT_STYLES = [
  { key: 'p', label: 'Normal text', isActive: (e) => e.isActive('paragraph'), run: (e) => e.chain().focus().setParagraph().run() },
  { key: 'h1', label: 'Heading 1', isActive: (e) => e.isActive('heading', { level: 1 }), run: (e) => e.chain().focus().setNode('heading', { level: 1 }).run() },
  { key: 'h2', label: 'Heading 2', isActive: (e) => e.isActive('heading', { level: 2 }), run: (e) => e.chain().focus().setNode('heading', { level: 2 }).run() },
  { key: 'h3', label: 'Heading 3', isActive: (e) => e.isActive('heading', { level: 3 }), run: (e) => e.chain().focus().setNode('heading', { level: 3 }).run() },
  { key: 'quote', label: 'Quote', isActive: (e) => e.isActive('blockquote'), run: (e) => e.chain().focus().toggleBlockquote().run() },
  { key: 'code', label: 'Code block', isActive: (e) => e.isActive('codeBlock'), run: (e) => e.chain().focus().toggleCodeBlock().run() },
]

const MORE_FORMATS = [
  { key: 'italic', label: 'Italic', shortcut: `${MOD}+I`, icon: <FormatItalicIcon fontSize="small" /> },
  { key: 'underline', label: 'Underline', shortcut: `${MOD}+U`, icon: <FormatUnderlinedIcon fontSize="small" /> },
  { key: 'strike', label: 'Strikethrough', shortcut: `${MOD}+Shift+S`, icon: <StrikethroughSIcon fontSize="small" /> },
  { key: 'code', label: 'Code', shortcut: `${MOD}+E`, icon: <CodeIcon fontSize="small" /> },
]

const ALIGNMENTS = [
  { key: 'left', label: 'Align left', icon: <FormatAlignLeftIcon fontSize="small" /> },
  { key: 'center', label: 'Align centre', icon: <FormatAlignCenterIcon fontSize="small" /> },
  { key: 'right', label: 'Align right', icon: <FormatAlignRightIcon fontSize="small" /> },
]

// Atlassian's text colour palette. Hex only — sanitizeHtml keeps nothing else.
const TEXT_COLORS = [
  { label: 'Default', value: null },
  { label: 'Grey', value: '#626f86' },
  { label: 'Blue', value: '#0c66e4' },
  { label: 'Teal', value: '#1d7f8c' },
  { label: 'Green', value: '#216e4e' },
  { label: 'Yellow', value: '#946f00' },
  { label: 'Orange', value: '#c25100' },
  { label: 'Red', value: '#c9372c' },
  { label: 'Purple', value: '#6e5dc6' },
]

const EMOJIS = [
  '😀', '😃', '😄', '😁', '😊', '🙂', '😉', '😍', '🤔', '😎', '😅', '😢',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '👀', '🎉', '🚀', '🔥', '✨', '⭐',
  '✅', '❌', '⚠️', '❗', '❓', 'ℹ️', '💡', '📌', '📎', '📝', '📅', '⏰',
  '🐛', '🔧', '🔒', '📈', '📉', '💬', '❤️', '💯', '🏁', '🧪', '📦', '🗂️',
]

function ToolButton({ title, shortcut, active, disabled, onClick, children, ...rest }) {
  const tip = shortcut ? `${title} (${shortcut})` : title
  return (
    <Tooltip title={tip} arrow disableInteractive>
      {/* span: a Tooltip needs an element that can receive events even when
          the button inside is disabled. */}
      <span className="pe-tb__wrap">
        <button
          type="button"
          className={`pe-tb__btn${active ? ' pe-tb__btn--active' : ''}`}
          aria-label={title}
          aria-pressed={active === undefined ? undefined : Boolean(active)}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
          {...rest}
        >
          {children}
        </button>
      </span>
    </Tooltip>
  )
}

function Caret({ title, onClick }) {
  return (
    <ToolButton title={title} onClick={onClick} aria-haspopup="menu">
      <ArrowDropDownIcon fontSize="small" />
    </ToolButton>
  )
}

const Sep = () => <span className="pe-tb__sep" aria-hidden="true" />

/** A rows × columns grid; hovering sizes the table, clicking inserts it. */
function TablePicker({ onPick }) {
  const [hover, setHover] = useState({ rows: 3, cols: 3 })
  const SIZE = 6
  return (
    <div className="pe-table-picker">
      <div className="pe-table-picker__grid" role="grid" aria-label="Table size">
        {Array.from({ length: SIZE }, (_, r) => (
          <div key={r} role="row" className="pe-table-picker__row">
            {Array.from({ length: SIZE }, (_c, c) => (
              <button
                key={c}
                type="button"
                role="gridcell"
                aria-label={`${r + 1} by ${c + 1} table`}
                className={`pe-table-picker__cell${r < hover.rows && c < hover.cols ? ' pe-table-picker__cell--on' : ''}`}
                onMouseEnter={() => setHover({ rows: r + 1, cols: c + 1 })}
                onFocus={() => setHover({ rows: r + 1, cols: c + 1 })}
                onClick={() => onPick(r + 1, c + 1)}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="pe-table-picker__label">{hover.rows} × {hover.cols}</p>
    </div>
  )
}

/**
 * @param {object} props
 * @param {import('@tiptap/core').Editor} props.editor
 * @param {() => void} props.onLink        — open the link picker (Ctrl+K too)
 * @param {() => void} props.onImage       — open the image upload picker
 * @param {() => void} props.onHistory     — open version history
 * @param {boolean}    props.historyDisabled
 * @param {boolean}    props.pinned
 * @param {() => void} props.onTogglePin
 * @param {boolean}    props.pinDisabled
 * @param {boolean}    props.uploading
 */
export function ConfluenceToolbar({
  editor, onLink, onImage, onHistory, historyDisabled,
  pinned, onTogglePin, pinDisabled, uploading,
}) {
  // One anchor per popup; `menu` names which is open.
  const [menu, setMenu] = useState(null)
  const open = (name) => (event) => setMenu({ name, anchor: event.currentTarget })
  const close = () => setMenu(null)
  const isOpen = (name) => menu?.name === name

  if (!editor) return null
  const run = (fn) => () => { fn(); close() }
  const chain = () => editor.chain().focus()
  const currentStyle = TEXT_STYLES.find((s) => s.isActive(editor)) || TEXT_STYLES[0]
  const currentColor = editor.getAttributes('textStyle').color || null
  const alignment = ALIGNMENTS.find((a) => editor.isActive({ textAlign: a.key })) || ALIGNMENTS[0]
  // editor.can() needs the editor's view, which TipTap attaches after the
  // first render; asking earlier throws. Nothing can be undone yet anyway.
  const canRun = (fn) => { try { return Boolean(editor.view?.dom && fn()) } catch { return false } }
  const canUndo = canRun(() => editor.can().undo())
  const canRedo = canRun(() => editor.can().redo())

  return (
    <div className="pe-tb" role="toolbar" aria-label="Formatting">
      <Tooltip title="Text styles" arrow disableInteractive>
        <button
          type="button"
          className="pe-tb__style"
          aria-haspopup="menu"
          aria-label={`Text style: ${currentStyle.label}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={open('style')}
        >
          {currentStyle.label}
          <ArrowDropDownIcon fontSize="small" />
        </button>
      </Tooltip>
      <Menu anchorEl={menu?.anchor} open={isOpen('style')} onClose={close}>
        {TEXT_STYLES.map((s) => (
          <MenuItem key={s.key} selected={s.key === currentStyle.key} onClick={run(() => s.run(editor))}>
            <span className={`pe-style-option pe-style-option--${s.key}`}>{s.label}</span>
          </MenuItem>
        ))}
      </Menu>
      <Sep />

      <ToolButton title="Bold" shortcut={`${MOD}+B`} active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()}>
        <FormatBoldIcon fontSize="small" />
      </ToolButton>
      <Caret title="More formatting" onClick={open('format')} />
      <Menu anchorEl={menu?.anchor} open={isOpen('format')} onClose={close}>
        {MORE_FORMATS.map((f) => (
          <MenuItem
            key={f.key}
            selected={editor.isActive(f.key)}
            onClick={run(() => {
              const c = chain()
              if (f.key === 'italic') c.toggleItalic()
              if (f.key === 'underline') c.toggleUnderline()
              if (f.key === 'strike') c.toggleStrike()
              if (f.key === 'code') c.toggleCode()
              c.run()
            })}
          >
            <span className="pe-menu-icon">{f.icon}</span>
            <ListItemText primary={f.label} />
            <span className="pe-menu-shortcut">{f.shortcut}</span>
          </MenuItem>
        ))}
      </Menu>
      <Sep />

      <ToolButton title="Bullet list" shortcut={`${MOD}+Shift+8`} active={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()}>
        <FormatListBulletedIcon fontSize="small" />
      </ToolButton>
      <Caret title="More lists" onClick={open('lists')} />
      <Menu anchorEl={menu?.anchor} open={isOpen('lists')} onClose={close}>
        <MenuItem selected={editor.isActive('orderedList')} onClick={run(() => chain().toggleOrderedList().run())}>
          <span className="pe-menu-icon"><FormatListNumberedIcon fontSize="small" /></span>
          <ListItemText primary="Numbered list" />
          <span className="pe-menu-shortcut">{MOD}+Shift+7</span>
        </MenuItem>
      </Menu>

      <ToolButton title={alignment.label} active={alignment.key !== 'left'} onClick={open('align')} aria-haspopup="menu">
        {alignment.icon}
      </ToolButton>
      <Menu anchorEl={menu?.anchor} open={isOpen('align')} onClose={close}>
        {ALIGNMENTS.map((a) => (
          <MenuItem key={a.key} selected={a.key === alignment.key} onClick={run(() => chain().setTextAlign(a.key).run())}>
            <span className="pe-menu-icon">{a.icon}</span>
            <ListItemText primary={a.label} />
          </MenuItem>
        ))}
      </Menu>

      <ToolButton title="Text colour" active={Boolean(currentColor)} onClick={open('color')} aria-haspopup="dialog">
        <FormatColorTextIcon fontSize="small" style={currentColor ? { color: currentColor } : undefined} />
      </ToolButton>
      <Popover anchorEl={menu?.anchor} open={isOpen('color')} onClose={close} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <div className="pe-swatches" role="group" aria-label="Text colour">
          {TEXT_COLORS.map((c) => (
            <Tooltip key={c.label} title={c.label} disableInteractive>
              <button
                type="button"
                className={`pe-swatch${c.value === currentColor ? ' pe-swatch--on' : ''}`}
                aria-label={c.label}
                aria-pressed={c.value === currentColor}
                style={{ background: c.value || 'var(--color-text, #172b4d)' }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={run(() => (c.value ? chain().setColor(c.value).run() : chain().unsetColor().run()))}
              />
            </Tooltip>
          ))}
        </div>
      </Popover>
      <Sep />

      <ToolButton title="Task list" shortcut={`${MOD}+Shift+9`} active={editor.isActive('taskList')} onClick={() => chain().toggleTaskList().run()}>
        <CheckBoxOutlinedIcon fontSize="small" />
      </ToolButton>
      <ToolButton title={uploading ? 'Uploading image…' : 'Image'} disabled={uploading} onClick={onImage}>
        <ImageOutlinedIcon fontSize="small" />
      </ToolButton>
      <ToolButton title="Mention" onClick={() => chain().insertContent(' @').run()}>
        <AlternateEmailIcon fontSize="small" />
      </ToolButton>
      <ToolButton title="Emoji" onClick={open('emoji')} aria-haspopup="dialog">
        <EmojiEmotionsOutlinedIcon fontSize="small" />
      </ToolButton>
      <Popover anchorEl={menu?.anchor} open={isOpen('emoji')} onClose={close} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <div className="pe-emoji" role="group" aria-label="Emoji">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="pe-emoji__btn"
              aria-label={`Insert ${emoji}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={run(() => chain().insertContent(emoji).run())}
            >
              {emoji}
            </button>
          ))}
        </div>
      </Popover>
      <ToolButton title="Layout (2 columns)" active={editor.isActive('layout')} onClick={() => chain().insertLayout().run()}>
        <ViewColumnOutlinedIcon fontSize="small" />
      </ToolButton>
      <ToolButton title="Expand" active={editor.isActive('details')} onClick={() => chain().setDetails().run()}>
        <UnfoldMoreIcon fontSize="small" />
      </ToolButton>
      <ToolButton title="Table" active={editor.isActive('table')} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <TableChartOutlinedIcon fontSize="small" />
      </ToolButton>
      <Caret title="Table size and options" onClick={open('table')} />
      <Popover anchorEl={menu?.anchor} open={isOpen('table')} onClose={close} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <TablePicker onPick={(rows, cols) => { chain().insertTable({ rows, cols, withHeaderRow: true }).run(); close() }} />
        {editor.isActive('table') && (
          <div className="pe-table-actions">
            <MenuItem onClick={run(() => chain().addRowAfter().run())}>Add row below</MenuItem>
            <MenuItem onClick={run(() => chain().addColumnAfter().run())}>Add column after</MenuItem>
            <MenuItem onClick={run(() => chain().deleteRow().run())}>Delete row</MenuItem>
            <MenuItem onClick={run(() => chain().deleteColumn().run())}>Delete column</MenuItem>
            <MenuItem onClick={run(() => chain().deleteTable().run())}>Delete table</MenuItem>
          </div>
        )}
      </Popover>
      <ToolButton title="More elements" shortcut="/" onClick={open('more')} aria-haspopup="menu">
        <AddIcon fontSize="small" />
      </ToolButton>
      <Menu anchorEl={menu?.anchor} open={isOpen('more')} onClose={close}>
        {PAGE_ELEMENTS.map((el) => (
          <MenuItem key={el.key} onClick={run(() => el.run(editor, { pickImage: onImage }))}>
            <ListItemText primary={el.label} secondary={el.hint} />
          </MenuItem>
        ))}
      </Menu>
      <Sep />

      <ToolButton title="Link" shortcut={`${MOD}+K`} active={editor.isActive('link')} onClick={onLink}>
        <LinkIcon fontSize="small" />
      </ToolButton>
      <ToolButton title="Undo" shortcut={`${MOD}+Z`} disabled={!canUndo} onClick={() => chain().undo().run()}>
        <UndoIcon fontSize="small" />
      </ToolButton>
      <ToolButton title="Redo" shortcut={`${MOD}+Shift+Z`} disabled={!canRedo} onClick={() => chain().redo().run()}>
        <RedoIcon fontSize="small" />
      </ToolButton>
      <ToolButton title={historyDisabled ? 'Version history (available once published)' : 'Version history'} disabled={historyDisabled} onClick={onHistory}>
        <HistoryIcon fontSize="small" />
      </ToolButton>
      <ToolButton title={pinned ? 'Unpin' : 'Pin'} active={pinned} disabled={pinDisabled} onClick={onTogglePin}>
        {pinned ? <PushPinIcon fontSize="small" /> : <PushPinOutlinedIcon fontSize="small" />}
      </ToolButton>
    </div>
  )
}

export default ConfluenceToolbar
