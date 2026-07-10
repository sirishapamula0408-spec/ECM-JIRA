import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { tokenizeIssueKeys, extractIssueKeys } from '../utils/smartLinks'
import { SmartText } from '../components/common/SmartText'

describe('tokenizeIssueKeys', () => {
  it('returns an empty array for empty/nullish input', () => {
    expect(tokenizeIssueKeys('')).toEqual([])
    expect(tokenizeIssueKeys(null)).toEqual([])
    expect(tokenizeIssueKeys(undefined)).toEqual([])
  })

  it('returns a single text segment when there are no keys', () => {
    expect(tokenizeIssueKeys('just some plain text')).toEqual([
      { type: 'text', value: 'just some plain text' },
    ])
  })

  it('splits a single issue key out of surrounding text', () => {
    expect(tokenizeIssueKeys('see JL-42 now')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'issueKey', key: 'JL-42' },
      { type: 'text', value: ' now' },
    ])
  })

  it('detects multiple keys', () => {
    expect(tokenizeIssueKeys('JL-1 blocks ABC-99')).toEqual([
      { type: 'issueKey', key: 'JL-1' },
      { type: 'text', value: ' blocks ' },
      { type: 'issueKey', key: 'ABC-99' },
    ])
  })

  it('handles a key with adjacent punctuation (JL-42.)', () => {
    expect(tokenizeIssueKeys('done in JL-42.')).toEqual([
      { type: 'text', value: 'done in ' },
      { type: 'issueKey', key: 'JL-42' },
      { type: 'text', value: '.' },
    ])
  })

  it('does not match lowercase keys', () => {
    expect(tokenizeIssueKeys('jl-42 is not a key')).toEqual([
      { type: 'text', value: 'jl-42 is not a key' },
    ])
  })

  it('does not match inside a larger word', () => {
    expect(tokenizeIssueKeys('xJL-42x')).toEqual([
      { type: 'text', value: 'xJL-42x' },
    ])
  })

  it('does not match a bare number or letter-less token', () => {
    expect(tokenizeIssueKeys('1-2 and 42')).toEqual([
      { type: 'text', value: '1-2 and 42' },
    ])
  })

  it('does not linkify a key embedded in a URL', () => {
    const segments = tokenizeIssueKeys('https://example.com/JL-42 ref JL-7')
    expect(segments).toEqual([
      { type: 'text', value: 'https://example.com/JL-42' },
      { type: 'text', value: ' ref ' },
      { type: 'issueKey', key: 'JL-7' },
    ])
  })

  it('round-trips: concatenating segments reproduces the input', () => {
    const input = 'fix JL-42 and ABC-1, see https://x.io/PROJ-9 too'
    const joined = tokenizeIssueKeys(input)
      .map((s) => (s.type === 'issueKey' ? s.key : s.value))
      .join('')
    expect(joined).toBe(input)
  })
})

describe('extractIssueKeys', () => {
  it('returns unique keys in first-seen order', () => {
    expect(extractIssueKeys('JL-42 then JL-1 then JL-42 again')).toEqual(['JL-42', 'JL-1'])
  })

  it('returns an empty array when there are no keys', () => {
    expect(extractIssueKeys('nothing here')).toEqual([])
  })

  it('ignores keys inside URLs', () => {
    expect(extractIssueKeys('https://example.com/JL-42 and JL-9')).toEqual(['JL-9'])
  })
})

describe('SmartText', () => {
  it('renders an issue key as a link with the key fallback href', () => {
    render(
      <MemoryRouter>
        <SmartText text="see JL-42 please" />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: 'JL-42' })
    expect(link).toHaveAttribute('href', '/issues/JL-42')
  })

  it('resolves a key to the numeric issue id when issues are provided', () => {
    render(
      <MemoryRouter>
        <SmartText text="blocked by JL-42" issues={[{ id: 7, key: 'JL-42' }]} />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: 'JL-42' })
    expect(link).toHaveAttribute('href', '/issues/7')
  })

  it('renders plain text without any link when there is no key', () => {
    render(
      <MemoryRouter>
        <SmartText text="just words" />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('just words')).toBeInTheDocument()
  })

  it('renders nothing for empty text', () => {
    const { container } = render(
      <MemoryRouter>
        <SmartText text="" />
      </MemoryRouter>,
    )
    expect(container.textContent).toBe('')
  })
})
