// @vitest-environment node
// JL-180: Shared CSV / NDJSON export utility — pure helper unit tests.
import { describe, it, expect } from 'vitest'
import { csvCell, toCsv, toNdjson } from '../utils/tabular.js'

describe('csvCell', () => {
  it('leaves plain values unquoted', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell(5)).toBe('5')
    expect(csvCell(0)).toBe('0')
  })

  it('maps null/undefined to empty string', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('quotes values containing a comma', () => {
    expect(csvCell('has,comma')).toBe('"has,comma"')
  })

  it('quotes and doubles internal quotes', () => {
    expect(csvCell('quote"x')).toBe('"quote""x"')
  })

  it('quotes values containing newlines and carriage returns', () => {
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"')
    expect(csvCell('carriage\rreturn')).toBe('"carriage\rreturn"')
  })
})

describe('toCsv', () => {
  it('emits a header row from string keys and escapes cells', () => {
    const rows = [
      { a: 'plain', b: 'has,comma' },
      { a: 'quote"x', b: 'line\nbreak' },
    ]
    const csv = toCsv(rows, ['a', 'b'])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('a,b')
    expect(csv).toContain('"has,comma"')
    expect(csv).toContain('"quote""x"')
    expect(csv).toContain('"line\nbreak"')
  })

  it('supports {key,label} columns (header from labels, cells from keys)', () => {
    const rows = [{ seq: 1, actor: 'a@t.com' }]
    const csv = toCsv(rows, [
      { key: 'seq', label: 'Sequence' },
      { key: 'actor', label: 'Actor' },
    ])
    expect(csv.split('\n')[0]).toBe('Sequence,Actor')
    expect(csv.split('\n')[1]).toBe('1,a@t.com')
  })

  it('defaults label to key when label is omitted', () => {
    const csv = toCsv([{ a: 1 }], [{ key: 'a' }])
    expect(csv.split('\n')[0]).toBe('a')
  })

  it('infers columns from the first row when none are provided', () => {
    const csv = toCsv([{ x: 1, y: 2 }])
    expect(csv.split('\n')[0]).toBe('x,y')
    expect(csv.split('\n')[1]).toBe('1,2')
  })

  it('renders null/undefined cells as empty', () => {
    const csv = toCsv([{ a: null, b: undefined }], ['a', 'b'])
    expect(csv.split('\n')[1]).toBe(',')
  })

  it('emits only the header row for empty input with columns', () => {
    expect(toCsv([], ['a', 'b'])).toBe('a,b')
  })

  it('emits an empty string for empty input with no columns', () => {
    expect(toCsv([])).toBe('')
    expect(toCsv(undefined)).toBe('')
  })
})

describe('toNdjson', () => {
  it('emits one JSON object per line', () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const out = toNdjson(rows)
    const lines = out.split('\n')
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0])).toEqual({ id: 1 })
    expect(JSON.parse(lines[2])).toEqual({ id: 3 })
  })

  it('produces no trailing newline', () => {
    expect(toNdjson([{ a: 1 }])).toBe('{"a":1}')
  })

  it('returns an empty string for empty/missing input', () => {
    expect(toNdjson([])).toBe('')
    expect(toNdjson(undefined)).toBe('')
  })
})
