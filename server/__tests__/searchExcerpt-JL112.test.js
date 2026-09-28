// @vitest-environment node
/* ================================================================
   JL-112 — the excerpt builder, on its own.

   Tested apart from the route because the windowing and the offset
   arithmetic are where the behaviour lives, and going through HTTP
   to reach them would only put mocks between the assertion and the
   thing asserted.
   ================================================================ */
import { describe, it, expect } from 'vitest'
import { buildExcerpt, matchRanges } from '../utils/searchExcerpt.js'

describe('matchRanges', () => {
  it('finds every occurrence, case-insensitively', () => {
    expect(matchRanges('Run the runbook, RUNBOOK', 'runbook')).toEqual([[8, 15], [17, 24]])
  })

  it('treats the term as literal text, not as a pattern', () => {
    // A user searching for "a.b" means those three characters.
    expect(matchRanges('axb and a.b', 'a.b')).toEqual([[8, 11]])
  })

  it('does not blow up on regex metacharacters', () => {
    expect(() => matchRanges('cost is $5 (net)', '$5 (net)')).not.toThrow()
    expect(matchRanges('cost is $5 (net)', '$5 (net)')).toEqual([[8, 16]])
  })

  it('returns nothing for an empty term or empty text', () => {
    expect(matchRanges('abc', '')).toEqual([])
    expect(matchRanges('', 'abc')).toEqual([])
    expect(matchRanges(null, undefined)).toEqual([])
  })
})

describe('buildExcerpt', () => {
  const long = (word) =>
    `<p>${'padding words here. '.repeat(20)}${word} ${'more padding after. '.repeat(20)}</p>`

  it('strips markup', () => {
    expect(buildExcerpt('<p>hello <strong>there</strong></p>', 'hello').text)
      .toBe('hello there')
  })

  it('locates the match within the text it returns', () => {
    const ex = buildExcerpt(long('needle'), 'needle')
    const [start, end] = ex.ranges[0]
    expect(ex.text.slice(start, end)).toBe('needle')
  })

  it('windows a long page around the match rather than returning all of it', () => {
    const ex = buildExcerpt(long('needle'), 'needle')
    expect(ex.text.length).toBeLessThanOrEqual(240)
    expect(ex.truncatedStart).toBe(true)
    expect(ex.truncatedEnd).toBe(true)
  })

  it('does not report truncation when the whole page fits', () => {
    const ex = buildExcerpt('<p>short and sweet</p>', 'sweet')
    expect(ex.truncatedStart).toBe(false)
    expect(ex.truncatedEnd).toBe(false)
  })

  it('falls back to the opening when the body does not contain the term', () => {
    // Normal: the page matched on its title or its Space name (JL-114).
    const ex = buildExcerpt('<p>completely unrelated prose</p>', 'engineering')
    expect(ex.text).toContain('completely unrelated')
    expect(ex.ranges).toEqual([])
  })

  it('handles empty content', () => {
    expect(buildExcerpt('', 'x')).toEqual({
      text: '', ranges: [], truncatedStart: false, truncatedEnd: false,
    })
    expect(buildExcerpt(null, 'x').text).toBe('')
  })

  it('marks every occurrence inside the window, not just the first', () => {
    const ex = buildExcerpt('<p>alpha beta alpha</p>', 'alpha')
    expect(ex.ranges.length).toBe(2)
  })

  it('returns text, never markup — the client renders the highlight', () => {
    const ex = buildExcerpt('<p>find the needle</p>', 'needle')
    expect(ex.text).not.toMatch(/<[^>]+>/)
  })
})
