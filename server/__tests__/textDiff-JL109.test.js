// @vitest-environment node
/* ================================================================
   JL-109 — the line diff, on its own.

   Tested apart from the route because the LCS walk and the markup
   reduction are where the behaviour actually lives; going through
   HTTP to exercise them would only add mocks between the assertion
   and the thing asserted.
   ================================================================ */
import { describe, it, expect } from 'vitest'
import { diffLines, contentToLines, summarise } from '../utils/textDiff.js'

describe('contentToLines', () => {
  it('makes one line per block', () => {
    expect(contentToLines('<p>one</p><p>two</p>')).toEqual(['one', 'two'])
  })

  it('treats a <br> as a line break', () => {
    expect(contentToLines('<p>one<br>two</p>')).toEqual(['one', 'two'])
  })

  it('reads a table row as a single line', () => {
    const html = '<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>'
    expect(contentToLines(html)).toEqual(['a b'])
  })

  it('decodes the entities the sanitiser emits', () => {
    expect(contentToLines('<p>a &amp; b &lt;c&gt;</p>')).toEqual(['a & b <c>'])
  })

  it('does not double-decode &amp;lt;', () => {
    // &amp; is decoded last for exactly this reason.
    expect(contentToLines('<p>&amp;lt;</p>')).toEqual(['&lt;'])
  })

  it('drops blank lines, which would otherwise read as spurious changes', () => {
    expect(contentToLines('<p>a</p><p></p><p>b</p>')).toEqual(['a', 'b'])
  })

  it('collapses runs of whitespace', () => {
    expect(contentToLines('<p>a    b</p>')).toEqual(['a b'])
  })

  it('survives null and undefined', () => {
    expect(contentToLines(null)).toEqual([])
    expect(contentToLines(undefined)).toEqual([])
  })
})

describe('diffLines', () => {
  it('reports identical input as entirely unchanged', () => {
    const d = diffLines(['a', 'b'], ['a', 'b'])
    expect(d.every((r) => r.type === 'same')).toBe(true)
  })

  it('finds an insertion in the middle', () => {
    const d = diffLines(['a', 'c'], ['a', 'b', 'c'])
    expect(summarise(d)).toEqual({ added: 1, removed: 0, unchanged: 2 })
    expect(d.find((r) => r.type === 'added').text).toBe('b')
  })

  it('finds a deletion in the middle', () => {
    const d = diffLines(['a', 'b', 'c'], ['a', 'c'])
    expect(summarise(d)).toEqual({ added: 0, removed: 1, unchanged: 2 })
  })

  it('reports a replacement as one removal and one addition', () => {
    const d = diffLines(['a', 'b'], ['a', 'z'])
    expect(summarise(d)).toEqual({ added: 1, removed: 1, unchanged: 1 })
  })

  it('keeps the common subsequence rather than rewriting everything', () => {
    // A naive diff would call this five changes; LCS keeps the shared run.
    const d = diffLines(['1', '2', '3', '4', '5'], ['1', '2', 'x', '4', '5'])
    expect(summarise(d)).toEqual({ added: 1, removed: 1, unchanged: 4 })
  })

  it('handles an empty side', () => {
    expect(summarise(diffLines([], ['a', 'b']))).toEqual({ added: 2, removed: 0, unchanged: 0 })
    expect(summarise(diffLines(['a'], []))).toEqual({ added: 0, removed: 1, unchanged: 0 })
    expect(diffLines([], [])).toEqual([])
  })

  it('tolerates a non-array', () => {
    expect(diffLines(null, undefined)).toEqual([])
  })

  it('preserves order, so the result reads as a document', () => {
    const d = diffLines(['a', 'b'], ['b', 'a'])
    expect(d.map((r) => r.text).join('')).toContain('a')
    expect(summarise(d).unchanged).toBeGreaterThan(0)
  })

  it('does not attempt a quadratic walk on a pathological pair', () => {
    // Above the cap it degrades to a wholesale replacement rather than
    // chewing a hundred-million-cell matrix. Saying so beats timing out.
    const big = Array.from({ length: 2100 }, (_, i) => `line ${i}`)
    const started = Date.now()
    const d = diffLines(big, big.slice())
    expect(Date.now() - started).toBeLessThan(2000)
    expect(summarise(d).unchanged).toBe(0)
  })
})
