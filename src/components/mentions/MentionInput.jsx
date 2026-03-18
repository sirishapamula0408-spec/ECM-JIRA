import { useState, useRef, useCallback } from 'react'
import { useMembers } from '../../context/MemberContext'
import './MentionInput.css'

export function MentionInput({ value, onChange, placeholder = 'Add a comment...', rows = 2, className = '' }) {
  const { members } = useMembers()
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [mentionStart, setMentionStart] = useState(-1)
  const textareaRef = useRef(null)

  const handleChange = useCallback((e) => {
    const text = e.target.value
    const cursorPos = e.target.selectionStart
    onChange(text)

    // Check if we're in an @mention context
    const textBefore = text.slice(0, cursorPos)
    const atIndex = textBefore.lastIndexOf('@')

    if (atIndex >= 0 && (atIndex === 0 || /\s/.test(textBefore[atIndex - 1]))) {
      const query = textBefore.slice(atIndex + 1).toLowerCase()
      const filtered = members.filter((m) =>
        m.name.toLowerCase().includes(query) || m.email.toLowerCase().includes(query),
      ).slice(0, 6)

      if (filtered.length > 0) {
        setSuggestions(filtered)
        setMentionStart(atIndex)
        setShowSuggestions(true)
        return
      }
    }

    setShowSuggestions(false)
  }, [members, onChange])

  function insertMention(member) {
    const before = value.slice(0, mentionStart)
    const after = value.slice(textareaRef.current.selectionStart)
    const newValue = `${before}@${member.email} ${after}`
    onChange(newValue)
    setShowSuggestions(false)

    // Restore focus
    setTimeout(() => {
      if (textareaRef.current) {
        const pos = mentionStart + member.email.length + 2
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(pos, pos)
      }
    }, 0)
  }

  function handleKeyDown(e) {
    if (showSuggestions && e.key === 'Escape') {
      e.preventDefault()
      setShowSuggestions(false)
    }
  }

  return (
    <div className="mention-input-wrap">
      <textarea
        ref={textareaRef}
        rows={rows}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={`mention-textarea ${className}`}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
      />
      {showSuggestions && (
        <div className="mention-suggestions" role="listbox">
          {suggestions.map((m) => (
            <button
              key={m.id}
              type="button"
              className="mention-suggestion-item"
              role="option"
              onMouseDown={(e) => { e.preventDefault(); insertMention(m) }}
            >
              <span className="mention-avatar">{m.name.slice(0, 2).toUpperCase()}</span>
              <div className="mention-info">
                <span className="mention-name">{m.name}</span>
                <span className="mention-email">{m.email}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
